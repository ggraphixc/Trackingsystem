/**
 * Dravex SyncClient — talks to the sync server (or Appwrite in Phase 2)
 * from the Electron main process. Uses the global fetch (Node 18+/Electron 33).
 */
class SyncClient {
  constructor(serverUrl) {
    this.serverUrl = String(serverUrl || "").replace(/\/+$/, "");
    this.ownerKey = null; // DRAVEX_OWNER_KEY — owner-scoped calls (legacy)
    this.sessionToken = null; // Phase 2.5 account session — preferred credential
    this.deviceToken = null; // issued at claim — device-scoped calls
  }

  get configured() {
    return this.serverUrl.startsWith("http");
  }

  /** Owner credential (needed only when the server sets DRAVEX_OWNER_KEY). */
  setOwnerKey(key) {
    this.ownerKey = key ? String(key).trim() : null;
    return this;
  }

  /** Agent credential returned by /api/pair/claim. */
  setDeviceToken(token) {
    this.deviceToken = token ? String(token).trim() : null;
    return this;
  }

  /** Phase 2.5 account session — preferred over the legacy owner key. */
  setSessionToken(token) {
    this.sessionToken = token ? String(token).trim() : null;
    return this;
  }

  async _req(method, path, body, opts = {}) {
    if (!this.configured) return null;
    // opts.auth: "owner" | "device" | "none" (default "owner" for reads).
    const auth = opts.auth || "owner";
    // Owner-scoped calls accept the account session first (per-owner model),
    // falling back to the legacy DRAVEX_OWNER_KEY.
    const token =
      auth === "device" ? this.deviceToken : auth === "owner" ? this.sessionToken || this.ownerKey : null;
    // Manual timeout (AbortController + clearTimeout) so no timers linger
    // after the request — avoids Node/Windows shutdown crashes and leaks.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(this.serverUrl + path, {
        method,
        headers,
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
    const res = await this._req(
      "POST",
      "/api/pair/claim",
      {
        code: String(code || "").trim().toUpperCase(),
        hostname: info.hostname,
        serialNumber: info.serialNumber,
        platform: info.platform,
        // Phone identity + Dravex Tag identity ride along so the stolen
        // registry is keyed by IMEI / static beacon from the very first claim.
        imei: info.imei,
        staticBeacon: info.staticBeacon,
      },
      { auth: "none" },
    );
    // Store the device credential issued at claim so every downstream
    // device-scoped call (fixes/events/lost) is authenticated automatically.
    // Callers may still override via setDeviceToken() afterwards.
    if (res && res.token) this.setDeviceToken(res.token);
    return res;
  }

  async postFix(deviceId, fix) {
    return this._req("POST", `/api/devices/${deviceId}/fixes`, { fix }, { auth: "device" });
  }

  async postEvidence(deviceId, dataUrl, capturedAt) {
    return this._req(
      "POST",
      `/api/devices/${deviceId}/evidence`,
      {
        dataUrl,
        capturedAt: capturedAt || new Date().toISOString(),
      },
      { auth: "device" },
    );
  }

  async getCommands(deviceId, afterId) {
    const q = afterId ? `?after=${encodeURIComponent(afterId)}` : "";
    return this._req("GET", `/api/devices/${deviceId}/commands${q}`, null, { auth: "device" });
  }

  async ackCommand(deviceId, commandId) {
    return this._req(
      "POST",
      `/api/devices/${deviceId}/commands/${commandId}/ack`,
      {},
      { auth: "device" },
    );
  }

  /** Offline-vault burst sync: true only when the server accepted EVERY item. */
  async postBatch(deviceId, items) {
    const res = await this._req(
      "POST",
      `/api/devices/${deviceId}/batch`,
      { items },
      { auth: "device" },
    );
    return !!res && res.ok === true && res.failed === 0;
  }

  /** Report a device event (e.g. sim_change — desktop sends reconnects). */
  async postEvent(deviceId, event) {
    return this._req("POST", `/api/devices/${deviceId}/events`, { event }, { auth: "device" });
  }

  /** Latest owner alerts (reconnects + SIM changes) for the agent UI. */
  async getAlerts() {
    return this._req("GET", "/api/alerts/latest");
  }

  /** Community relay: report a heard BLE beacon with this machine's position. */
  async postSighting(sighting) {
    return this._req("POST", "/api/sightings", sighting, { auth: "none" });
  }

  /** Mark a device lost (activates community beacon alerts) / found. */
  async setDeviceLost(deviceId, lost) {
    return this._req("POST", `/api/devices/${deviceId}/lost`, { lost });
  }

  /** Community sightings for a device (newest first). */
  async getSightings(deviceId) {
    // Scale Core: the API now returns a paginated envelope; the agent only
    // needs the newest page, so unwrap .items (older agents keep working).
    const res = await this._req("GET", `/api/devices/${deviceId}/sightings?limit=50`);
    return Array.isArray(res) ? res : (res && res.items) || [];
  }

  /** Captured webcam evidence for a device (newest first). */
  async getEvidence(deviceId) {
    return this._req("GET", `/api/devices/${deviceId}/evidence`);
  }

  /** Full device detail (events, sightings, metadata). */
  async getDevice(deviceId) {
    return this._req("GET", `/api/devices/${deviceId}`);
  }

  /** Location-fix history, newest first (cursor-paginated since Scale Core). */
  async getFixes(deviceId, limit = 30) {
    const res = await this._req("GET", `/api/devices/${deviceId}/fixes?limit=${limit}`);
    return Array.isArray(res) ? res : (res && res.items) || [];
  }

  /**
   * Resolve a Wi-Fi fingerprint (BSSIDs) to a coordinate via the server's
   * POST /api/geolocate. Returns { lat, lng, accuracy, source, cached } or
   * null when the server can't resolve (501 unconfigured / 502 no provider /
   * unreachable) — the engine then falls back to IP honestly.
   */
  async geolocate(bssids) {
    return this._req(
      "POST",
      "/api/geolocate",
      { bssids: Array.isArray(bssids) ? bssids : [] },
      { auth: "device" },
    );
  }

  /**
   * Ownership handover (second-life market): returns a fresh single-use
   * pairing code for the new owner's agent; the old credential is rotated.
   */
  async transferDevice(deviceId) {
    return this._req("POST", `/api/devices/${deviceId}/transfer`, {});
  }

  /** Owner confirms the device is back ("Verified → Recovered"). */
  async verifyDevice(deviceId) {
    return this._req("POST", `/api/devices/${deviceId}/verify`, {});
  }

  /** Owner sets the one-way message shown to a finder. */
  async setRecoveryMessage(deviceId, message, contactPreference) {
    return this._req(
      "PUT",
      `/api/devices/${deviceId}/recovery-message`,
      { message, contactPreference },
    );
  }

  /** A finder sends the owner one message through the device's recovery page. */
  async postContactMessage(deviceId, message) {
    return this._req(
      "POST",
      `/api/devices/${deviceId}/contact`,
      { message },
      { auth: "none" },
    );
  }

  /**
   * Public stolen-registry check (IMEI/serial) — buyer protection, no auth.
   * Returns the verdict { found, status, label, message } or null.
   */
  async checkRegistry(query) {
    return this._req(
      "GET",
      `/api/check?q=${encodeURIComponent(String(query || "").trim())}`,
      null,
      { auth: "none" },
    );
  }

  /** All paired devices (phones + laptops) for the owner dashboard. */
  async listDevices() {
    return this._req("GET", "/api/devices");
  }

  /** Mark an alert read ({ id } or { all: true }). */
  async markAlertRead(id) {
    return this._req("POST", "/api/alerts/read", id ? { id } : { all: true });
  }

  /* ---------------- Phase 2.5: account session ---------------- */

  /**
   * Log into an owner account. Stores the session token so subsequent
   * owner-scoped calls use it (each account sees only its own devices).
   * Returns { ok, user?, error? }.
   */
  async login(email, password) {
    const res = await this._req(
      "POST",
      "/api/auth/login",
      { email: String(email || "").trim(), password: String(password || "") },
      { auth: "none" },
    );
    if (res && res.token) {
      this.setSessionToken(res.token);
      return { ok: true, user: res };
    }
    return { ok: false, error: "Login failed — check the email and password." };
  }

  /** Log out of the account session (server-side token invalidated). */
  async logout() {
    // auth "owner" sends the session token (or owner key) as the bearer —
    // the server needs it to know WHICH session to invalidate.
    if (this.sessionToken) {
      await this._req("POST", "/api/auth/logout", {}, { auth: "owner" });
    }
    this.sessionToken = null;
    return { ok: true };
  }

  /** Who is this session? { ok, user? } — null user when signed out. */
  async me() {
    const res = await this._req("GET", "/api/auth/me", null, { auth: "owner" });
    return { ok: !!(res && res.ok), user: res || null };
  }
}

module.exports = { SyncClient };

module.exports = { SyncClient };
