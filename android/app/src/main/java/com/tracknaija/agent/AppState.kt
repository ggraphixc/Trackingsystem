package com.tracknaija.agent

import android.content.Context
import org.json.JSONObject

/** Small typed wrapper over SharedPreferences for the agent's local state. */
class AppState(context: Context) {

    private val prefs =
        context.getSharedPreferences("tracknaija_state", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "http://192.168.1.100:4173") ?: ""
        set(v) = prefs.edit().putString("server_url", v).apply()

    var deviceId: String?
        get() = prefs.getString("device_id", null)
        set(v) = prefs.edit().putString("device_id", v).apply()

    var pairedAt: String?
        get() = prefs.getString("paired_at", null)
        set(v) = prefs.edit().putString("paired_at", v).apply()

    var lostMode: Boolean
        get() = prefs.getBoolean("lost_mode", false)
        set(v) = prefs.edit().putBoolean("lost_mode", v).apply()

    var lastCommandId: String?
        get() = prefs.getString("last_command_id", null)
        set(v) = prefs.edit().putString("last_command_id", v).apply()

    var lastFixJson: String?
        get() = prefs.getString("last_fix", null)
        set(v) = prefs.edit().putString("last_fix", v).apply()

    fun saveFix(fix: JSONObject) {
        lastFixJson = fix.toString()
    }

    fun lastFix(): JSONObject? =
        lastFixJson?.let { runCatching { JSONObject(it) }.getOrNull() }
}
