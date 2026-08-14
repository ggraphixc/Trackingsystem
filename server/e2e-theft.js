/**
 * Dravex Theft Simulation Lab — the Nigerian theft chain, automated.
 *
 * Boots its OWN isolated server (port 4174, throwaway data file,
 * RECONNECT_GAP_HOURS tuned to seconds so a stolen phone "surfacing
 * online" can be simulated without waiting 12 hours), then runs the three
 * scenarios the product is built around:
 *
 *   A — Android theft:  paired → lost → SIM removed → offline → community
 *       sighting → alert → reconnects on a new SIM → recovery
 *   B — Laptop theft:   paired → lost → internet cut → new Wi-Fi → fix
 *       uploaded → remote lock/alarm/webcam → evidence → recovery timeline
 *   C — Reset/resale:   factory reset → new owner checks IMEI → STOLEN →
 *       verified transfer → clean
 *
 * The real-device steps (actual BLE radios, real SIMs, real Wi-Fi) are
 * documented in docs/THEFT_LAB.md — this script proves the server-side of
 * every step in that chain.
 *
 * Run:  cd server && node e2e-theft.js
 * (No running server needed — it starts and stops its own.)
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { SyncClient } = require("../desktop/src/sync-client");
const { beaconFor } = require("./beacon");

// --live <base> [--owner-key <key>]: replay scenarios A/B/C against a RUNNING
// Dravex server (e.g. the live deployment) instead of the hermetic lab server.
// Owner-scoped steps (mark-lost, transfer, verify, settings, admin) then send
// `Authorization: Bearer <key>` — required when that server has auth on.
const LIVE = (() => {
  const i = process.argv.indexOf("--live");
  return i > -1 && process.argv[i + 1] ? String(process.argv[i + 1]).replace(/\/+$/, "") : null;
})();
const OWNER_KEY = (() => {
  const i = process.argv.indexOf("--owner-key");
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.DRAVEX_OWNER_KEY) return process.env.DRAVEX_OWNER_KEY;
  // Fall back to server/.env so `--live` works with zero setup.
  try {
    const envFile = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    const m = envFile.match(/^DRAVEX_OWNER_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/["']/g, "");
  } catch {}
  return "";
})();

// Random high port: a stale lab server from a previous run must never block
// this one (a fixed port made the lab flaky when a PID leaked on Windows).
const PORT = 4200 + Math.floor(Math.random() * 200);
const BASE = LIVE || `http://127.0.0.1:${PORT}`;
const DATA_FILE = path.join(__dirname, "lab-data.json");
const IMEI = LIVE ? "354988079999991" : "354988071234567";

let serverProc = null;
let captureServer = null;
let captured = []; // webhook deliveries the lab server POSTed to the capture

async function api(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (OWNER_KEY) headers.Authorization = `Bearer ${OWNER_KEY}`;
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch (_) {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

function startServer() {
  return new Promise((resolve) => {
    for (const f of [DATA_FILE]) {
      try {
        fs.unlinkSync(f);
      } catch (_) {
        /* no file yet */
      }
    }
    serverProc = spawn(process.execPath, ["server.js"], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_FILE,
        // Force file mode + open auth: the lab must be hermetic — it must
        // never write its fixed-IMEI test devices into a real Neon database,
        // and a DRAVEX_OWNER_KEY in the host env (server/.env) must not flip
        // it into auth mode (pair/register would 401).
        DATABASE_URL: "",
        DRAVEX_OWNER_KEY: "",
        RECONNECT_GAP_HOURS: "0.001", // ~3.6 s — simulates the 12 h gap
        // N4: point the lab server's webhook sink at the local capture and
        // lower the thresholds so the ops-alert pipeline can be exercised.
        ALERT_WEBHOOK_URL: captureServer
          ? `http://127.0.0.1:${captureServer.address().port}/capture`
          : "",
        OPS_RATE_LIMIT_STORM: "3",
        OPS_GEO_MIN_REQUESTS: "3",
        OPS_GEO_UNRESOLVED_RATIO: "0.5",
        OPS_ALERT_INTERVAL_S: "3600", // never fires mid-test — scenario D calls it explicitly
      },
      stdio: "ignore",
    });
    resolve();
  });
}

/** Tiny local webhook receiver — proves ops alerts actually leave the server. */
function startCapture() {
  captureServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        captured.push(JSON.parse(body));
      } catch (_) {
        captured.push({ raw: body });
      }
      res.writeHead(200).end("ok");
    });
  });
  return new Promise((resolve) =>
    captureServer.listen(0, "127.0.0.1", () => resolve(captureServer)),
  );
}

function stopCapture() {
  if (captureServer) {
    try {
      captureServer.close();
    } catch (_) {
      /* ignore */
    }
    captureServer = null;
  }
}

function stopServer() {
  try {
    for (const f of [DATA_FILE]) fs.unlinkSync(f);
  } catch (_) {
    /* ignore */
  }
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}

async function scenarioA(client, deviceId) {
  console.log("\n— Scenario A: Android phone theft —");
  // 1. Baseline fix (normal tracking).
  await client.postFix(deviceId, { lat: 6.5244, lng: 3.3792, accuracy: 18, source: "gps", timestamp: new Date().toISOString(), confidence: 92 });
  console.log("[A1] paired phone tracking normally ✓");

  // 2. Owner marks LOST → recovery code + registry + beacon armed.
  const lost = await api(`/api/devices/${deviceId}/lost`, { lost: true });
  if (!lost.ok || !lost.recoveryCode) throw new Error("A2: mark-lost failed");
  const reg = await api(`/api/check?q=${IMEI}`);
  if (reg.status !== "reported_stolen") throw new Error("A2: IMEI not in stolen registry");
  console.log(`[A2] marked lost → recoveryCode ${lost.recoveryCode} · IMEI listed as STOLEN ✓`);

  // 3. SIM removed (radio fingerprint changes — works with data off).
  await client.postEvent(deviceId, { type: "sim_change", detail: { from: "621|1", to: "621|5" } });
  console.log("[A3] SIM change event recorded (radio-level) ✓");

  // 4. Data/Wi-Fi off → the phone goes silent (no fixes for the gap window).
  console.log("[A4] device offline — waiting out the reconnect-gap window…");
  await sleep(5000);

  // 5. A nearby Dravex Android hears the beacon → anonymous sighting.
  const beacon = beaconFor(deviceId);
  const s = await api("/api/sightings", { beacon, lat: 6.53, lng: 3.385, accuracy: 15 });
  const sightings = await api(`/api/devices/${deviceId}/sightings`);
  if (!s.ok || sightings.items.length !== 1) throw new Error("A5: sighting not stored");
  console.log(`[A5] community sighting stored (beacon ${beacon}) ✓`);

  // 6. Owner received alerts: stolen, sim_change, sighting.
  const alerts = (await api("/api/alerts/latest")).alerts;
  for (const type of ["stolen", "sim_change", "sighting"]) {
    if (!alerts.some((a) => a.type === type && a.deviceId === deviceId)) {
      throw new Error(`A6: ${type} alert missing`);
    }
  }
  console.log("[A6] owner alerts: stolen + SIM change + sighting all delivered ✓");

  // 7. Phone reconnects with a NEW SIM → reconnected event + alert.
  await client.postFix(deviceId, { lat: 9.0765, lng: 7.3986, accuracy: 60, source: "gps", timestamp: new Date().toISOString(), confidence: 88 });
  const dev = await api(`/api/devices/${deviceId}`);
  if (LIVE) {
    // The live server's reconnect window is RECONNECT_GAP_HOURS=12 h — it
    // cannot be waited out in a live replay. The hermetic lab proves the
    // reconnect pipeline with a tuned gap; here we assert the fix landed and
    // the device is genuinely back online.
    if (!dev.lastFix || Math.abs(dev.lastFix.lat - 9.0765) > 0.001) throw new Error("A7: reconnect fix not stored");
    console.log("[A7] fix landed on live (reconnect event needs the 12 h gap — proven in hermetic mode) ✓");
  } else {
    if (!dev.events.some((e) => e.type === "reconnected")) throw new Error("A7: reconnected event missing");
    const alerts2 = (await api("/api/alerts/latest")).alerts;
    if (!alerts2.some((a) => a.type === "reconnected" && a.deviceId === deviceId)) throw new Error("A7: reconnect alert missing");
    console.log("[A7] reconnected on new SIM → event + alert ✓");
  }

  // 8. Recovery: verify.
  const verify = await api(`/api/devices/${deviceId}/verify`, {});
  if (!verify.ok) throw new Error("A8: verify failed");
  console.log("[A8] verified recovered — chain closed ✓");
  return true;
}

async function scenarioB(client, deviceId) {
  console.log("\n— Scenario B: laptop theft —");
  // 1. Laptop paired + fingerprint fix (BSSIDs ride along).
  await client.postFix(deviceId, {
    lat: 6.6018, lng: 3.3515, accuracy: 25, source: "wifi_resolved",
    networks: [{ bssid: "A0:36:9F:11:22:33", ssid: "Office-NG", rssi: -52 }],
    timestamp: new Date().toISOString(), confidence: 85,
  });
  console.log("[B1] laptop tracked with Wi-Fi fingerprint ✓");

  // 2. Mark LOST → lost command queued.
  const lost = await api(`/api/devices/${deviceId}/lost`, { lost: true });
  const cmds = await client.getCommands(deviceId, null);
  if (!lost.ok || !cmds.some((c) => c.type === "lost")) throw new Error("B2: lost command not queued");
  console.log("[B2] marked lost → `lost` command queued ✓");

  // 3. Internet cut — no fixes (gap window).
  console.log("[B3] internet disconnected — waiting out the gap…");
  await sleep(5000);

  // 4. Thief joins a NEW Wi-Fi → honest fix: server has no geolocation key,
  // so the ladder falls back to IP. Fingerprint still rides along.
  const fix = await client.postFix(deviceId, {
    lat: 6.5244, lng: 3.3792, accuracy: 1200, source: "ip",
    ipAddress: "105.112.44.201",
    networks: [{ bssid: "F8:1A:67:44:55:66", ssid: "Cafe-Wifi", rssi: -68 }],
    timestamp: new Date().toISOString(), confidence: 55,
  });
  const fixes = await api(`/api/devices/${deviceId}/fixes?limit=5`);
  const last = fixes.items[0];
  if (!fix || last.source !== "ip") throw new Error("B4: honest IP fallback fix missing");
  if (!Array.isArray(last.networks) || last.networks[0]?.ssid !== "Cafe-Wifi") throw new Error("B4: fingerprint not retained");
  const ev = await api(`/api/devices/${deviceId}`);
  if (LIVE) {
    // Same 12 h live gap as A7 — reconnect is proven hermetically; live only
    // proves the fix + fingerprint chain above.
    console.log("[B4] new Wi-Fi → honest IP fix + fingerprint (reconnect event proven hermetically) ✓");
  } else {
    if (!ev.events.some((e) => e.type === "reconnected")) throw new Error("B4: reconnect event missing");
    console.log("[B4] new Wi-Fi → honest IP fix + fingerprint + reconnect event ✓");
  }

  // 5. Remote commands: lock + alarm + webcam; agent polls and acks them.
  for (const type of ["lock", "alarm", "webcam"]) {
    await api(`/api/devices/${deviceId}/commands`, { type });
  }
  const pending = await client.getCommands(deviceId, null);
  const types = pending.map((c) => c.type);
  for (const t of ["lock", "alarm", "webcam"]) {
    if (!types.includes(t)) throw new Error(`B5: ${t} command missing`);
  }
  for (const c of pending) await client.ackCommand(deviceId, c.id);
  console.log("[B5] lock + alarm + webcam delivered and acked ✓");

  // 6. Webcam evidence captured by the laptop.
  await client.postEvidence(deviceId, "data:image/jpeg;base64,PHOTO_FROM_STOLEN_LAPTOP");
  const evidence = await api(`/api/devices/${deviceId}/evidence`);
  if (evidence.length !== 1) throw new Error("B6: evidence not stored");
  console.log("[B6] thief evidence uploaded ✓");

  // 7. Recovery view data: movement + timeline present.
  const detail = await api(`/api/devices/${deviceId}`);
  const eventTypes = detail.events.map((e) => e.type).join(",");
  const required = LIVE ? ["lost"] : ["lost", "reconnected"]; // reconnected = 12 h live gap
  if (!required.every((t) => eventTypes.includes(t))) throw new Error("B7: recovery timeline incomplete");
  console.log(`[B7] recovery timeline: ${eventTypes} ✓`);
  return true;
}

async function scenarioC(owner, deviceId, code) {
  console.log("\n— Scenario C: factory reset / resale —");
  // 1. Device is lost → registry STOLEN.
  const reg1 = await api(`/api/check?q=${IMEI}`);
  if (reg1.status !== "reported_stolen") throw new Error("C1: expected STOLEN before reset");
  console.log("[C1] pre-reset: IMEI reads STOLEN ✓");

  // 2. Factory reset — the app is gone; the NEW owner installs Dravex and
  // checks the IMEI on a fresh install (post-flash Device Check).
  const fresh = new SyncClient(BASE);
  const check2 = await fresh.checkRegistry(IMEI);
  if (!check2 || !check2.found || check2.status !== "reported_stolen") throw new Error("C2: fresh-install check missed");
  console.log("[C2] fresh install Device Check: 🔴 STOLEN — do not use ✓");

  // 3. Owner verifies recovery → registry resolves.
  await api(`/api/devices/${deviceId}/verify`, {});
  const reg3 = await api(`/api/check?q=${IMEI}`);
  if (reg3.found) throw new Error("C3: registry not resolved after verify");
  console.log("[C3] verified recovered → registry clean ✓");

  // 4. Second-life: owner transfers to a buyer → new code + clean registry.
  const transfer = await api(`/api/devices/${deviceId}/transfer`, {});
  if (!transfer.ok || !transfer.code) throw new Error("C4: transfer failed");
  const reg4 = await api(`/api/check?q=${IMEI}`);
  if (reg4.found) throw new Error("C4: registry not cleared on transfer");
  const buyer = new SyncClient(BASE);
  const claim = await buyer.claim(transfer.code, { hostname: "BUYER-PHONE", serialNumber: "BUY-SN-1", platform: "android", imei: IMEI });
  if (!claim || claim.deviceId !== deviceId) throw new Error("C4: buyer could not claim");
  console.log(`[C4] verified transfer → buyer claims with fresh code ${transfer.code} ✓`);

  // 5. The sold device now reads CLEAN for the next marketplace check.
  const reg5 = await api(`/api/check?q=${IMEI}`);
  if (reg5.found || reg5.status !== "clean") throw new Error("C5: sold device should read clean");
  console.log("[C5] post-sale check: 🟢 clean (previously reported) ✓");
  return buyer;
}

/**
 * Scenario D — production-readiness (hermetic lab only): N3 retention sweep,
 * N5 verified-resale pipeline, N4 operator alerting over a real webhook, and
 * the public counters. Proves the server side of the Phase-2.5/N0-N5 batch.
 */
async function scenarioD(client, deviceId) {
  console.log("\n— Scenario D: production readiness (retention · resale · ops alerting · stats) —");

  // D1 — N3: retention window + purge sweep.
  const s1 = await api("/api/settings", { evidenceRetentionDays: 30 });
  if (s1.evidenceRetentionDays !== 30) throw new Error("D1: retention not saved");
  const old = new Date(Date.now() - 400 * 86400000).toISOString(); // > 30 days
  const fresh = new Date().toISOString();
  await client.postFix(deviceId, { lat: 6.5, lng: 3.38, accuracy: 20, source: "ip", timestamp: old, confidence: 50 });
  await client.postFix(deviceId, { lat: 6.51, lng: 3.39, accuracy: 20, source: "ip", timestamp: fresh, confidence: 50 });
  await client.postEvidence(deviceId, "data:image/jpeg;base64,OLD_PHOTO", old);
  await client.postEvidence(deviceId, "data:image/jpeg;base64,FRESH_PHOTO", fresh);
  const purge = await api("/api/admin/purge", {});
  if (!purge.ok) throw new Error("D1: purge endpoint failed");
  const fixes = await api(`/api/devices/${deviceId}/fixes?limit=50`);
  const evidence = await api(`/api/devices/${deviceId}/evidence`);
  if (fixes.items.some((f) => f.timestamp === old)) throw new Error("D1: old fix survived purge");
  if (evidence.some((e) => e.capturedAt === old)) throw new Error("D1: old evidence survived purge");
  if (purge.purged.fixes < 1 || purge.purged.evidence < 1) throw new Error("D1: purge counts wrong");
  console.log(`[D1] retention 30 days → purge removed ${purge.purged.fixes} fix(es), ${purge.purged.evidence} evidence, ${purge.purged.sightings} sightings ✓`);

  // D2 — N5: verified resale listing (only transferred devices can be listed).
  const transfer = await api(`/api/devices/${deviceId}/transfer`, {});
  if (!transfer.ok) throw new Error("D2: transfer failed");
  const transferCode = transfer.code; // hoisted for D5: must die with the device
  const list = await api("/api/listings", { deviceId, price: 125000, condition: "Good" });
  if (!list.ok) throw new Error("D2: listing failed");
  const browse = await api("/api/listings");
  if (!browse.listings.some((l) => l.deviceId === deviceId && l.price === 125000)) throw new Error("D2: listing not in browse");
  const chk = await api(`/api/check?q=${IMEI}`);
  if (!chk.resaleReady) throw new Error("D2: check did not flag verified resale-ready");
  const interest = await api(`/api/listings/${deviceId}/interest`, { message: "I want to buy this — Olu from Lagos" });
  if (!interest.ok) throw new Error("D2: buyer interest failed");
  const alerts = (await api("/api/alerts/latest")).alerts;
  if (!alerts.some((a) => a.type === "interest" && a.deviceId === deviceId)) throw new Error("D2: interest alert missing");
  await api("/api/listings/unlist", { deviceId });
  const chk2 = await api(`/api/check?q=${IMEI}`);
  if (chk2.resaleReady) throw new Error("D2: unlist did not clear resale-ready");
  console.log("[D2] transfer → listing → public check 'verified resale-ready' → buyer interest alert → unlist ✓");

  // D3 — N4: rate-limit/abuse storm → ops alert reaches the webhook.
  for (let i = 0; i < 40; i++) await api("/api/check?q=99999999"); // trip the 30/min check limiter
  const check = await api("/api/admin/ops-check", {});
  if (!check.ok || !Array.isArray(check.fired)) throw new Error("D3: ops-check failed");
  const storm = check.fired.find((c) => c.includes("rate-limit/abuse storm"));
  if (!storm) throw new Error(`D3: rate-limit storm not detected (fired=${JSON.stringify(check.fired)})`);
  await sleep(1500); // let the fire-and-forget webhook delivery land
  const opsHook = captured.find((h) => h.alert && h.alert.type === "ops");
  if (!opsHook) throw new Error("D3: ops alert did not reach the webhook capture");
  console.log(`[D3] ops alert fired ("${storm}") → delivered to ALERT_WEBHOOK_URL ✓`);

  // D4 — public counters for the landing page.
  const stats = await api("/api/stats");
  if (!stats.ok || typeof stats.protected !== "number" || stats.protected < 1) throw new Error("D4: stats broken");
  console.log(`[D4] public stats: protected=${stats.protected} recovered=${stats.recovered} sighted=${stats.sighted} listings=${stats.listings} ✓`);

  // D5 — forget device: the owner permanently removes the device; its
  // registry entries, listing and alerts go with it (test devices, retired
  // agents, hardware sold outside Dravex).
  const forget = await api(`/api/devices/${deviceId}/forget`, {});
  if (!forget.ok) throw new Error("D5: forget failed");
  const after = await api("/api/devices");
  if (after.some((d) => d.deviceId === deviceId)) throw new Error("D5: device still listed after forget");
  // The pairing code issued at transfer must be dead too: claiming it must
  // NOT resurrect the forgotten device (lazy device() getter regression).
  const stale = new SyncClient(BASE);
  const staleClaim = await stale.claim(transferCode, { hostname: "GHOST", platform: "win32" });
  if (staleClaim && staleClaim.deviceId) throw new Error("D5: stale pairing code resurrected the device");
  console.log("[D5] device forgotten — removed from devices, registry, listings, alerts and pair codes ✓");
  return true;
}

(async () => {
  console.log("== Dravex theft simulation lab ==");
  if (LIVE) {
    console.log(`LIVE mode: running against ${LIVE} — this creates test devices on that server`);
    if (OWNER_KEY) console.log("LIVE mode: owner key provided for owner-scoped steps");
    else console.warn("LIVE mode: no --owner-key — steps that need owner auth will fail on a locked server");
  } else {
    await startCapture();
    await startServer();
  }
  if (!(await waitHealth())) {
    stopServer();
    stopCapture();
    throw new Error(LIVE ? "Live server unreachable" : "Lab server did not start");
  }
  console.log(`${LIVE ? "live" : "lab"} server reachable at ${BASE}`);

  const tag = LIVE ? "LIVE-" : "";

  // --- A: Android ---
  const pairA = await api("/api/pair/register", { label: "PHONE-1" });
  const clientA = new SyncClient(BASE);
  const claimA = await clientA.claim(pairA.code, { hostname: `${tag}TECNO-PHONE`, serialNumber: "PH-SN-1", platform: "android", imei: IMEI });
  if (!claimA?.deviceId) throw new Error("A0: claim failed");
  await scenarioA(clientA, claimA.deviceId);

  // --- B: Laptop ---
  const pairB = await api("/api/pair/register", { label: "LAPTOP-1" });
  const clientB = new SyncClient(BASE);
  const claimB = await clientB.claim(pairB.code, { hostname: `${tag}HP-ELITEBOOK`, serialNumber: "SN-HP-2026", platform: "win32" });
  await scenarioB(clientB, claimB.deviceId);

  // --- C: Reset/resale on the phone from A (re-lost first) ---
  await api(`/api/devices/${claimA.deviceId}/lost`, { lost: true });
  const buyer = await scenarioC(null, claimA.deviceId, pairA.code);

  // --- D: production-readiness (hermetic lab only — needs the webhook
  // capture + tuned thresholds that a live server does not have). ---
  if (!LIVE) {
    await scenarioD(buyer, claimA.deviceId);
    console.log("\n== THEFT LAB PASSED — scenarios A, B, C and D ==\n");
  } else {
    console.log("\n== THEFT LAB PASSED — scenarios A, B, C against the live server ==\n");
    console.log("Scenario D (retention/resale/ops/stats) runs only in hermetic mode.");
  }
  stopServer();
  stopCapture();
})().then(
  () => {},
  (e) => {
    console.error("THEFT LAB FAILED:", e.message);
    stopServer();
    stopCapture();
    process.exit(1);
  },
);
