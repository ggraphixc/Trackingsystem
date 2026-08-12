package com.dravex.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-arms tracking after a reboot. A thief power-cycling a stolen phone must
 * not silently stop the agent: if the owner had tracking (or lost mode)
 * enabled, the foreground service restarts on boot and, while lost, the
 * community beacon comes back up with it.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        val state = AppState(context)
        if (state.trackingEnabled || state.lostMode) {
            runCatching { TrackingService.start(context) }
        }
    }
}
