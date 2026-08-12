package com.tracknaija.agent

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks to the TrackNaija sync server (same endpoints as the desktop agent).
 * Uses HttpURLConnection + org.json — no extra HTTP dependencies.
 * All methods return null/empty on failure so tracking never crashes offline.
 */
class SyncClient(private val serverUrl: String) {

    private fun base(): String = serverUrl.trimEnd('/')

    private suspend fun request(method: String, path: String, body: JSONObject?): JSONObject? =
        withContext(Dispatchers.IO) {
            try {
                val conn = URL(base() + path).openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = 6000
                conn.readTimeout = 6000
                conn.setRequestProperty("Content-Type", "application/json")
                if (body != null) {
                    conn.doOutput = true
                    conn.outputStream.use { it.write(body.toString().toByteArray()) }
                }
                val code = conn.responseCode
                if (code !in 200..299) {
                    conn.disconnect()
                    return@withContext null
                }
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                runCatching { JSONObject(text) }.getOrNull()
            } catch (_: Exception) {
                null // offline / unreachable — never crash the agent
            }
        }

    suspend fun claim(code: String, hostname: String, serial: String, platform: String): JSONObject? {
        val body = JSONObject()
            .put("code", code.trim().uppercase())
            .put("hostname", hostname)
            .put("serialNumber", serial)
            .put("platform", platform)
        return request("POST", "/api/pair/claim", body)
    }

    suspend fun postFix(deviceId: String, fix: JSONObject): Boolean =
        request("POST", "/api/devices/$deviceId/fixes", JSONObject().put("fix", fix)) != null

    suspend fun postEvidence(deviceId: String, dataUrl: String): Boolean =
        request(
            "POST",
            "/api/devices/$deviceId/evidence",
            JSONObject().put("dataUrl", dataUrl),
        ) != null

    /**
     * Upload the whole offline vault in one call — the burst sync.
     * Returns true only when EVERY item was accepted (failed == 0), so the
     * caller never drops vault entries the server rejected.
     */
    suspend fun postBatch(deviceId: String, items: List<JSONObject>): Boolean {
        val res = request(
            "POST",
            "/api/devices/$deviceId/batch",
            JSONObject().put("items", JSONArray(items)),
        )
        return res != null && res.optBoolean("ok", false) && res.optInt("failed", 0) == 0
    }

    /** Report a device event (e.g. sim_change) — works over any connection. */
    suspend fun postEvent(deviceId: String, event: JSONObject): Boolean =
        request(
            "POST",
            "/api/devices/$deviceId/events",
            JSONObject().put("event", event),
        ) != null

    /**
     * Community relay: this phone heard another TrackNaija phone's BLE beacon
     * and reports it with our GPS position. Anonymous — the server resolves
     * the beacon to a device internally and never leaks whether it was known.
     */
    suspend fun postSighting(sighting: JSONObject): Boolean =
        request("POST", "/api/sightings", sighting) != null

    /** Same as [request] but for endpoints that return a JSON *array* (GET /commands). */
    private suspend fun requestArray(method: String, path: String): JSONArray? =
        withContext(Dispatchers.IO) {
            try {
                val conn = URL(base() + path).openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = 6000
                conn.readTimeout = 6000
                conn.setRequestProperty("Content-Type", "application/json")
                val code = conn.responseCode
                if (code !in 200..299) {
                    conn.disconnect()
                    return@withContext null
                }
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                runCatching { JSONArray(text) }.getOrNull()
            } catch (_: Exception) {
                null // offline / unreachable — never crash the agent
            }
        }

    suspend fun getCommands(deviceId: String, afterId: String?): List<JSONObject> {
        val q = afterId?.let { "?after=${java.net.URLEncoder.encode(it, "UTF-8")}" } ?: ""
        val res = requestArray("GET", "/api/devices/$deviceId/commands$q") ?: return emptyList()
        return runCatching {
            (0 until res.length()).map { res.getJSONObject(it) }
        }.getOrDefault(emptyList())
    }

    suspend fun ackCommand(deviceId: String, commandId: String): Boolean =
        request("POST", "/api/devices/$deviceId/commands/$commandId/ack", JSONObject()) != null
}
