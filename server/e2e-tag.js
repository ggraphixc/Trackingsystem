/**
 * Dravex Tag V2 E2E — rotating beacon identity + community resolution.
 *
 * The tag firmware (tag-firmware/src/tag_rotation.c) derives its beacon as
 *   beacon = hex(sha256(secret_hex + "|" + epoch_day))[0..12]
 * and NEVER broadcasts the permanent secret. This suite is the code-side
 * mirror of that contract:
 *
 *   A. Golden vectors — the exact derivation is pinned to known values so a
 *      firmware or server drift shows up immediately. (The C code uses the
 *      same formula; this pins the expected outputs.)
 *   B. Rotation properties — same secret+day is deterministic; different day
 *      (or secret) changes the beacon.
 *   C. Resolution — the server resolves today's and yesterday's rotating tag
 *      beacons (via staticBeacon), still resolves a legacy V1 static id,
 *      and treats a stale (2+ day old) beacon as an unknown ghost.
 *   D. Community flow — a real sighting against a rotated tag beacon is
 *      stored anonymously and alerts the owner; the sighting payload and the
 *      public recovery view never leak the permanent secret or location.
 *
 * Run: cd server && node e2e-tag.js   (boots and stops its own server)
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { tagBeaconFor, resolveBeacon, dayBucket } = require("./beacon");

const PORT = 5800 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_FILE = path.join(__dirname, "tag-lab-data.json");

const SECRET = "aabbccddeeff"; // the tag's permanent 12-hex NVS secret

let serverProc = null;

let passed = 0;
let failed = 0;
function ok(label) {
  passed++;
  console.log(`  ✓ ${label}`);
}
function bad(label, extra) {
  failed++;
  console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
}
function check(cond, label, extra) {
  if (cond) ok(label);
  else bad(label, extra || "");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, bearer) {
  try {
    const res = await fetch(BASE + path, {
      method: body !== undefined ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } catch (_) {
    return { status: 0, json: null };
  }
}

function startServer() {
  return new Promise((resolve) => {
    try {
      fs.unlinkSync(DATA_FILE);
    } catch (_) {
      /* no file yet */
    }
    serverProc = spawn(process.execPath, ["server.js"], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_FILE,
        DATABASE_URL: "",
        DRAVEX_OWNER_KEY: "",
      },
      stdio: "ignore",
    });
    resolve();
  });
}

function stopServer() {
  try {
    fs.unlinkSync(DATA_FILE);
  } catch (_) {
    /* ignore */
  }
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}

async function bootAndHealth() {
  for (let i = 0; i < 40; i++) {
    const h = await api("/api/health");
    if (h.status === 200) return true;
    await sleep(250);
  }
  return false;
}

(async () => {
  /* ---------------- A + B: derivation contract (pure, no server) ------- */
  console.log("\n— A/B: rotation derivation (mirrors tag_rotation.c) —");

  // Golden vectors are pinned to explicit epoch-day VALUES (not dates) so a
  // firmware or server drift in the derivation shows up as a failure. These
  // were computed independently with sha256 and hardcoded here.
  check(
    tagBeaconFor(SECRET, 20447 * 86400000) === "65b36d17ad51",
    "A1 golden vector: secret aabbccddeeff, epoch day 20447 → 65b36d17ad51",
    tagBeaconFor(SECRET, 20447 * 86400000),
  );
  check(
    tagBeaconFor(SECRET, 20448 * 86400000) === "1e7eeb4f75e2",
    "A2 golden vector: next day → 1e7eeb4f75e2 (rotation changes the beacon)",
    tagBeaconFor(SECRET, 20448 * 86400000),
  );
  check(
    tagBeaconFor("112233445566", 20448 * 86400000) === "bc4e85fb23e3",
    "A3 golden vector: different secret, same day → different beacon",
    "",
  );

  const d = dayBucket(new Date("2026-01-15T00:00:00Z").getTime());
  check(d === 20468, "B0 dayBucket math (epoch day 20468 on 2026-01-15)", String(d));
  check(
    tagBeaconFor(SECRET, new Date("2026-01-15T00:00:00Z").getTime()) ===
      tagBeaconFor(SECRET, new Date("2026-01-15T12:00:00Z").getTime()),
    "B1 deterministic within a day (same secret + day → same beacon)",
    "",
  );
  check(
    tagBeaconFor(SECRET, new Date("2026-01-15T00:00:00Z").getTime()) !==
      tagBeaconFor(SECRET, new Date("2026-01-16T00:00:00Z").getTime()),
    "B2 day boundary changes the beacon",
    "",
  );

  /* ---------------- C: server resolution (hermetic boot) ---------------- */
  console.log("\n— C: resolveBeacon — rotating tag, legacy static, stale —");
  const store = {
    devices: {
      "tag-dev-1": {
        deviceId: "tag-dev-1",
        staticBeacon: SECRET,
        hostname: "DRAVEX-TAG",
      },
      "tag-legacy-1": {
        deviceId: "tag-legacy-1",
        staticBeacon: "deadbeefcafe", // V1 prototype still broadcasting its raw id
        hostname: "LEGACY-TAG",
      },
    },
  };
  const now = new Date("2026-01-15T12:00:00Z").getTime();
  check(
    resolveBeacon(store, tagBeaconFor(SECRET, now), now)?.deviceId === "tag-dev-1",
    "C1 today's rotating beacon resolves to the tag",
    "",
  );
  check(
    resolveBeacon(store, tagBeaconFor(SECRET, now - 86400000), now)?.deviceId === "tag-dev-1",
    "C2 yesterday's rotating beacon still resolves (midnight cross)",
    "",
  );
  check(
    resolveBeacon(store, tagBeaconFor(SECRET, now - 2 * 86400000), now) === null,
    "C3 2-day-old beacon does NOT resolve (expires naturally, no replay)",
    "",
  );
  check(
    resolveBeacon(store, "deadbeefcafe", now)?.deviceId === "tag-legacy-1",
    "C4 legacy V1 static id still resolves (backwards compatible)",
    "",
  );
  check(
    resolveBeacon(store, "000000000000", now) === null,
    "C5 unknown beacon → null (anti-probe: never reveals existence)",
    "",
  );

  /* ---------------- D: full community flow through the API --------------- */
  console.log("\n— D: sighting against a rotating tag beacon —");
  startServer();
  check(await bootAndHealth(), "D0 server booted", "");

  // Register + claim the tag with its permanent secret as staticBeacon.
  const pair = await api("/api/pair/register", { label: "TAG" });
  const claim = await api("/api/pair/claim", {
    code: pair.json.code,
    hostname: "DRAVEX-TAG",
    serialNumber: `TAG-${SECRET}`,
    platform: "tag",
    staticBeacon: SECRET,
  });
  const deviceId = claim.json.deviceId;
  check(!!deviceId, "D1 tag claimed with staticBeacon", "");

  // Mark the tag lost (registry + beacon arming signal).
  const lost = await api(`/api/devices/${deviceId}/lost`, { lost: true });
  check(lost.status === 200, "D2 tag marked lost", "");

  // A nearby Dravex phone hears TODAY's rotated beacon → anonymous sighting.
  const todayBeacon = tagBeaconFor(SECRET);
  const s1 = await api("/api/sightings", { beacon: todayBeacon, lat: 6.5244, lng: 3.3792, accuracy: 18 });
  check(s1.status === 201, "D3 sighting with today's rotated beacon accepted", String(s1.status));

  // The owner sees it — and the sighting payload carries NO permanent secret.
  const sg = await api(`/api/devices/${deviceId}/sightings`);
  check(sg.status === 200 && sg.json.items.length === 1, "D4 sighting stored for the tag", "");
  const payload = sg.json.items[0];
  check(
    payload && !JSON.stringify(payload).includes(SECRET) && !("staticBeacon" in payload),
    "D5 sighting payload never leaks the permanent secret",
    JSON.stringify(payload).slice(0, 120),
  );
  const alerts = await api("/api/alerts/latest");
  check(
    alerts.json.alerts.some((a) => a.type === "sighting" && a.deviceId === deviceId),
    "D6 owner alerted about the tag sighting",
    "",
  );

  // A stale (replayed) beacon is swallowed — no duplicate, no identity probe.
  const stale = tagBeaconFor(SECRET, Date.now() - 3 * 86400000);
  const s2 = await api("/api/sightings", { beacon: stale, lat: 6.5, lng: 3.4 });
  const sg2 = await api(`/api/devices/${deviceId}/sightings`);
  check(s2.status === 201 && sg2.json.items.length === 1, "D7 stale beacon swallowed (still 1 sighting)", "");

  // Public Device Check by the tag's serial shows the registry, not identity.
  const chk = await api(`/api/check?q=${encodeURIComponent(`TAG-${SECRET}`)}`);
  check(
    chk.status === 200 && chk.json.found === true && chk.json.status === "reported_stolen",
    "D8 tag serial in the stolen registry (Device Check) — generic label only",
    JSON.stringify(chk.json).slice(0, 120),
  );

  // The public recovery view (owner lost) exposes no location/secret.
  const pub = await api(`/api/public/recovery/${deviceId}`);
  check(
    pub.status === 200 && pub.json.lost === true && !("lat" in pub.json) && !("sightings" in pub.json) && !JSON.stringify(pub.json).includes(SECRET),
    "D9 public recovery view: lost + generic, no location, no secret",
    JSON.stringify(pub.json).slice(0, 120),
  );

  stopServer();

  console.log(`\ne2e-tag: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
