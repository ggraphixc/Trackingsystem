const { BrowserWindow, Tray, Menu, nativeImage, app } = require("electron");
const fs = require("fs");
const path = require("path");

/**
 * UI module — owns the agent window and the tray. Kept separate from main.js
 * so the entry point stays focused on wiring (engine, sync, vault, IPC).
 */
const DEV = process.argv.includes("--dev");

let mainWindow = null;
let tray = null;
let trayState = { lostMode: false };
let onToggleLost = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "TrackNaija Agent",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../assets/tracknaija.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // The agent UI is a dashboard, not a browser — keep it focused.
  if (!DEV) mainWindow.setMenuBarVisibility(false);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}

function createTray({ lostMode, onToggleLost: toggle }) {
  trayState.lostMode = !!lostMode;
  onToggleLost = toggle;

  const iconPath = path.join(__dirname, "../assets/tracknaija.png");
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("TrackNaija Agent — your laptop is protected");
  rebuildTrayMenu();
  tray.on("click", openAgent);
}

/** Called by main.js when lost mode changes so the tray label stays honest. */
function updateTray({ lostMode }) {
  trayState.lostMode = !!lostMode;
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "Open TrackNaija",
      click: () => openAgent(),
    },
    {
      label: trayState.lostMode ? "Disable lost mode" : "Enable lost mode",
      click: () => {
        if (onToggleLost) onToggleLost();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

/** Show the agent window, recreating it if it was closed (close-to-tray). */
function openAgent() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  else createWindow();
}

function getWindow() {
  return mainWindow;
}

module.exports = { createWindow, createTray, updateTray, openAgent, getWindow };
