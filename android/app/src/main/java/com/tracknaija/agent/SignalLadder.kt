package com.tracknaija.agent

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.BatteryManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
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
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("lat", lat)
            put("lng", lng)
            put("accuracy", accuracy.toDouble())
            put("source", source)
            put("battery", battery)
            put("timestamp", timestamp)
            put("confidence", confidence)
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
            )
        }

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
