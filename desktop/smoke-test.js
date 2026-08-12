/* Temporary smoke test — boots the real dashboard window and verifies the
 * renderer DOM (nav views, stat cards) and that app.js ran without throwing.
 * Run: npx electron smoke-test.js
 */
const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(() => {
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
            statusChip: (document.getElementById('status-chip')||{}).textContent || '',
            bridge: typeof window.tracknaija === 'object' && typeof window.tracknaija.listDevices === 'function',
            ladderRows: q('.ladder-row'),
            deviceHostname: (document.getElementById('device-hostname')||{}).textContent || '',
          };
        })()`);
        const pass =
          report.navItems === 5 &&
          report.views === 5 &&
          report.statCards === 3 &&
          report.activeView === "view-overview" &&
          report.hasDevicesTable &&
          report.hasFinderBtn &&
          report.hasAlertsFeed &&
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
