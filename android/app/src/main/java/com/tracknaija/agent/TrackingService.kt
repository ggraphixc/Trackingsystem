package com.tracknaija.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Foreground service that runs the phone signal ladder and polls for remote
 * commands — the Android equivalent of the desktop agent's tracking loop.
 *
 * Offline-first: fixes, evidence and events are held in the [OfflineVault]
 * while the phone has no data/Wi-Fi and are flushed in one batch the moment
 * the phone touches any network. SIM changes are detected from the cellular
 * radio state (works with data off) and recorded for the dashboard.
 */
class TrackingService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val vault by lazy { OfflineVault(this) }
    private var loops: Job? = null
    private var lastBattery = 100
    private var lastOfflineEvidenceAt = 0L
    private var lastSimFingerprint: String? = null
    private var pendingSimFingerprint: String? = null
    private var connectivityCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        createChannel()
        startAsForeground()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        running = true
        startAsForeground()
        if (loops == null) {
            registerConnectivityCallback()
            loops = scope.launch { trackingLoop() }
            scope.launch { commandLoop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        connectivityCallback?.let { cb ->
            runCatching {
                getSystemService(Context.CONNECTIVITY_SERVICE)
                    .let { it as ConnectivityManager }
                    .unregisterNetworkCallback(cb)
            }
        }
        scope.cancel()
        super.onDestroy()
    }

    private fun startAsForeground() {
        val pending = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_warning) // TODO: custom vector icon
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_body))
            .setContentIntent(pending)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /** The moment ANY network appears (cafe Wi-Fi, a new SIM's data) — flush. */
    private fun registerConnectivityCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                scope.launch { flushVault() }
            }
        }
        connectivityCallback = callback
        runCatching { cm.registerDefaultNetworkCallback(callback) }
    }

    /**
     * Upload everything in the vault as one batch. Any connectivity is enough
     * — this is the "the stolen phone surfaced online" moment.
     */
    private suspend fun flushVault() {
        val state = AppState(this)
        val deviceId = state.deviceId ?: return
        val pending = vault.all()
        if (pending.isEmpty()) return
        // Snapshot the items we are about to upload so we only remove exactly
        // these afterwards — anything pushed mid-upload survives.
        val queuedAts = pending.map { it.optString("queuedAt") }.filter { it.isNotEmpty() }.toSet()
        val items = mutableListOf<JSONObject>()
        for (item in pending) {
            val type = item.optString("type")
            val payload = item.optJSONObject("payload") ?: continue
            when (type) {
                "fix" -> items.add(JSONObject().put("type", "fix").put("fix", payload))
                "evidence" -> items.add(
                    JSONObject().put("type", "evidence").put("dataUrl", payload.optString("dataUrl"))
                )
                "event" -> items.add(JSONObject().put("type", "event").put("event", payload))
            }
        }
        if (items.isEmpty()) return
        // True only when the server accepted every item — a partial failure
        // keeps the failed entries in the vault for the next retry.
        val ok = SyncClient(state.serverUrl).postBatch(deviceId, items)
        if (ok) vault.removeUploaded(queuedAts)
    }

    /** Capture a fix on the battery-aware interval; queue it if offline. */
    private suspend fun CoroutineScope.trackingLoop() {
        val state = AppState(this@TrackingService)
        val ladder = SignalLadder(this@TrackingService)
        while (isActive) {
            val fix = ladder.capture()
            if (fix != null) {
                val json = fix.toJson()
                state.saveFix(json)
                val deviceId = state.deviceId
                // postFix returns Boolean and never throws (SyncClient swallows
                // network errors) — no runCatching needed.
                val uploaded = deviceId != null && SyncClient(state.serverUrl).postFix(deviceId, json)
                if (uploaded) {
                    flushVault() // online — drain anything captured offline
                } else {
                    // Data/Wi-Fi off (or not yet linked) — hold for burst sync.
                    vault.push("fix", deviceId, json)
                }
                lastBattery = fix.battery
            }

            // Lost mode: keep grabbing thief evidence even with no network.
            // Photos pile up in the vault and upload the moment it reconnects.
            if (state.lostMode) {
                val now = System.currentTimeMillis()
                if (vault.countOf("evidence") < 3 && now - lastOfflineEvidenceAt > 5 * 60_000L) {
                    lastOfflineEvidenceAt = now
                    CommandHandler.captureWebcam(this@TrackingService) { dataUrl ->
                        if (dataUrl != null) {
                            vault.push(
                                "evidence",
                                state.deviceId,
                                JSONObject()
                                    .put("dataUrl", dataUrl)
                                    .put("capturedAt", java.time.Instant.now().toString()),
                            )
                        }
                    }
                }
            }

            // SIM-change detection — reads the cellular radio state, which
            // works even when mobile data is off. A thief swapping SIMs is a
            // strong signal for the dashboard and police report.
            // Debounced: a fingerprint must persist for two consecutive checks
            // before we emit, so transient radio flapping doesn't fake a swap.
            val simFp = simFingerprint()
            if (simFp != null) {
                if (lastSimFingerprint == null) {
                    lastSimFingerprint = simFp // baseline on first observation
                } else if (simFp != lastSimFingerprint) {
                    if (pendingSimFingerprint == simFp) {
                        val event = JSONObject()
                            .put("type", "sim_change")
                            .put("detail", JSONObject()
                                .put("from", lastSimFingerprint)
                                .put("to", simFp))
                            .put("at", java.time.Instant.now().toString())
                        vault.push("event", state.deviceId, event)
                        val deviceId = state.deviceId
                        if (deviceId != null) {
                            SyncClient(state.serverUrl).postEvent(deviceId, event)
                        }
                        lastSimFingerprint = simFp
                        pendingSimFingerprint = null
                    } else {
                        pendingSimFingerprint = simFp
                    }
                } else {
                    pendingSimFingerprint = null
                }
            }

            delay(ladder.pollIntervalMillis(state.lostMode, lastBattery))
        }
    }

    /**
     * Best-effort SIM fingerprint with no restricted permissions:
     * current operator (MCC+MNC) + radio state. Returns null when no SIM.
     */
    private fun simFingerprint(): String? {
        return runCatching {
            val tm = getSystemService(Context.TELEPHONY_SERVICE) as android.telephony.TelephonyManager
            val op = tm.simOperator.orEmpty()
            val state = tm.simState
            if (op.isEmpty() && state != android.telephony.TelephonyManager.SIM_STATE_READY) {
                null
            } else {
                "$op|$state"
            }
        }.getOrNull()
    }

    /** Poll the sync server for remote commands every 10 s (like the desktop agent). */
    private suspend fun CoroutineScope.commandLoop() {
        val state = AppState(this@TrackingService)
        while (isActive) {
            val deviceId = state.deviceId
            if (deviceId != null) {
                val client = SyncClient(state.serverUrl)
                val commands = try {
                    client.getCommands(deviceId, state.lastCommandId)
                } catch (_: Exception) {
                    emptyList()
                }
                for (cmd in commands) {
                    state.lastCommandId = cmd.optString("id")
                    when (cmd.optString("type")) {
                        "alarm" -> CommandHandler.playAlarm(this@TrackingService)
                        "webcam" -> CommandHandler.captureWebcam(this@TrackingService) { dataUrl ->
                            if (dataUrl != null) {
                                // The capture callback isn't a coroutine — hop onto
                                // the service scope to upload (or vault) the evidence.
                                scope.launch {
                                    val uploaded = try {
                                        client.postEvidence(deviceId, dataUrl)
                                    } catch (_: Exception) {
                                        false
                                    }
                                    if (!uploaded) {
                                        vault.push(
                                            "evidence",
                                            deviceId,
                                            JSONObject()
                                                .put("dataUrl", dataUrl)
                                                .put("capturedAt", java.time.Instant.now().toString()),
                                        )
                                    }
                                }
                            }
                        }
                        // "lock" on Android needs Device Admin (deprecated) — omitted
                        // for the MVP; webcam + alarm + location are the core evidence.
                    }
                    try {
                        client.ackCommand(deviceId, cmd.optString("id"))
                    } catch (_: Exception) {
                        // never let a failed ack stop the loop
                    }
                }
            }
            delay(10_000)
        }
    }

    companion object {
        private const val CHANNEL_ID = "tracknaija_tracking"
        private const val NOTIF_ID = 1

        /** True while the service is running — lets the UI show real state. */
        @Volatile
        var running: Boolean = false

        fun start(context: Context) {
            val intent = Intent(context, TrackingService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TrackingService::class.java))
        }
    }
}
