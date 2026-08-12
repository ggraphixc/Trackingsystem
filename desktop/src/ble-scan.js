const { exec } = require("child_process");
const path = require("path");

/**
 * Desktop BLE scanner — the laptop becomes a community finder.
 *
 * The desktop agent's own Bluetooth radio listens for TrackNaija beacons
 * (service UUID 0000fffa…) — the same rotating beacon IDs the Android agent
 * broadcasts while a phone is marked LOST. When the owner walks near their
 * stolen phone (or any lost device), this laptop HEARS it and reports a
 * sighting to the sync server with its own position — the community relay,
 * from a laptop instead of a phone.
 *
 * Implementation: on Windows we drive the native WinRT BluetoothLEAdvertisementWatcher
 * through PowerShell — no extra drivers, no node native modules. The watcher
 * only wakes for BLE advertisements; we filter for our service UUID and read
 * the beacon hex from the service data payload (version byte + 12 hex chars,
 * identical to the Android advertiser in Beacon.kt).
 *
 * macOS/Linux: return an explicit "unsupported" so the UI can say so honestly
 * instead of pretending to scan.
 */
const SERVICE_UUID = "0000fffa-0000-1000-8000-00805f9b34fb";

// The PowerShell script runs a watcher for `durationSec`, collects matching
// advertisements and emits JSON. Uses the WinRT API directly:
//   [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher]
const SCAN_PS1 = path.join(__dirname, "ble-scan.ps1");

function scanNearby(durationSec = 10) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ supported: false, beacons: [], reason: "unsupported" });
      return;
    }
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${SCAN_PS1}" -Duration ${Math.max(
        3,
        Math.min(30, durationSec),
      )}`,
      { timeout: 90000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          // Bluetooth adapter missing/off, or WinRT unavailable.
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

module.exports = { scanNearby, SERVICE_UUID };
