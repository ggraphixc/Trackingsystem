const { contextBridge, ipcRenderer } = require("electron");

/** Safe, minimal bridge between the agent UI and the Electron main process. */
contextBridge.exposeInMainWorld("tracknaija", {
  getDeviceInfo: () => ipcRenderer.invoke("agent:get-info"),
  trackNow: () => ipcRenderer.invoke("agent:track-now"),
  getState: () => ipcRenderer.invoke("agent:get-state"),
  setLostMode: (on) => ipcRenderer.invoke("agent:set-lost-mode", on),
  setAutoStart: (on) => ipcRenderer.invoke("agent:set-autostart", on),
  setServer: (url) => ipcRenderer.invoke("agent:set-server", url),
  claim: (code) => ipcRenderer.invoke("agent:claim", code),
  linkStatus: () => ipcRenderer.invoke("agent:link-status"),
  lockScreen: () => ipcRenderer.invoke("agent:lock-screen"),
  playAlarm: () => ipcRenderer.invoke("agent:play-alarm"),
  webcamCaptured: (dataUrl) => ipcRenderer.invoke("agent:webcam-captured", dataUrl),
  vaultStatus: () => ipcRenderer.invoke("agent:vault-status"),
  listDevices: () => ipcRenderer.invoke("agent:list-devices"),
  setDeviceLost: (deviceId, lost) => ipcRenderer.invoke("agent:set-device-lost", deviceId, lost),
  getSightings: (deviceId) => ipcRenderer.invoke("agent:get-sightings", deviceId),
  getEvidence: (deviceId) => ipcRenderer.invoke("agent:get-evidence", deviceId),
  scanNearby: (durationSec) => ipcRenderer.invoke("agent:scan-nearby", durationSec),
  getAlerts: () => ipcRenderer.invoke("agent:get-alerts"),
  markAlertRead: (id) => ipcRenderer.invoke("agent:mark-alert-read", id),
  openUrl: (url) => ipcRenderer.invoke("agent:open-url", url),
  onState: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on("agent:state", listener);
    return () => ipcRenderer.removeListener("agent:state", listener);
  },
  onFix: (cb) => {
    const listener = (_e, fix) => cb(fix);
    ipcRenderer.on("agent:fix", listener);
    return () => ipcRenderer.removeListener("agent:fix", listener);
  },
  onVault: (cb) => {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on("agent:vault", listener);
    return () => ipcRenderer.removeListener("agent:vault", listener);
  },
  onWebcamCommand: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("agent:command:webcam", listener);
    return () => ipcRenderer.removeListener("agent:command:webcam", listener);
  },
  onAlert: (cb) => {
    const listener = (_e, alert) => cb(alert);
    ipcRenderer.on("agent:alert", listener);
    return () => ipcRenderer.removeListener("agent:alert", listener);
  },
});
