package com.tracknaija.agent

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Community BLE beacon — the Tile-style "every user finds every user" network.
 *
 * A paired phone broadcasts a short pseudonymous beacon ID over Bluetooth LE
 * (advertising works with the SIM out and data/Wi-Fi off — the exact window
 * where a stolen phone is being used or sits in a repair shop). Any OTHER
 * TrackNaija phone that hears it reports a sighting with its own GPS position,
 * so the owner learns where the phone was last seen without the phone itself
 * having any connectivity.
 *
 * The beacon ID rotates daily (derived from deviceId + day bucket), so a
 * listener cannot track a phone across days — see server/beacon.js for the
 * matching hash. This phone both ADVERTISES its own beacon and SCANS for
 * others' beacons, duty-cycled to protect the battery.
 *
 * Honest limits (mirrored in docs/OFFLINE_TRACKING.md):
 *  - A fully powered-off phone emits no Bluetooth — this network only works
 *    while the phone is on (no SIM/data needed).
 *  - iOS does not allow background BLE advertising from third-party apps, so
 *    the community relay is Android-to-Android for now.
 *  - OEM battery managers (Samsung, Tecno, etc.) may kill background scans
 *    unless the user exempts the app from battery optimization.
 */
object Beacon {

    // Custom service UUID used ONLY for app-to-app beaconing. Kept in the
    // "vendor/experimental" range so it never collides with a real device
    // service. The service DATA carries the beacon ID (ASCII hex).
    const val SERVICE_UUID = "0000fffa-0000-1000-8000-00805f9b34fb"

    private val PARCEL_UUID = ParcelUuid.fromString(SERVICE_UUID)

    private const val DAY_MS = 86_400_000L
    private const val BEACON_LEN = 12

    /** sha256 hex, truncated to [BEACON_LEN] — must match server/beacon.js. */
    fun idFor(deviceId: String): String {
        val bucket = System.currentTimeMillis() / DAY_MS
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$deviceId|$bucket".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }.take(BEACON_LEN)
    }

    /** Is BLE advertising available + permitted on this phone right now? */
    fun canAdvertise(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) !=
                PackageManager.PERMISSION_GRANTED
            ) return false
        }
        return adapter(context)?.isMultipleAdvertisementSupported == true
    }

    fun canScan(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) !=
                PackageManager.PERMISSION_GRANTED
            ) return false
        }
        return adapter(context) != null
    }

    private fun adapter(context: Context): BluetoothAdapter? {
        val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return bm?.adapter?.takeIf { it.isEnabled }
    }

    /* ---------------- advertising (this phone is findable) ---------------- */

    private var advertiser: BluetoothLeAdvertiser? = null
    private var currentBeacon: String? = null

    /**
     * Start broadcasting this device's beacon. Idempotent — if the beacon
     * (day bucket) changed, it restarts with the new ID. Never throws; a
     * phone without BLE or without permission simply stays silent.
     */
    fun startAdvertising(context: Context, deviceId: String) {
        val beacon = idFor(deviceId)
        if (currentBeacon == beacon && advertiser != null) return
        stopAdvertising()

        if (!canAdvertise(context)) return
        val adapter = adapter(context) ?: return
        val leAdvertiser = adapter.bluetoothLeAdvertiser ?: return

        // Version byte (binary) + beacon hex as ASCII bytes in the service
        // data — 13 bytes total, well within the 31-byte advertisement limit.
        val payload = byteArrayOf(0x01) + beacon.toByteArray(Charsets.US_ASCII)
        val data = AdvertiseData.Builder()
            .addServiceUuid(PARCEL_UUID)
            .addServiceData(PARCEL_UUID, payload)
            .build()
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(false)
            .build()

        currentBeacon = beacon
        advertiser = leAdvertiser
        runCatching {
            leAdvertiser.startAdvertising(settings, data, object : AdvertiseCallback() {
                override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
                    // beacon live — nothing else to do
                }

                override fun onStartFailure(errorCode: Int) {
                    advertiser = null
                    currentBeacon = null
                }
            })
        }
    }

    fun stopAdvertising() {
        runCatching { advertiser?.stopAdvertising(object : AdvertiseCallback() {}) }
        advertiser = null
        currentBeacon = null
    }

    /* ---------------- scanning (finding OTHER lost devices) ---------------- */

    private var scanning = false

    /**
     * Scan for TrackNaija beacons for up to [durationMs]. Returns the beacon
     * IDs heard (deduplicated). Call from a background thread — the scan
     * callback runs on the main looper; use a CountDownLatch to bridge.
     */
    fun scanOnce(context: Context, durationMs: Long): List<String> {
        if (scanning) return emptyList()
        if (!canScan(context)) return emptyList()
        val adapter = adapter(context) ?: return emptyList()
        val leScanner = adapter.bluetoothLeScanner ?: return emptyList()

        val found = LinkedHashSet<String>()
        val latch = java.util.concurrent.CountDownLatch(1)

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val bytes = result.scanRecord?.getServiceData(PARCEL_UUID) ?: return
                // Explicit toInt() — never compare Byte against an Int literal
                // (no implicit widening; the two would never compare equal).
                if (bytes.size != 13 || bytes[0].toInt() != 0x01) return // version 1
                val beacon = String(bytes, 1, 12, Charsets.US_ASCII)
                if (beacon.matches(Regex("[0-9a-f]{12}"))) found.add(beacon)
            }

            override fun onScanFailed(errorCode: Int) {
                latch.countDown()
            }
        }

        val filter = ScanFilter.Builder().setServiceUuid(PARCEL_UUID).build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
            .build()

        scanning = true
        runCatching { leScanner.startScan(listOf(filter), settings, callback) }

        Thread {
            Thread.sleep(durationMs)
            runCatching { leScanner.stopScan(callback) }
            scanning = false
            latch.countDown()
        }.start()

        try {
            latch.await(durationMs + 5_000, java.util.concurrent.TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
            // give up — caller will see whatever was found so far
        }
        return found.toList()
    }

    /** Build the sighting payload for a heard beacon using this phone's fix. */
    fun sightingJson(beacon: String, fix: JSONObject?): JSONObject? {
        if (fix == null || !fix.has("lat") || !fix.has("lng")) return null
        return JSONObject()
            .put("beacon", beacon)
            .put("lat", fix.getDouble("lat"))
            .put("lng", fix.getDouble("lng"))
            .put("accuracy", fix.optDouble("accuracy", 50.0))
            .put("at", java.time.Instant.now().toString())
    }
}
