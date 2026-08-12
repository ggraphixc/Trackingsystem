package com.tracknaija.agent

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.telephony.CellIdentityGsm
import android.telephony.CellIdentityLte
import android.telephony.CellIdentityNr
import android.telephony.CellIdentityWcdma
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * The phone "signal ladder" — mirrors the desktop engine.
 *
 * Best signal first:
 *   1. GPS / fused location (play-services) — accurate outdoors
 *   2. Wi-Fi / cell (fused provider already blends these) — indoor fallback
 *   3. Last known fix — honest answer when nothing fresh is available
 *
 * Every fix records accuracy, source and battery so the dashboard can show
 * an honest confidence score.
 */
class SignalLadder(private val context: Context) {

    data class Fix(
        val lat: Double,
        val lng: Double,
        val accuracy: Float,
        val source: String, // gps | wifi | cell | last_known
        val battery: Int,
        val timestamp: String,
        val confidence: Int,
        val networks: JSONArray? = null, // nearby Wi-Fi BSSIDs — the fingerprint
        val cells: JSONArray? = null, // nearby cell towers — another fingerprint
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("lat", lat)
            put("lng", lng)
            put("accuracy", accuracy.toDouble())
            put("source", source)
            put("battery", battery)
        put("timestamp", timestamp)
        put("confidence", confidence)
        put("networks", networks ?: JSONArray.NULL)
        put("cells", cells ?: JSONArray.NULL)
    }
}

    private val fused = LocationServices.getFusedLocationProviderClient(context)

    /** Battery-aware poll interval (minutes) — mirrors the desktop agent. */
    fun pollIntervalMillis(lostMode: Boolean, lastBattery: Int): Long {
        if (lostMode) return 20_000L // fast polling while lost
        if (lastBattery < 20) return 10 * 60_000L
        return 5 * 60_000L
    }

    fun batteryPercent(): Int {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100)
    }

    private fun hasFineLocation(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** Capture one fix. Falls back down the ladder if GPS is unavailable/stale. */
    suspend fun capture(): Fix? = withContext(Dispatchers.IO) {
        val battery = batteryPercent()
        val now = java.time.Instant.now().toString()

        // Wi-Fi + cell fingerprints ride along with EVERY fix (even last_known)
        // so the dashboard can recognize where a device has been by its network
        // surroundings, not just its coordinates.
        val networks = if (hasFineLocation()) wifiNetworks() else null
        val cells = if (hasFineLocation()) cellTowers() else null

        val fresh = if (hasFineLocation()) requestFusedFix() else null
        if (fresh != null) {
            val source = when {
                fresh.accuracy <= 25 -> "gps"
                fresh.accuracy <= 200 -> "wifi"
                else -> "cell"
            }
            val confidence = when (source) {
                "gps" -> 92
                "wifi" -> 72
                else -> 45
            }
            return@withContext Fix(
                lat = fresh.lat,
                lng = fresh.lng,
                accuracy = fresh.accuracy,
                source = source,
                battery = battery,
                timestamp = now,
                confidence = confidence,
                networks = networks,
                cells = cells,
            )
        }

        // Fallback: last known fix (marked honestly).
        AppState(context).lastFix()?.let { last ->
            return@withContext Fix(
                lat = last.getDouble("lat"),
                lng = last.getDouble("lng"),
                accuracy = last.optDouble("accuracy", 1500.0).toFloat(),
                source = "last_known",
                battery = battery,
                timestamp = now,
                confidence = (last.optInt("confidence", 30) * 0.7).toInt().coerceIn(5, 40),
                networks = networks,
                cells = cells,
            )
        }

        null
    }

    /**
     * Nearby Wi-Fi access points (BSSID + SSID + signal). This is the strongest
     * "where has this device been" fingerprint — even with no internet, the
     * radio sees the same BSSIDs, and a stolen phone reconnecting to a cafe's
     * Wi-Fi becomes recognizable. Bounded to 8 APs, best signal first.
     */
    private fun wifiNetworks(): JSONArray? = runCatching {
        val wm = context.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val results = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            wm.scanResults
        } else {
            // Kick a fresh scan on older APIs; results land asynchronously, so
            // also read whatever the radio last reported.
            runCatching { wm.startScan() }
            wm.scanResults
        }
        val arr = JSONArray()
        results.sortedByDescending { it.level }.take(8).forEach { r ->
            arr.put(JSONObject()
                .put("bssid", r.BSSID)
                .put("ssid", r.SSID)
                .put("rssi", r.level))
        }
        if (arr.length() == 0) null else arr
    }.getOrNull()

    /**
     * Nearby cell towers (MCC/MNC/LAC/CID). Works with mobile data off — the
     * radio still sees towers — and adds a second independent fingerprint.
     */
    private fun cellTowers(): JSONArray? = runCatching {
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        val arr = JSONArray()
        tm.allCellInfo?.take(5)?.forEach { ci ->
            val cell = when (ci) {
                is CellInfoGsm -> ci.cellIdentity?.let {
                    JSONObject().put("mcc", it.mcc).put("mnc", it.mnc)
                        .put("lac", it.lac).put("cid", it.cid)
                }
                is CellInfoLte -> ci.cellIdentity?.let {
                    JSONObject().put("mcc", it.mcc).put("mnc", it.mnc)
                        .put("tac", it.tac).put("cid", it.ci)
                }
                is CellInfoWcdma -> ci.cellIdentity?.let {
                    JSONObject().put("mcc", it.mcc).put("mnc", it.mnc)
                        .put("lac", it.lac).put("cid", it.cid)
                }
                is CellInfoNr -> ci.cellIdentity?.let {
                    JSONObject().put("mcc", it.mcc).put("mnc", it.mnc)
                        .put("tac", it.tac).put("cid", it.nci)
                }
                else -> null
            }
            if (cell != null) arr.put(cell)
        }
        if (arr.length() == 0) null else arr
    }.getOrNull()

    private data class FreshFix(val lat: Double, val lng: Double, val accuracy: Float)

        null
    }

    private data class FreshFix(val lat: Double, val lng: Double, val accuracy: Float)

    private suspend fun requestFusedFix(): FreshFix? = suspendCancellableCoroutine { cont ->
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L)
            .setWaitForAccurateLocation(true)
            .setMinUpdateIntervalMillis(2_000L)
            .build()

        // Resume exactly once — a late fix racing the 8 s timeout must not
        // crash with "Already resumed".
        val done = java.util.concurrent.atomic.AtomicBoolean(false)

        val callback = object : com.google.android.gms.location.LocationCallback() {
            override fun onLocationResult(result: com.google.android.gms.location.LocationResult) {
                if (!cont.isActive || !done.compareAndSet(false, true)) return
                fused.removeLocationUpdates(this)
                val loc = result.lastLocation
                cont.resume(
                    if (loc != null) FreshFix(loc.latitude, loc.longitude, loc.accuracy)
                    else null
                )
            }

            override fun onLocationAvailability(availability: com.google.android.gms.location.LocationAvailability) {
                if (!availability.isLocationAvailable && cont.isActive && done.compareAndSet(false, true)) {
                    fused.removeLocationUpdates(this)
                    cont.resume(null)
                }
            }
        }

        // Must pass a real Looper — this runs on Dispatchers.IO, whose thread
        // has none (null would throw IllegalArgumentException).
        fused.requestLocationUpdates(request, callback, android.os.Looper.getMainLooper())
        // Give the fused provider up to ~8 s, then fall back.
        Thread {
            Thread.sleep(8_000)
            if (cont.isActive && done.compareAndSet(false, true)) {
                fused.removeLocationUpdates(callback)
                cont.resume(null)
            }
        }.start()
    }
}
