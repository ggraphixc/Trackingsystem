const { app, ipcMain, session, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const { TrackingEngine } = require("./tracking-engine");
const { SyncClient } = require("./sync-client");
const { OfflineVault } = require("./offline-vault");
const { getDeviceInfo, lockScreen, playAlarm } = require("./commands");
const { createWindow, createTray, updateTray, openAgent, getWindow } = require("./ui");

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
};

function loadState() {
  try {
    if (fs.existsSync(stateFile)) {
      return { ...defaultState, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
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
  try {
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2));
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
  engine = new TrackingEngine(stateFile);
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
            title: `TrackNaija — ${alert.hostname}`,
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
  sync = new SyncClient(url);
  const state = saveState({ serverUrl: url });
  return sync.health().then((h) => ({
    state,
    serverOnline: !!h && h.ok,
  }));
});

ipcMain.handle("agent:claim", async (_e, code) => {
  const info = await getDeviceInfo();
  saveState({ serialNumber: info.serialNumber });
  if (!sync) sync = new SyncClient(loadState().serverUrl);
  const res = await sync.claim(code, info);
  if (res && res.deviceId) {
    const state = saveState({ deviceId: res.deviceId, pairedAt: new Date().toISOString() });
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
    stateFile = path.join(app.getPath("userData"), "agent-state.json");
    vaultFile = path.join(app.getPath("userData"), "offline-vault.json");
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

    sync = new SyncClient(loadState().serverUrl);

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
