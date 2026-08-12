/**
 * Dravex SyncClient — talks to the sync server (or Appwrite in Phase 2)
 * from the Electron main process. Uses the global fetch (Node 18+/Electron 33).
 */
class SyncClient {
  constructor(serverUrl) {
    this.serverUrl = String(serverUrl || "").replace(/\/+$/, "");
  }

  get configured() {
    return this.serverUrl.startsWith("http");
  }

  async _req(method, path, body) {
    if (!this.configured) return null;
    // Manual timeout (AbortController + clearTimeout) so no timers linger
    // after the request — avoids Node/Windows shutdown crashes and leaks.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(this.serverUrl + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return res.status === 204 ? {} : await res.json();
    } catch (_) {
      return null; // server offline — never crash the agent
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    return this._req("GET", "/api/health");
  }

  /** Agent claims a pairing code issued by the dashboard. */
  async claim(code, info) {
    return this._req("POST", "/api/pair/claim", {
      code: String(code || "").trim().toUpperCase(),
      hostname: info.hostname,
      serialNumber: info.serialNumber,
      platform: info.platform,
    });
  }

  async postFix(deviceId, fix) {
    return this._req("POST", `/api/devices/${deviceId}/fixes`, { fix });
  }

  async postEvidence(deviceId, dataUrl) {
    return this._req("POST", `/api/devices/${deviceId}/evidence`, {
      dataUrl,
      capturedAt: new Date().toISOString(),
    });
  }

  async getCommands(deviceId, afterId) {
    const q = afterId ? `?after=${encodeURIComponent(afterId)}` : "";
    return this._req("GET", `/api/devices/${deviceId}/commands${q}`);
  }

  async ackCommand(deviceId, commandId) {
    return this._req("POST", `/api/devices/${deviceId}/commands/${commandId}/ack`);
  }

  /** Offline-vault burst sync: true only when the server accepted EVERY item. */
  async postBatch(deviceId, items) {
    const res = await this._req("POST", `/api/devices/${deviceId}/batch`, { items });
    return !!res && res.ok === true && res.failed === 0;
  }

  /** Report a device event (e.g. sim_change — desktop sends reconnects). */
  async postEvent(deviceId, event) {
    return this._req("POST", `/api/devices/${deviceId}/events`, { event });
  }

  /** Latest owner alerts (reconnects + SIM changes) for the agent UI. */
  async getAlerts() {
    return this._req("GET", "/api/alerts/latest");
  }

  /** Community relay: report a heard BLE beacon with this machine's position. */
  async postSighting(sighting) {
    return this._req("POST", "/api/sightings", sighting);
  }

  /** Mark a device lost (activates community beacon alerts) / found. */
  async setDeviceLost(deviceId, lost) {
    return this._req("POST", `/api/devices/${deviceId}/lost`, { lost });
  }

  /** Community sightings for a device (newest first). */
  async getSightings(deviceId) {
    return this._req("GET", `/api/devices/${deviceId}/sightings`);
  }

  /** Captured webcam evidence for a device (newest first). */
  async getEvidence(deviceId) {
    return this._req("GET", `/api/devices/${deviceId}/evidence`);
  }

  /** Full device detail (events, sightings, metadata). */
  async getDevice(deviceId) {
    return this._req("GET", `/api/devices/${deviceId}`);
  }

  /** Location-fix history, newest first (server caps at 100). */
  async getFixes(deviceId, limit = 30) {
    return this._req("GET", `/api/devices/${deviceId}/fixes?limit=${limit}`);
  }

  /** All paired devices (phones + laptops) for the owner dashboard. */
  async listDevices() {
    return this._req("GET", "/api/devices");
  }

  /** Mark an alert read ({ id } or { all: true }). */
  async markAlertRead(id) {
    return this._req("POST", "/api/alerts/read", id ? { id } : { all: true });
  }
}

module.exports = { SyncClient };
