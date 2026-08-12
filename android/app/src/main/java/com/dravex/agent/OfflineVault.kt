package com.dravex.agent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Offline evidence vault — the phone's memory of what happened while the
 * thief had data/Wi-Fi off.
 *
 * Fixes, webcam evidence and device events (e.g. "SIM changed") are persisted
 * here in plain JSON and flushed to the sync server in ONE batch the moment
 * the phone touches ANY network (a cafe's Wi-Fi, or a new SIM's data).
 *
 * This is how Dravex still "tracks" an offline phone: capture keeps
 * happening locally, and the moment the device surfaces online everything
 * uploads and the dashboard learns where it has been since.
 *
 * Bounded: evidence is capped (photos are large) and the whole queue is
 * trimmed to keep the file small. Thread-safe for the service coroutines.
 */
class OfflineVault(context: Context) {

    private val file = File(context.filesDir, "offline_queue.json")
    private val maxItems = 300
    private val maxEvidence = 15

    /** Add an item. Returns the new queue size. */
    @Synchronized
    fun push(type: String, deviceId: String?, payload: JSONObject): Int {
        val queue = load()
        val item = JSONObject()
            .put("type", type)
            .put("deviceId", deviceId) // null deviceId is dropped; assigned at flush time
            .put("payload", payload)
            .put("queuedAt", java.time.Instant.now().toString())
        queue.put(item)

        // Trim oldest evidence first, then overflow.
        var evidence = (0 until queue.length()).count {
            queue.getJSONObject(it).optString("type") == "evidence"
        }
        while (evidence > maxEvidence) {
            for (j in 0 until queue.length()) {
                if (queue.getJSONObject(j).optString("type") == "evidence") {
                    queue.remove(j)
                    evidence--
                    break
                }
            }
        }
        while (queue.length() > maxItems) {
            queue.remove(0)
        }
        save(queue)
        return queue.length()
    }

    @Synchronized
    fun all(): List<JSONObject> {
        val queue = load()
        return (0 until queue.length()).map { queue.getJSONObject(it) }
    }

    /**
     * Remove EXACTLY the items that were uploaded (matched by queuedAt).
     * Never delete the whole file: a fix pushed while the batch upload was
     * in flight must survive to the next sync.
     */
    @Synchronized
    fun removeUploaded(queuedAts: Set<String>) {
        if (queuedAts.isEmpty()) return
        val queue = load()
        val kept = JSONArray()
        for (i in 0 until queue.length()) {
            val item = queue.getJSONObject(i)
            if (item.optString("queuedAt") !in queuedAts) kept.put(item)
        }
        save(kept)
    }

    @Synchronized
    fun count(): Int = load().length()

    @Synchronized
    fun countOf(type: String): Int {
        val queue = load()
        return (0 until queue.length()).count {
            queue.getJSONObject(it).optString("type") == type
        }
    }

    private fun load(): JSONArray = runCatching {
        if (file.exists()) JSONArray(file.readText()) else JSONArray()
    }.getOrDefault(JSONArray())

    private fun save(queue: JSONArray) {
        // Write to a temp file then rename — atomic, so a concurrent reader
        // (the UI) never sees a torn/partial JSON file.
        runCatching {
            val tmp = File(file.parentFile, "offline_queue.tmp")
            tmp.writeText(queue.toString())
            tmp.renameTo(file)
        }
    }
}
