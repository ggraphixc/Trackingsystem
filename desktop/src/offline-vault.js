const fs = require("fs");

/**
 * Offline evidence vault — the laptop equivalent of the Android vault.
 *
 * Fixes and webcam evidence captured while this machine has no connectivity
 * (thief disconnects Wi-Fi / the laptop has no internet) are persisted here
 * and flushed to the sync server in ONE batch the moment the agent can reach
 * it. Bounded and thread-safe enough for the main process.
 */
class OfflineVault {
  constructor(file) {
    this.file = file;
    this.maxItems = 300;
    this.maxEvidence = 15;
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (_) {
      /* corrupt/absent — start empty */
    }
    return [];
  }

  _save(queue) {
    try {
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(queue));
      fs.renameSync(tmp, this.file); // atomic — a reader never sees torn JSON
    } catch (err) {
      console.error("OfflineVault save failed:", err.message);
    }
  }

  /** Add an item. Returns the new queue size. */
  push(type, deviceId, payload) {
    const queue = this._load();
    queue.push({
      type,
      deviceId: deviceId || null,
      payload,
      queuedAt: new Date().toISOString(),
    });

    // Bound the vault: trim old evidence first, then overflow.
    let evidence = queue.filter((i) => i.type === "evidence").length;
    while (evidence > this.maxEvidence) {
      const idx = queue.findIndex((i) => i.type === "evidence");
      if (idx < 0) break;
      queue.splice(idx, 1);
      evidence--;
    }
    while (queue.length > this.maxItems) queue.shift();
    this._save(queue);
    return queue.length;
  }

  all() {
    return this._load();
  }

  /** Remove EXACTLY the items that were uploaded (by queuedAt) — anything
   * pushed mid-upload survives for the next sync. */
  removeUploaded(queuedAts) {
    if (!queuedAts || queuedAts.size === 0) return;
    const kept = this._load().filter((i) => !queuedAts.has(i.queuedAt));
    this._save(kept);
  }

  count() {
    return this._load().length;
  }

  countOf(type) {
    return this._load().filter((i) => i.type === type).length;
  }
}

module.exports = { OfflineVault };
