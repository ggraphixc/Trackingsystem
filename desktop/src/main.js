const { app, ipcMain, session, Notification, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { TrackingEngine } = require("./tracking-engine");
const { SyncClient } = require("./sync-client");
const { OfflineVault } = require("./offline-vault");
const { scanNearby, setHelperCacheDir } = require("./ble-scan");
const { getDeviceInfo, lockScreen, playAlarm } = require("./commands");
const { createWindow, createTray, updateTray, openAgent, getWindow } = require("./ui");
const { setKeyDir, isBoxed, protectSync, unprotectSync } = require("./secret-store");

// Unboxed credentials, cached in memory after first decrypt. The state JSON
// on disk only ever holds boxed strings (DPAPI / Keychain / XOR fallback).
const secretCache = new Map();
function boxedOrUnbox(value) {
  if (!isBoxed(value)) return value; // plaintext in memory (fresh from claim)
  if (secretCache.has(value)) return secretCache.get(value);
  const plain = unprotectSync(value);
  if (plain !== null) secretCache.set(value, plain);
  return plain; // null = unreadable → treated as absent
}
function boxForStorage(plain) {
  if (!plain || isBoxed(plain)) return plain;
  return protectSync(plain);
}

let lostMode = false;
let stateFile = "";
let vaultFile = "";
let engine = null;
let sync = null;
let vault = null;
let lastCommandId = null;
let seenAlertIds = new Set();

/** Default agent state (persisted as JSON in the app userData dir). */
const defaultState = {
  deviceId: null, // set when the owner links this machine to their dashboard account
  serverUrl: "http://localhost:4173",
  lastFix: null,
  lostMode: false,
  autoStart: false,
  lastSyncAt: null,
  serialNumber: null,
  pairedAt: null,
  deviceToken: null, // agent credential issued at claim (auth mode)
  ownerKey: "", // DRAVEX_OWNER_KEY — only needed when the server enables auth
  sessionToken: "", // Phase 2.5 account session — preferred owner credential
  sessionEmail: "", // display-only: who this machine is signed in as
};

function loadState() {
  try {
    if (fs.existsSync(stateFile)) {
      const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      return {
        ...defaultState,
        ...parsed,
        // Secrets are boxed on disk — decrypt once, cache in memory.
        deviceToken: boxedOrUnbox(parsed.deviceToken),
        ownerKey: boxedOrUnbox(parsed.ownerKey),
        sessionToken: boxedOrUnbox(parsed.sessionToken),
      };
    }
  } catch (err) {
    console.error("Failed to read state:", err.message);
  }
  return { ...defaultState };
}

function sendToWindow(channel, payload) {
  const w = getWindow();
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function saveState(patch) {
  const next = { ...loadState(), ...patch };
  // Never write a plaintext credential to disk — box it first (DPAPI /
  // Keychain / XOR fallback). The persisted copy is boxed; the renderer and
  // callers keep the plaintext in-memory view.
  const persisted = { ...next };
  if (persisted.deviceToken !== undefined) persisted.deviceToken = boxForStorage(persisted.deviceToken);
  if (persisted.ownerKey !== undefined) persisted.ownerKey = boxForStorage(persisted.ownerKey);
  if (persisted.sessionToken !== undefined) persisted.sessionToken = boxForStorage(persisted.sessionToken);
  try {
    fs.writeFileSync(stateFile, JSON.stringify(persisted, null, 2));
  } catch (err) {
    console.error("Failed to save state:", err.message);
  }
  sendToWindow("agent:state", next);
  return next;
}

function sendVaultStatus() {
  if (!vault) return;
  sendToWindow("agent:vault", { pending: vault.count(), evidence: vault.countOf("evidence") });
}

/**
 * Upload the offline vault in one batch — the "the laptop surfaced online"
 * moment. True only when the server accepted every item.
 */
async function flushVault() {
  const state = loadState();
  if (!vault || !sync || !state.deviceId || !sync.configured) return;
  const pending = vault.all();
  if (pending.length === 0) return;

  const queuedAts = new Set(pending.map((i) => i.queuedAt).filter(Boolean));
  const items = pending
    .map((i) => {
      if (i.type === "fix") return { type: "fix", fix: i.payload };
      if (i.type === "evidence" && i.payload && i.payload.dataUrl)
        return { type: "evidence", dataUrl: i.payload.dataUrl };
      if (i.type === "event" && i.payload) return { type: "event", event: i.payload };
      return null;
    })
    .filter(Boolean);
  if (items.length === 0) return;

  const ok = await sync.postBatch(state.deviceId, items);
  if (ok) vault.removeUploaded(queuedAts);
  sendVaultStatus();
}

/** Periodic tracking: keep the last fix fresh while the agent runs. */
function startTrackingLoop() {
  // The engine resolves Wi-Fi fingerprints against the sync server's
  // POST /api/geolocate (Google/Mozilla, cached). No server = honest IP or
  // last-known fallback — never a fabricated coordinate.
  engine = new TrackingEngine(stateFile, (bssids) =>
    sync && sync.configured ? sync.geolocate(bssids) : Promise.resolve(null),
  );
  engine.on("fix", (fix) => {
    const state = saveState({ lastFix: fix });
    sendToWindow("agent:fix", fix);

    // Offline-first: try the server; if unreachable, hold the fix in the
    // vault for burst sync the moment connectivity returns.
    const deviceId = state.deviceId;
    if (sync && deviceId && sync.configured) {
      sync.postFix(deviceId, fix).then((ok) => {
        if (ok) {
          saveState({ lastSyncAt: new Date().toISOString() });
          flushVault(); // online — drain anything captured offline
        } else {
          vault.push("fix", deviceId, fix);
          sendVaultStatus();
        }
      });
    } else if (deviceId) {
      vault.push("fix", deviceId, fix);
      sendVaultStatus();
    }
  });
  engine.start(120000); // every 2 minutes while the agent runs
}

/** Deliver the webcam command once the agent UI can receive it. */
function sendWebcamCommandWhenReady() {
  const w = getWindow();
  if (!w || w.isDestroyed()) return;
  w.show();
  if (w.webContents.isLoading()) {
    w.webContents.once("did-finish-load", () => sendToWindow("agent:command:webcam"));
  } else {
    sendToWindow("agent:command:webcam");
  }
}

/**
 * Surface owner alerts (phone reconnects, SIM changes) in the agent UI.
 * The laptop can't detect a phone's SIM swap itself, but the owner's phone
 * agent reports it to the sync server — this agent shows it immediately,
 * with a native notification for SIM changes (the loudest anti-theft signal).
 */
function startAlertPolling() {
  setInterval(async () => {
    const state = loadState();
    if (!sync || !state.deviceId || !sync.configured) return;
    const data = await sync.getAlerts();
    const alerts = (data && data.alerts) || [];
    for (const alert of alerts) {
      if (seenAlertIds.has(alert.id)) continue;
      seenAlertIds.add(alert.id);
      sendToWindow("agent:alert", alert);
      if (alert.type === "sim_change") {
        try {
          const n = new Notification({
            title: `Dravex — ${alert.hostname}`,
            body: alert.body,
          });
          n.onclick = () => openAgent();
          n.show();
        } catch (_) {
          /* notifications unavailable — banner still shows in the UI */
        }
      }
    }
    // Bound memory on long-running agents: keep only the most recent 100 ids.
    if (seenAlertIds.size > 200) {
      seenAlertIds = new Set([...seenAlertIds].slice(-100));
    }
  }, 15000);
}

/** Poll for remote commands issued from the web dashboard. */
function startCommandPolling() {
  let polling = false; // re-entrancy guard (alarm can run ~15 s > interval)
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const state = loadState();
      if (!sync || !state.deviceId || !sync.configured) return;
      const commands = await sync.getCommands(state.deviceId, lastCommandId);
      for (const cmd of commands || []) {
        lastCommandId = cmd.id;
        try {
          if (cmd.type === "lock") {
            await lockScreen();
          } else if (cmd.type === "alarm") {
            await playAlarm();
          } else if (cmd.type === "webcam") {
            // Ask the agent UI to capture evidence (it owns the camera). If
            // the window was closed (close-to-tray), openAgent recreates it
            // — defer the command until the renderer has attached its
            // listener, otherwise the event is dropped.
            openAgent();
            sendWebcamCommandWhenReady();
          }
          await sync.ackCommand(state.deviceId, cmd.id);
        } catch (_) {
          // Never let a command failure kill the poller.
        }
      }
    } finally {
      polling = false;
    }
  }, 10000);
}

/* ---------------- IPC ---------------- */

ipcMain.handle("agent:get-info", async () => {
  const info = await getDeviceInfo();
  saveState({ serialNumber: info.serialNumber });
  return info;
});

ipcMain.handle("agent:set-server", (_e, url) => {
  // Restore ALL credentials: the account session, the owner key and the
  // device token (re-pointing the URL must not drop any of them).
  const st = loadState();
  sync = new SyncClient(url)
    .setOwnerKey(st.ownerKey)
    .setSessionToken(st.sessionToken)
    .setDeviceToken(st.deviceToken);
  const state = saveState({ serverUrl: url });
  return sync.health().then((h) => ({
    state,
    serverOnline: !!h && h.ok,
  }));
});

/** Owner key for servers that enable DRAVEX_OWNER_KEY (stored on this machine). */
ipcMain.handle("agent:set-owner-key", (_e, key) => {
  const clean = String(key || "").trim().slice(0, 128);
  const state = saveState({ ownerKey: clean });
  if (sync) sync.setOwnerKey(clean);
  return { ownerKey: state.ownerKey || "" };
});

/**
 * Phase 2.5 account login: POST /api/auth/login with the server this agent
 * is pointed at, store the session (boxed at rest) and the email for the
 * Settings view. Owner-scoped calls now use the session (per-owner model).
 */
ipcMain.handle("agent:login", async (_e, email, password) => {
  if (!sync) sync = new SyncClient(loadState().serverUrl).setOwnerKey(loadState().ownerKey).setDeviceToken(loadState().deviceToken);
  const res = await sync.login(email, password);
  if (res && res.ok && res.user) {
    saveState({ sessionToken: res.user.token || "", sessionEmail: res.user.email || "" });
    return { ok: true, email: res.user.email };
  }
  return { ok: false, error: (res && res.error) || "Login failed — is the server reachable?" };
});

/** Phase 2.5 account logout: invalidate the server session + clear locally. */
ipcMain.handle("agent:logout", async () => {
  if (sync) await sync.logout();
  saveState({ sessionToken: "", sessionEmail: "" });
  return { ok: true };
});

ipcMain.handle("agent:claim", async (_e, code) => {
  const info = await getDeviceInfo();
  saveState({ serialNumber: info.serialNumber });
  if (!sync) sync = new SyncClient(loadState().serverUrl).setOwnerKey(loadState().ownerKey).setSessionToken(loadState().sessionToken);
  const res = await sync.claim(code, info);
  if (res && res.deviceId) {
    // Store the agent credential issued at claim so device-scoped calls stay
    // authorized when the server enables DRAVEX_OWNER_KEY.
    if (res.token) sync.setDeviceToken(res.token);
    const state = saveState({
      deviceId: res.deviceId,
      pairedAt: new Date().toISOString(),
      deviceToken: res.token || null,
    });
    flushVault(); // freshly linked — upload anything queued before pairing
    return { ok: true, deviceId: res.deviceId, state };
  }
  return { ok: false, error: "Pairing failed — check the code and that the sync server is running." };
});

ipcMain.handle("agent:link-status", () => {
  const state = loadState();
  const online = sync ? !!sync.configured : false;
  return { serverUrl: state.serverUrl, deviceId: state.deviceId, linked: !!state.deviceId, online };
});

ipcMain.handle("agent:track-now", async () => {
  return engine ? engine.trackNow() : null;
});

ipcMain.handle("agent:get-state", () => loadState());

ipcMain.handle("agent:vault-status", () => {
  if (!vault) return { pending: 0, evidence: 0 };
  return { pending: vault.count(), evidence: vault.countOf("evidence") };
});

ipcMain.handle("agent:set-lost-mode", (_e, on) => {
  lostMode = !!on;
  const state = saveState({ lostMode });
  updateTray({ lostMode });
  // When lost mode enables, immediately try to locate + capture evidence.
  if (lostMode && engine) {
    engine.trackNow().then((fix) => {
      if (fix) saveState({ lastFix: fix }); // never clobber last-known with null
    });
  }
  return state;
});

ipcMain.handle("agent:set-autostart", (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return saveState({ autoStart: !!on });
});

ipcMain.handle("agent:lock-screen", () => lockScreen());
ipcMain.handle("agent:play-alarm", () => playAlarm());

/* ---------------- tracking dashboard IPC ---------------- */

/** All paired devices (phones + laptops) — the command-center view. */
ipcMain.handle("agent:list-devices", async () => {
  const state = loadState();
  if (!sync || !state.deviceId || !sync.configured) return { ok: false, devices: [], reason: "not-linked" };
  const res = await sync.listDevices();
  // The server's GET /api/devices returns a bare array; tolerate both shapes.
  const list = Array.isArray(res) ? res : (res && res.devices) || [];
  return { ok: Array.isArray(res) || !!res, devices: list };
});

/** Owner flips a phone/laptop between lost and found from the desktop. */
ipcMain.handle("agent:set-device-lost", async (_e, deviceId, lost) => {
  if (!sync || !sync.configured) return { ok: false };
  const res = await sync.setDeviceLost(deviceId, !!lost);
  // Pass the recovery code through: the owner needs it to unlock the device's
  // app-level ownership check if the phone comes back to them.
  return { ok: !!res, recoveryCode: res ? res.recoveryCode : null };
});

/** Ownership handover: rotate credential, clear registry, issue new code. */
ipcMain.handle("agent:transfer-device", async (_e, deviceId) => {
  if (!sync || !sync.configured) return { ok: false };
  const res = await sync.transferDevice(deviceId);
  return { ok: !!res, code: res ? res.code : null };
});

/** Owner confirms the device is back ("Verified → Recovered" lifecycle). */
ipcMain.handle("agent:verify-device", async (_e, deviceId) => {
  if (!sync || !sync.configured) return { ok: false };
  const res = await sync.verifyDevice(deviceId);
  return { ok: !!res };
});

/** Community sightings for one device (newest first). */
ipcMain.handle("agent:get-sightings", async (_e, deviceId) => {
  if (!sync || !sync.configured) return { ok: false, sightings: [] };
  const res = await sync.getSightings(deviceId);
  // The server returns a bare array for sightings; tolerate both shapes.
  const list = Array.isArray(res) ? res : (res && res.sightings) || [];
  return { ok: Array.isArray(res) || !!res, sightings: list };
});

/**
 * BLE sweep: this laptop's own radio listens for Dravex beacons.
 * Every heard beacon is reported to the sync server as a sighting with THIS
 * machine's position (fresh fix when possible, else last known) — the laptop
 * joins the community relay alongside phones.
 */
ipcMain.handle("agent:scan-nearby", async (_e, durationSec) => {
  const result = await scanNearby(durationSec || 10);
  if (!result.supported) return result;
  if (!sync || !sync.configured || result.beacons.length === 0) return result;

  // Position for the sighting: prefer a fresh fix, fall back to last known.
  let fix = null;
  if (engine) fix = await engine.trackNow().catch(() => null);
  if (!fix) fix = (loadState().lastFix || null);
  if (!fix) return result; // no position — report nothing rather than lie

  let reported = 0;
  for (const b of result.beacons) {
    const ok = await sync.postSighting({
      beacon: b.beacon,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy || null,
      source: "ble",
      rssi: b.rssi || null,
    });
    if (ok) reported++;
  }
  return { ...result, reported, at: { lat: fix.lat, lng: fix.lng } };
});

/** Webcam evidence photos for a device (newest first). */
ipcMain.handle("agent:get-evidence", async (_e, deviceId) => {
  if (!sync || !sync.configured) return { ok: false, evidence: [] };
  const res = await sync.getEvidence(deviceId);
  // The server returns a bare array for evidence; tolerate both shapes.
  const list = Array.isArray(res) ? res : (res && res.evidence) || [];
  return { ok: Array.isArray(res) || !!res, evidence: list };
});

/**
 * Everything the incident report needs, in one round-trip: device detail,
 * fix history, sightings and evidence (each endpoint is array-shaped).
 */
ipcMain.handle("agent:get-device-detail", async (_e, deviceId) => {
  if (!sync || !sync.configured || !deviceId) return { ok: false };
  const [dev, fixes, evidence, sightings] = await Promise.all([
    sync.getDevice(deviceId),
    sync.getFixes(deviceId, 30),
    sync.getEvidence(deviceId),
    sync.getSightings(deviceId),
  ]);
  return {
    ok: !!dev,
    device: dev || null,
    fixes: Array.isArray(fixes) ? fixes : (fixes && fixes.fixes) || [],
    evidence: Array.isArray(evidence) ? evidence : (evidence && evidence.evidence) || [],
    sightings: Array.isArray(sightings) ? sightings : (sightings && sightings.sightings) || [],
  };
});

/** Report header details (owner name, phone, police station) for incident reports. */
ipcMain.handle("agent:get-report-info", () => {
  const s = loadState();
  return {
    ownerName: s.reportOwner || "",
    ownerPhone: s.reportPhone || "",
    policeStation: s.reportStation || "",
  };
});

ipcMain.handle("agent:set-report-info", (_e, info) => {
  const clean = (v) => String(v || "").trim().slice(0, 120);
  const s = saveState({
    reportOwner: clean(info && info.ownerName),
    reportPhone: clean(info && info.ownerPhone),
    reportStation: clean(info && info.policeStation),
  });
  return {
    ownerName: s.reportOwner || "",
    ownerPhone: s.reportPhone || "",
    policeStation: s.reportStation || "",
  };
});

/** Write a generated report to Downloads and open it in the browser. */
ipcMain.handle("agent:save-report", async (_e, html, filename) => {
  try {
    // The renderer always prefixes with "Dravex-Report-", so reserved
  // Windows device names (CON/NUL/…) can never be the whole filename.
  const safeName = String(filename || "dravex-report.html").replace(/[^a-zA-Z0-9._-]/g, "-");
    const dir = app.getPath("downloads");
    const outPath = path.join(dir, safeName);
    fs.writeFileSync(outPath, String(html), "utf8");
    await shell.openPath(outPath);
    return { ok: true, path: outPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/** Full alert list for the dashboard feed (main.js pushes new ones live). */
ipcMain.handle("agent:get-alerts", async () => {
  if (!sync || !sync.configured) return { ok: false, alerts: [] };
  const res = await sync.getAlerts();
  return { ok: !!res, alerts: (res && res.alerts) || [] };
});

/** Dismiss an alert in the dashboard feed (or all with no id). */
ipcMain.handle("agent:mark-alert-read", async (_e, id) => {
  if (!sync || !sync.configured) return { ok: false };
  const res = await sync.markAlertRead(id || null);
  return { ok: !!res };
});

/** Open the web dashboard (same server) in the default browser. */
ipcMain.handle("agent:open-url", (_e, url) => {
  try {
    shell.openExternal(String(url || ""));
    return { ok: true };
  } catch (_) {
    return { ok: false };
  }
});

ipcMain.handle("agent:webcam-captured", async (_e, dataUrl) => {
  const state = saveState({ lastCaptureAt: new Date().toISOString() });
  // Upload the evidence photo; if offline, hold it in the vault.
  const deviceId = state.deviceId;
  if (sync && deviceId && sync.configured) {
    const ok = await sync.postEvidence(deviceId, dataUrl);
    if (!ok) vault.push("evidence", deviceId, { dataUrl, capturedAt: new Date().toISOString() });
  } else if (deviceId) {
    vault.push("evidence", deviceId, { dataUrl, capturedAt: new Date().toISOString() });
  }
  sendVaultStatus();
  return state;
});

/* ---------------- lifecycle ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = getWindow();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(() => {
    // Dravex rebrand: on first run after the rename, carry over pairing state
    // and the offline vault from the old "tracknaija-agent" userData dir so
    // already-linked machines don't silently un-pair or lose evidence.
    const userDataDir = app.getPath("userData");
    try {
      if (!fs.existsSync(userDataDir)) {
        const legacy = path.join(app.getPath("appData"), "tracknaija-agent");
        if (fs.existsSync(legacy)) {
          fs.mkdirSync(userDataDir, { recursive: true });
          for (const f of ["agent-state.json", "offline-vault.json"]) {
            const src = path.join(legacy, f);
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(userDataDir, f));
          }
          console.log("Migrated agent state from tracknaija-agent →", userDataDir);
        }
      }
    } catch (err) {
      console.error("State migration failed:", err.message);
    }
    stateFile = path.join(userDataDir, "agent-state.json");
    vaultFile = path.join(userDataDir, "offline-vault.json");
    setKeyDir(userDataDir); // secret-store: DPAPI/Keychain/XOR key file lives here
    setHelperCacheDir(userDataDir); // ble-scan: compiled macOS helper cache
    vault = new OfflineVault(vaultFile);

    const state = loadState();
    lostMode = state.lostMode;

    // Only auto-launch if the owner explicitly opted in (never silently).
    app.setLoginItemSettings({ openAtLogin: !!state.autoStart });

    // The agent UI may use the webcam (lost mode, manual capture). Electron
    // denies getUserMedia without a permission handler; grant only media and
    // only for our own window. The UI only ever asks with visible consent.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(permission === "media" && wc === getWindow()?.webContents);
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission) => {
      return permission === "media" && wc === getWindow()?.webContents;
    });

    const bootState = loadState();
    sync = new SyncClient(bootState.serverUrl)
      .setOwnerKey(bootState.ownerKey)
      .setSessionToken(bootState.sessionToken)
      .setDeviceToken(bootState.deviceToken);

    // Refresh the signed-in account at boot: keeps sessionEmail accurate and
    // clears a stale session (e.g. after the server's session store reset).
    if (bootState.sessionToken) {
      sync.me().then((m) => {
        if (m && m.ok && m.user && m.user.email) {
          saveState({ sessionEmail: m.user.email });
        } else if (m && !m.ok) {
          saveState({ sessionToken: "", sessionEmail: "" });
        }
      });
    }

    createWindow();
    createTray({
      lostMode,
      onToggleLost: () => {
        // saveState already pushes agent:state to the renderer.
        lostMode = !lostMode;
        saveState({ lostMode });
        updateTray({ lostMode });
      },
    });
    startTrackingLoop();
    startCommandPolling();
    startAlertPolling();

    app.on("activate", () => {
      const { BrowserWindow } = require("electron");
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // Keep the agent in the tray; only quit explicitly.
    if (process.platform !== "darwin") {
      // stay resident — tray keeps the agent alive
    }
  });
}
