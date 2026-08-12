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
const { SyncClient } = require("../desktop/src/sync-client");

// Random high port: a stale lab server from a previous run must never block
// this one (a fixed port made the lab flaky when a PID leaked on Windows).
const PORT = 4200 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_FILE = path.join(__dirname, "lab-data.json");
const { beaconFor } = require("./beacon");

let serverProc = null;

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
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
        // Force file mode: the lab must be hermetic — it must never write its
        // fixed-IMEI test devices into a real Neon database.
        DATABASE_URL: "",
        RECONNECT_GAP_HOURS: "0.001", // ~3.6 s — simulates the 12 h gap
      },
      stdio: "ignore",
    });
    resolve();
  });
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
  const reg = await api(`/api/check?q=354988071234567`);
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
  if (!s.ok || sightings.length !== 1) throw new Error("A5: sighting not stored");
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
  if (!dev.events.some((e) => e.type === "reconnected")) throw new Error("A7: reconnected event missing");
  const alerts2 = (await api("/api/alerts/latest")).alerts;
  if (!alerts2.some((a) => a.type === "reconnected" && a.deviceId === deviceId)) throw new Error("A7: reconnect alert missing");
  console.log("[A7] reconnected on new SIM → event + alert ✓");

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
  const last = fixes[0];
  if (!fix || last.source !== "ip") throw new Error("B4: honest IP fallback fix missing");
  if (!Array.isArray(last.networks) || last.networks[0]?.ssid !== "Cafe-Wifi") throw new Error("B4: fingerprint not retained");
  const ev = await api(`/api/devices/${deviceId}`);
  if (!ev.events.some((e) => e.type === "reconnected")) throw new Error("B4: reconnect event missing");
  console.log("[B4] new Wi-Fi → honest IP fix + fingerprint + reconnect event ✓");

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
  if (!["lost", "reconnected"].every((t) => eventTypes.includes(t))) throw new Error("B7: recovery timeline incomplete");
  console.log(`[B7] recovery timeline: ${eventTypes} ✓`);
  return true;
}

async function scenarioC(owner, deviceId, code) {
  console.log("\n— Scenario C: factory reset / resale —");
  // 1. Device is lost → registry STOLEN.
  const reg1 = await api(`/api/check?q=354988071234567`);
  if (reg1.status !== "reported_stolen") throw new Error("C1: expected STOLEN before reset");
  console.log("[C1] pre-reset: IMEI reads STOLEN ✓");

  // 2. Factory reset — the app is gone; the NEW owner installs Dravex and
  // checks the IMEI on a fresh install (post-flash Device Check).
  const fresh = new SyncClient(BASE);
  const check2 = await fresh.checkRegistry("354988071234567");
  if (!check2 || !check2.found || check2.status !== "reported_stolen") throw new Error("C2: fresh-install check missed");
  console.log("[C2] fresh install Device Check: 🔴 STOLEN — do not use ✓");

  // 3. Owner verifies recovery → registry resolves.
  await api(`/api/devices/${deviceId}/verify`, {});
  const reg3 = await api(`/api/check?q=354988071234567`);
  if (reg3.found) throw new Error("C3: registry not resolved after verify");
  console.log("[C3] verified recovered → registry clean ✓");

  // 4. Second-life: owner transfers to a buyer → new code + clean registry.
  const transfer = await api(`/api/devices/${deviceId}/transfer`, {});
  if (!transfer.ok || !transfer.code) throw new Error("C4: transfer failed");
  const reg4 = await api(`/api/check?q=354988071234567`);
  if (reg4.found) throw new Error("C4: registry not cleared on transfer");
  const buyer = new SyncClient(BASE);
  const claim = await buyer.claim(transfer.code, { hostname: "BUYER-PHONE", serialNumber: "BUY-SN-1", platform: "android", imei: "354988071234567" });
  if (!claim || claim.deviceId !== deviceId) throw new Error("C4: buyer could not claim");
  console.log(`[C4] verified transfer → buyer claims with fresh code ${transfer.code} ✓`);

  // 5. The sold device now reads CLEAN for the next marketplace check.
  const reg5 = await api(`/api/check?q=354988071234567`);
  if (reg5.found || reg5.status !== "clean") throw new Error("C5: sold device should read clean");
  console.log("[C5] post-sale check: 🟢 clean (previously reported) ✓");
  return true;
}

(async () => {
  console.log("== Dravex theft simulation lab ==");
  await startServer();
  if (!(await waitHealth())) {
    stopServer();
    throw new Error("Lab server did not start");
  }
  console.log(`lab server up on :${PORT}`);

  // --- A: Android ---
  const pairA = await api("/api/pair/register", { label: "PHONE-1" });
  const clientA = new SyncClient(BASE);
  const claimA = await clientA.claim(pairA.code, { hostname: "TECNO-PHONE", serialNumber: "PH-SN-1", platform: "android", imei: "354988071234567" });
  if (!claimA?.deviceId) throw new Error("A0: claim failed");
  await scenarioA(clientA, claimA.deviceId);

  // --- B: Laptop ---
  const pairB = await api("/api/pair/register", { label: "LAPTOP-1" });
  const clientB = new SyncClient(BASE);
  const claimB = await clientB.claim(pairB.code, { hostname: "HP-ELITEBOOK", serialNumber: "SN-HP-2026", platform: "win32" });
  await scenarioB(clientB, claimB.deviceId);

  // --- C: Reset/resale on the phone from A (re-lost first) ---
  await api(`/api/devices/${claimA.deviceId}/lost`, { lost: true });
  await scenarioC(null, claimA.deviceId, pairA.code);

  console.log("\n== THEFT LAB PASSED — all three scenarios ==\n");
  stopServer();
})().then(
  () => {},
  (e) => {
    console.error("THEFT LAB FAILED:", e.message);
    stopServer();
    process.exit(1);
  },
);
