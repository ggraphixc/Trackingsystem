/**
 * Community BLE beacon — shared identity logic.
 *
 * A paired TrackNaija agent (Android phone, and later laptops) broadcasts a
 * short, pseudonymous beacon ID over Bluetooth LE. Any OTHER TrackNaija phone
 * that hears it reports a "sighting" with its own GPS position — the owner's
 * dashboard then learns "your phone was seen near this coordinate", even
 * though the stolen phone itself has no data/Wi-Fi.
 *
 * The beacon ID is derived from the deviceId + the current day bucket, so it
 * ROTATES daily: a listener cannot follow a device across days, and a beacon
 * ID from last week cannot be replayed today. The dashboard/server is the
 * only party that can map a beacon back to a device (it knows deviceIds).
 *
 *   beacon = hex(sha256(deviceId + "|" + dayBucket))[0..12]
 *
 * The Android agent (Beacon.kt) implements the same hash — keep them in sync.
 */
const crypto = require("crypto");

const DAY_MS = 86_400_000;
const BEACON_LEN = 12; // 48 bits — negligible collision risk at app scale

function dayBucket(now = Date.now()) {
  return Math.floor(now / DAY_MS);
}

/** The beacon a device broadcasts on a given day. */
function beaconFor(deviceId, now = Date.now()) {
  return crypto
    .createHash("sha256")
    .update(`${deviceId}|${dayBucket(now)}`)
    .digest("hex")
    .slice(0, BEACON_LEN);
}

/**
 * Reverse-lookup: given a heard beacon, find the device broadcasting it.
 * Checks today and yesterday (a scanner may report a sighting that crossed
 * midnight). Returns the device record or null — callers must NEVER reveal
 * whether a beacon is known, so anonymous scanners cannot probe the network.
 */
function resolveBeacon(store, beacon, now = Date.now()) {
  const norm = String(beacon || "").toLowerCase().trim();
  if (!norm) return null;
  const buckets = [dayBucket(now), dayBucket(now) - 1];
  for (const bucket of buckets) {
    for (const id of Object.keys(store.devices)) {
      if (beaconFor(id, bucket * DAY_MS) === norm) return store.devices[id];
    }
  }
  return null;
}

module.exports = { beaconFor, resolveBeacon, dayBucket };
