/**
 * Dravex Scale Core E2E — cursor pagination for fixes / events / sightings.
 *
 * Phase 1 (open mode, file storage): paging correctness over 250 fixes —
 * newest-first, 50 per page, no duplicates, no skipped rows, final page
 * hasMore=false; invalid cursor/limit rejection; limit clamping; filters
 * (dateFrom/dateTo/source); events + sightings paging; latest fix still
 * surfaced in the device summary.
 *
 * Phase 2 (auth mode): owner isolation (account A cannot read account B's
 * device), device-token isolation (device A's token cannot read device B),
 * and the existence-leak guard (an unauthenticated probe of a missing vs an
 * existing deviceId both answer 401; with a valid credential a missing
 * device is a plain 404).
 *
 * Neon mode: pass --neon <postgres-url> to re-run the Phase-1 paging checks
 * against a Neon/Postgres-backed server (needs `pg` installed in server/).
 * Default run is JSON-file mode only.
 *
 * Run: cd server && node e2e-pagination.js
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { SyncClient } = require("../desktop/src/sync-client");

const PORT = 5400 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_FILE = path.join(__dirname, "pagination-lab-data.json");
const OWNER_KEY = "test-pagination-key-123";

const NEON_URL = (() => {
  const i = process.argv.indexOf("--neon");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "";
})();

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
  // Never throw: a not-yet-booted server (ECONNREFUSED) must be retried by
  // the callers, not crash the suite.
  try {
    const res = await fetch(BASE + path, {
      method: body !== undefined ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      /* non-JSON */
    }
    return { status: res.status, json };
  } catch (_) {
    return { status: 0, json: null };
  }
}

function startServer(extraEnv = {}) {
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
        ...extraEnv,
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

/** Encode a cursor the same way the server does (for the 404-cursor test). */
function encodeCursor(at, id) {
  return Buffer.from(`${at}::${id}`).toString("base64url");
}

/* ---------------- Phase 1: open mode — paging correctness ---------------- */

async function phase1() {
  console.log("\n— Phase 1: paging correctness (open mode, JSON file) —");
  startServer({});
  check(await bootAndHealth(), "1.0 server booted", "");

  const pair = await api("/api/pair/register", { label: "PAG" });
  const client = new SyncClient(BASE);
  const claim = await client.claim(pair.json.code, { hostname: "PAG-LAPTOP", platform: "win32" });
  const deviceId = claim.deviceId;
  check(!!deviceId, "1.1 device claimed", "");

  // 250 fixes, distinct timestamps (oldest → newest as i grows).
  const N = 250;
  for (let i = 0; i < N; i++) {
    await client.postFix(deviceId, {
      lat: 6.5 + (i % 50) * 0.001,
      lng: 3.37,
      accuracy: 20,
      source: i % 2 ? "wifi_resolved" : "ip",
      timestamp: new Date(Date.now() - (N - i) * 60000).toISOString(),
    });
  }
  // 3 events
  await client.postEvent(deviceId, { type: "reconnected", detail: { gapHours: 1 } });
  await client.postEvent(deviceId, { type: "sim_change", detail: { from: "621|1", to: "621|5" } });
  await client.postEvent(deviceId, { type: "reconnected", detail: { gapHours: 2 } });

  // 1.2 — page through 250 fixes at 50/page: 50,50,50,50,50, hasMore flags.
  const all = [];
  let cursor = null;
  let pages = 0;
  let lastHasMore = null;
  for (;;) {
    const q = `limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const p = await api(`/api/devices/${deviceId}/fixes?${q}`);
    check(p.status === 200 && Array.isArray(p.json.items), `1.2 page ${pages + 1} shape`, JSON.stringify(p.json).slice(0, 80));
    all.push(...p.json.items);
    lastHasMore = p.json.hasMore;
    pages++;
    if (!p.json.hasMore) break;
    cursor = p.json.nextCursor;
    if (pages > 20) {
      bad("1.2 pagination did not terminate", "");
      break;
    }
  }
  check(pages === 5, `1.2 250 fixes → exactly 5 pages (got ${pages})`, "");
  check(all.length === N, `1.2 all rows returned (${all.length})`, "");
  check(lastHasMore === false, "1.2 final page hasMore=false", "");

  // 1.3 — no duplicates, no skipped rows (unique ids + strict newest-first).
  const ids = new Set(all.map((f) => f.id));
  check(ids.size === N, "1.3 no duplicate fixes across pages", `${ids.size}/${N}`);
  const times = all.map((f) => f.timestamp);
  const sortedDesc = times.every((t, i) => i === 0 || t <= times[i - 1]);
  check(sortedDesc, "1.3 strict newest-first ordering", "");

  // 1.4 — second page starts exactly where the first ended.
  const p1 = await api(`/api/devices/${deviceId}/fixes?limit=50`);
  const p2 = await api(`/api/devices/${deviceId}/fixes?limit=50&cursor=${encodeURIComponent(p1.json.nextCursor)}`);
  const overlap = p1.json.items.filter((f) => p2.json.items.some((g) => g.id === f.id));
  check(overlap.length === 0, "1.4 page 2 has no overlap with page 1", "");

  // 1.5 — invalid cursor / bad limit / clamping.
  check((await api(`/api/devices/${deviceId}/fixes?cursor=!!!not-base64!!`)).status === 400, "1.5 invalid cursor rejected (400)", "");
  const ghostCursor = encodeCursor("2026-01-01T00:00:00.000Z", "00000000-0000-0000-0000-000000000000");
  check((await api(`/api/devices/${deviceId}/fixes?cursor=${encodeURIComponent(ghostCursor)}`)).status === 404, "1.5 purged/unknown cursor → 404 (honest)", "");
  check((await api(`/api/devices/${deviceId}/fixes?limit=abc`)).status === 400, "1.5 malformed limit rejected (400)", "");
  check((await api(`/api/devices/${deviceId}/fixes?limit=0`)).status === 400, "1.5 zero limit rejected (400)", "");
  const clamped = await api(`/api/devices/${deviceId}/fixes?limit=9999`);
  check(clamped.status === 200 && clamped.json.limit === 100 && clamped.json.items.length === 100, "1.5 excessive limit clamped to 100", "");

  // 1.6 — filters: dateFrom/dateTo/source, combined with a cursor.
  const mid = new Date(Date.now() - (N / 2) * 60000).toISOString();
  const from = await api(`/api/devices/${deviceId}/fixes?dateFrom=${encodeURIComponent(mid)}`);
  // The newest half (125 fixes) pages like any feed: page 1 = 50, hasMore.
  check(from.status === 200 && from.json.items.length === 50 && from.json.hasMore === true, "1.6 dateFrom filter (newest half, paged)", `got ${from.json.items.length}`);
  const src = await api(`/api/devices/${deviceId}/fixes?source=ip`);
  check(src.status === 200 && src.json.items.length === 50 && src.json.hasMore === true && src.json.items.every((f) => f.source === "ip"), "1.6 source filter (ip only, paged)", `got ${src.json.items.length}`);
  check((await api(`/api/devices/${deviceId}/fixes?source=nonsense`)).status === 400, "1.6 invalid source rejected (400)", "");
  check((await api(`/api/devices/${deviceId}/fixes?dateFrom=not-a-date`)).status === 400, "1.6 invalid dateFrom rejected (400)", "");
  check((await api(`/api/devices/${deviceId}/fixes?dateFrom=${encodeURIComponent(mid)}&dateTo=${encodeURIComponent(new Date(Date.now() - 200 * 60000).toISOString())}`)).status === 400, "1.6 dateFrom after dateTo rejected (400)", "");
  // filter + cursor: page 1 of the ip-only feed, then page 2 must continue it.
  const ip1 = await api(`/api/devices/${deviceId}/fixes?source=ip&limit=40`);
  const ip2 = await api(`/api/devices/${deviceId}/fixes?source=ip&limit=40&cursor=${encodeURIComponent(ip1.json.nextCursor)}`);
  const ipIds = new Set([...ip1.json.items, ...ip2.json.items].map((f) => f.id));
  check(ip1.json.items.length === 40 && ip2.json.items.length === 40 && ipIds.size === 80 && ip2.json.items.every((f) => f.source === "ip"), "1.6 source filter + cursor pages consistently", "");

  // 1.7 — events pagination (newest first, ids, hasMore).
  const ev1 = await api(`/api/devices/${deviceId}/events?limit=2`);
  check(ev1.status === 200 && ev1.json.items.length === 2 && ev1.json.hasMore === true, "1.7 events page 1 (2 of 3)", ev1.json.items.map((e) => e.type).join(","));
  check(ev1.json.items.every((e) => !!e.id), "1.7 events carry stable ids", "");
  check(ev1.json.items[0].type === "reconnected", "1.7 events newest-first", ev1.json.items[0].type);
  const ev2 = await api(`/api/devices/${deviceId}/events?limit=2&cursor=${encodeURIComponent(ev1.json.nextCursor)}`);
  check(ev2.json.items.length === 1 && ev2.json.hasMore === false, "1.7 events page 2 (1 remaining, hasMore=false)", ev2.json.items.map((e) => e.type).join(","));

  // 1.8 — sightings pagination.
  const lost = await api(`/api/devices/${deviceId}/lost`, { lost: true });
  check(lost.status === 200, "1.8 device marked lost (sightings allowed)", "");
  for (let i = 0; i < 5; i++) {
    await api("/api/sightings", { beacon: beaconFor(deviceId), lat: 6.5 + i * 0.001, lng: 3.4, accuracy: 15 });
  }
  const sg1 = await api(`/api/devices/${deviceId}/sightings?limit=3`);
  check(sg1.status === 200 && sg1.json.items.length === 3 && sg1.json.hasMore === true, "1.8 sightings page 1 (3 of 5)", "");
  const sg2 = await api(`/api/devices/${deviceId}/sightings?limit=3&cursor=${encodeURIComponent(sg1.json.nextCursor)}`);
  check(sg2.json.items.length === 2 && sg2.json.hasMore === false, "1.8 sightings page 2 (2 remaining, hasMore=false)", "");
  const sgAll = [...sg1.json.items, ...sg2.json.items];
  check(new Set(sgAll.map((s) => s.id)).size === 5, "1.8 sightings unique ids across pages", "");
  // sightings carry no location source → source filter rejected, not ignored.
  check((await api(`/api/devices/${deviceId}/sightings?source=gps`)).status === 400, "1.8 source filter on sightings rejected (documented)", "");
  // anonymity: sighting payload has no scanner identity fields.
  check(
    sgAll.every((s) => !("scannerId" in s) && !("ownerId" in s) && !("email" in s)),
    "1.8 sightings never expose scanner identity",
    "",
  );

  // 1.9 — latest fix still in the device summary.
  const dev = await api(`/api/devices/${deviceId}`);
  check(!!dev.json.lastFix && dev.json.lastFix.timestamp === times[0], "1.9 latest fix surfaced in device summary", dev.json.lastFix?.timestamp);

  stopServer();
}

/* ---------------- Phase 2: auth mode — isolation + no existence leak ---------------- */

async function phase2() {
  console.log("\n— Phase 2: owner/device isolation + existence guard (auth mode) —");
  startServer({ DRAVEX_OWNER_KEY: OWNER_KEY });
  check(await bootAndHealth(), "2.0 keyed server booted", "");

  // Two accounts, each claiming one device.
  const regA = await api("/api/auth/register", { email: `alice${Date.now()}@pag.test`, password: "password-123" });
  const tokenA = regA.json.token;
  const pairA = await api("/api/pair/register", { label: "PAG-A" }, tokenA);
  const cA = new SyncClient(BASE);
  const claimA = await cA.claim(pairA.json.code, { hostname: "ALICE-PHONE", platform: "android" });

  const regB = await api("/api/auth/register", { email: `bob${Date.now()}@pag.test`, password: "password-123" });
  const tokenB = regB.json.token;
  const pairB = await api("/api/pair/register", { label: "PAG-B" }, tokenB);
  const cB = new SyncClient(BASE);
  const claimB = await cB.claim(pairB.json.code, { hostname: "BOB-PHONE", platform: "android" });
  check(!!claimA.deviceId && !!claimB.deviceId, "2.1 two accounts, two devices claimed", "");

  // A posts a fix; B must not read it.
  await cA.postFix(claimA.deviceId, { lat: 6.5, lng: 3.37, accuracy: 15, source: "gps", timestamp: new Date().toISOString() });
  const bReadsA = await api(`/api/devices/${claimA.deviceId}/fixes`, undefined, tokenB);
  check(bReadsA.status === 401, "2.2 account B cannot read account A's fixes (401)", `got ${bReadsA.status}`);
  const bEventsA = await api(`/api/devices/${claimA.deviceId}/events`, undefined, tokenB);
  check(bEventsA.status === 401, "2.3 account B cannot read account A's events (401)", `got ${bEventsA.status}`);
  const bSightA = await api(`/api/devices/${claimA.deviceId}/sightings`, undefined, tokenB);
  check(bSightA.status === 401, "2.4 account B cannot read account A's sightings (401)", `got ${bSightA.status}`);

  // Device-token isolation: device A's token cannot read device B.
  const aReadsB = await api(`/api/devices/${claimB.deviceId}/fixes`, undefined, claimA.token);
  check(aReadsB.status === 401, "2.5 device A's token cannot read device B's fixes (401)", `got ${aReadsB.status}`);

  // Owner A (session) reads their own device fine.
  const aOwn = await api(`/api/devices/${claimA.deviceId}/fixes?limit=5`, undefined, tokenA);
  check(aOwn.status === 200 && aOwn.json.items.length === 1, "2.6 account A reads own fixes (200)", `got ${aOwn.status}`);

  // Existence guard: no credential → 401 for BOTH existing and missing ids.
  const noCredExisting = await api(`/api/devices/${claimA.deviceId}/fixes`);
  const noCredMissing = await api(`/api/devices/00000000-0000-0000-0000-000000000000/fixes`);
  check(noCredExisting.status === 401 && noCredMissing.status === 401, "2.7 unauthenticated probe: existing & missing both 401 (no oracle)", `existing=${noCredExisting.status} missing=${noCredMissing.status}`);

  // With a valid credential, a missing device is a plain 404.
  const keyedMissing = await api(`/api/devices/00000000-0000-0000-0000-000000000000/fixes`, undefined, OWNER_KEY);
  check(keyedMissing.status === 404, "2.8 with owner key, missing device → 404", `got ${keyedMissing.status}`);

  stopServer();
}

/* ---------------- Neon mode (optional) ---------------- */

async function phaseNeon() {
  console.log("\n— Neon mode paging check (--neon) —");
  startServer({ DATABASE_URL: NEON_URL });
  check(await bootAndHealth(), "N.0 neon server booted", "");

  const pair = await api("/api/pair/register", { label: "NEON" });
  const client = new SyncClient(BASE);
  const claim = await client.claim(pair.json.code, { hostname: "NEON-LAPTOP", platform: "win32" });
  const deviceId = claim.deviceId;

  for (let i = 0; i < 120; i++) {
    await client.postFix(deviceId, {
      lat: 6.5,
      lng: 3.37,
      accuracy: 15,
      source: "gps",
      timestamp: new Date(Date.now() - (120 - i) * 60000).toISOString(),
    });
  }
  const p1 = await api(`/api/devices/${deviceId}/fixes?limit=50`);
  const p2 = await api(`/api/devices/${deviceId}/fixes?limit=50&cursor=${encodeURIComponent(p1.json.nextCursor)}`);
  const p3 = await api(`/api/devices/${deviceId}/fixes?limit=50&cursor=${encodeURIComponent(p2.json.nextCursor)}`);
  const ids = new Set([...p1.json.items, ...p2.json.items, ...p3.json.items].map((f) => f.id));
  check(
    p1.json.items.length === 50 && p2.json.items.length === 50 && p3.json.items.length === 20 && p3.json.hasMore === false && ids.size === 120,
    "N.1 neon: 120 fixes page cleanly through 3 pages (no dup/skip)",
    `${ids.size}/120`,
  );
  stopServer();
}

// Canonical day-rotated beacon (shared with the agent) — a sighting only
// resolves when posted with the true beacon for the current day bucket.
const { beaconFor } = require("./beacon");

(async () => {
  await phase1();
  await phase2();
  if (NEON_URL) await phaseNeon();
  else console.log("\n(Neon paging check skipped — pass --neon <postgres-url> to run it)");
  console.log(`\ne2e-pagination: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
