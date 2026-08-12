/* Temporary smoke test — boots the real dashboard window and verifies the
 * renderer DOM (nav views, stat cards) and that app.js ran without throwing.
 * Run: npx electron smoke-test.js
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

app.whenReady().then(() => {
  // Stub the main-process IPC the renderer calls during init — in the real
  // app these are registered in src/main.js. Without them, init() can't
  // finish and the nav listeners never attach.
  ipcMain.handle("agent:get-state", () => ({}));
  ipcMain.handle("agent:get-info", () => ({
    hostname: "smoke-host",
    serialNumber: "SN-SMOKE",
    platformLabel: "Windows",
    release: "11",
    username: "tester",
    cpu: "Test CPU",
    totalMemGb: 8,
    uptimeH: 1,
  }));
  ipcMain.handle("agent:link-status", () => ({ linked: false, online: false, serverUrl: "" }));
  ipcMain.handle("agent:vault-status", () => ({ pending: 0, evidence: 0 }));
  ipcMain.handle("agent:list-devices", () => ({ ok: false, devices: [] }));
  ipcMain.handle("agent:get-alerts", () => ({ ok: false, alerts: [] }));
  ipcMain.handle("agent:get-sightings", () => ({ ok: false, sightings: [] }));
  ipcMain.handle("agent:get-evidence", () => ({ ok: false, evidence: [] }));
  ipcMain.handle("agent:track-now", () => null);

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) errors.push(message); // error / warning
  });

  win.loadFile(path.join(__dirname, "src", "renderer", "index.html")).then(() => {
    setTimeout(async () => {
      try {
        // Exercise the map view: click the Map nav item, let Leaflet init.
        await win.webContents.executeJavaScript(`(() => {
          const item = document.querySelector('.nav-item[data-view="map"]');
          if (item) item.click();
          return !!item;
        })()`);
        await new Promise((r) => setTimeout(r, 1500));
        const report = await win.webContents.executeJavaScript(`(() => {
          const q = (s) => document.querySelectorAll(s).length;
          const view = (id) => !!document.getElementById(id);
          const active = document.querySelector('.view.active');
          return {
            navItems: q('.nav-item'),
            views: q('.view'),
            statCards: q('.stat-card'),
            activeView: active ? active.id : null,
            hasDevicesTable: view('devices-table'),
            hasFinderBtn: view('btn-scan'),
            hasAlertsFeed: view('alerts-feed'),
            hasMapView: view('view-map') && view('map-canvas') && view('btn-map-refresh') && view('btn-map-fit'),
            leafletLoaded: typeof window.L === 'object' && typeof window.L.map === 'function',
            mapInitialized: !!document.querySelector('#map-canvas.leaflet-container'),
            mapActive: !!document.getElementById('view-map').classList.contains('active'),
            hasEvidenceModal: view('evidence-modal') && view('evidence-grid') && view('lightbox'),
            mapLegendItems: q('.legend-item'),
            statusChip: (document.getElementById('status-chip')||{}).textContent || '',
            bridge: typeof window.tracknaija === 'object' && typeof window.tracknaija.listDevices === 'function',
            ladderRows: q('.ladder-row'),
            deviceHostname: (document.getElementById('device-hostname')||{}).textContent || '',
          };
        })()`);
        const pass =
          report.navItems === 6 &&
          report.views === 6 &&
          report.statCards === 3 &&
          report.activeView === "view-map" && // navigated to the map during the test
          report.hasDevicesTable &&
          report.hasFinderBtn &&
          report.hasAlertsFeed &&
          report.hasMapView &&
          report.leafletLoaded &&
          report.mapInitialized &&
          report.mapActive &&
          report.hasEvidenceModal &&
          report.mapLegendItems === 4 &&
          report.bridge &&
          report.ladderRows === 3;
        console.log("SMOKE_RESULT " + JSON.stringify(report, null, 1));
        console.log("RENDERER_ERRORS " + JSON.stringify(errors));
        console.log(pass ? "SMOKE_PASS" : "SMOKE_FAIL");
        app.exit(pass ? 0 : 1);
      } catch (err) {
        console.log("SMOKE_FAIL " + err.message);
        app.exit(1);
      }
    }, 3000);
  });
});
