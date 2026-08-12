const { exec } = require("child_process");
const path = require("path");

/**
 * Desktop BLE scanner — the laptop becomes a community finder.
 *
 * The desktop agent's own Bluetooth radio listens for Dravex beacons
 * (service UUID 0000fffa…) — the same rotating beacon IDs the Android agent
 * broadcasts while a phone is marked LOST. When the owner walks near their
 * stolen phone (or any lost device), this laptop HEARS it and reports a
 * sighting to the sync server with its own position — the community relay,
 * from a laptop instead of a phone.
 *
 * Platform backends (all emit the same JSON shape: [{ beacon, rssi }]):
 *   Windows — native WinRT BluetoothLEAdvertisementWatcher via PowerShell
 *             (ble-scan.ps1); no drivers, no native node modules.
 *   macOS   — CoreBluetooth CentralManager via a small Swift helper compiled
 *             on demand with `swiftc` (ble-scan-macos.swift), cached in the
 *             app userData dir.
 *   Linux   — parses the raw HCI advertisement dump from BlueZ `btmon`
 *             (ble-scan-linux.sh); requires the `bluetooth` group / root.
 * Anything missing degrades to an explicit "unsupported" reason — the UI
 * says so honestly instead of pretending to scan.
 */
const SERVICE_UUID = "0000fffa-0000-1000-8000-00805f9b34fb";

const SCAN_PS1 = path.join(__dirname, "ble-scan.ps1");
const MACOS_HELPER = path.join(__dirname, "ble-scan-macos.swift");
const LINUX_SCRIPT = path.join(__dirname, "ble-scan-linux.sh");

/** Directory to cache the compiled macOS helper (set by main.js). */
let helperCacheDir = path.join(require("os").tmpdir(), "dravex-ble");
function setHelperCacheDir(dir) {
  helperCacheDir = dir;
}

/* --------------------------- Windows (WinRT) --------------------------- */

function scanWindows(durationSec) {
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${SCAN_PS1}" -Duration ${Math.max(
        3,
        Math.min(30, durationSec),
      )}`,
      { timeout: 90000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({ supported: true, beacons: [], reason: String(err.message || err).split("\n")[0] });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim().split("\n").pop());
          resolve({ supported: true, beacons: Array.isArray(parsed) ? parsed : [], reason: null });
        } catch (_) {
          resolve({ supported: true, beacons: [], reason: "parse" });
        }
      },
    );
  });
}

/* ---------------------------- macOS (Swift) ---------------------------- */

function scanMacOS(durationSec) {
  return new Promise((resolve) => {
    // Compile once: a tiny CoreBluetooth scanner (no npm native modules).
    const bin = path.join(helperCacheDir, "dravex-ble-scan");
    const compile = () =>
      new Promise((res) => {
        const fs = require("fs");
        try {
          fs.mkdirSync(helperCacheDir, { recursive: true });
        } catch (_) {
          /* ignore */
        }
        exec(
          `xcrun -sdk macosx swiftc -O "${MACOS_HELPER}" -o "${bin}"`,
          { timeout: 120000 },
          (e) => res(!e),
        );
      });

    const run = () =>
      new Promise((res) => {
        exec(`"${bin}" ${Math.max(3, Math.min(30, durationSec))}`, { timeout: 60000 }, (err, stdout) => {
          if (err) {
            res({ supported: true, beacons: [], reason: String(err.message || err).split("\n")[0] });
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim().split("\n").pop());
            res({ supported: true, beacons: Array.isArray(parsed) ? parsed : [], reason: null });
          } catch (_) {
            res({ supported: true, beacons: [], reason: "parse" });
          }
        });
      });

    const fs = require("fs");
    if (fs.existsSync(bin)) {
      run().then(resolve);
    } else {
      compile().then((ok) => (ok ? run().then(resolve) : resolve({ supported: true, beacons: [], reason: "swiftc" })));
    }
  });
}

/* ---------------------------- Linux (btmon) ---------------------------- */

function scanLinux(durationSec) {
  return new Promise((resolve) => {
    exec(
      `timeout ${Math.max(3, Math.min(30, durationSec)) + 4}s bash "${LINUX_SCRIPT}" ${Math.max(3, Math.min(30, durationSec))}`,
      { timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({ supported: true, beacons: [], reason: String(err.message || err).split("\n")[0] });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim().split("\n").pop());
          resolve({ supported: true, beacons: Array.isArray(parsed) ? parsed : [], reason: null });
        } catch (_) {
          resolve({ supported: true, beacons: [], reason: "parse" });
        }
      },
    );
  });
}

function scanNearby(durationSec = 10) {
  if (process.platform === "win32") return scanWindows(durationSec);
  if (process.platform === "darwin") return scanMacOS(durationSec);
  if (process.platform === "linux") return scanLinux(durationSec);
  return Promise.resolve({ supported: false, beacons: [], reason: "unsupported" });
}

module.exports = { scanNearby, SERVICE_UUID, setHelperCacheDir };
