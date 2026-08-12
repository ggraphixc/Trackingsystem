const { exec } = require("child_process");
const { EventEmitter } = require("events");
const fs = require("fs");
const https = require("https");

/**
 * Dravex desktop "signal ladder".
 *
 * Laptops have no GPS and no IMEI, so the ladder is:
 *   1. Wi-Fi positioning   — BSSIDs resolved by the server (Google
 *                            Geolocation API / Mozilla Location, cached)
 *   2. IP geolocation      — public IP lookup (coarse, always available)
 *   3. Last known fix      — whatever we stored last time
 *
 * Honesty rule: a coordinate is NEVER invented. If the server cannot resolve
 * the Wi-Fi fingerprint (501, unreachable, or no provider), the fix falls
 * back to IP — and if there is no IP either, to the last-known fix, which is
 * explicitly marked `last_known`. The `wifi` source only ever appears after
 * a real `wifi_resolved` geolocation answer.
 *
 * @param {string} stateFile          path to the agent state JSON
 * @param {(bssids: string[]) => Promise<object|null>} geolocateWifi
 *   optional resolver injected by main.js — posts the fingerprint to
 *   POST /api/geolocate and returns { lat, lng, accuracy } or null.
 */
class TrackingEngine extends EventEmitter {
  constructor(stateFile, geolocateWifi) {
    super();
    this.stateFile = stateFile;
    this.geolocateWifi = typeof geolocateWifi === "function" ? geolocateWifi : null;
    this._timer = null;
    this.lastFix = null;
    this._loadLastFix();
  }

  _loadLastFix() {
    try {
      if (this.stateFile && fs.existsSync(this.stateFile)) {
        const state = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
        if (state.lastFix) this.lastFix = state.lastFix;
      }
    } catch (_) {
      /* no last fix yet */
    }
  }

  start(intervalMs) {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.trackNow(), intervalMs);
    this.trackNow(); // fire once immediately
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /** Run one full ladder pass and emit + return the best fix. */
  async trackNow() {
    const wifi = await this.scanWifi();
    const ip = await this.ipGeolocate();
    // Signal 1 upgrade: resolve the fingerprint to a real coordinate. Only a
    // genuine resolution counts as "wifi" — everything else falls back.
    let geo = null;
    if (wifi.length > 0 && this.geolocateWifi) {
      try {
        const bssids = wifi.map((ap) => ap.bssid).filter(Boolean);
        geo = await this.geolocateWifi(bssids);
        if (geo && !(Number.isFinite(geo.lat) && Number.isFinite(geo.lng))) geo = null;
      } catch (_) {
        geo = null; // server unreachable — never crash the ladder
      }
    }
    const fix = this.buildFix(wifi, ip, geo);
    if (fix) {
      this.lastFix = fix;
      this.emit("fix", fix);
    }
    return fix;
  }

  /* ---------------- Signal 1: Wi-Fi ---------------- */

  scanWifi() {
    return new Promise((resolve) => {
      let cmd;
      if (process.platform === "win32") {
        cmd = "netsh wlan show networks mode=bssid";
      } else if (process.platform === "darwin") {
        cmd =
          "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s";
      } else {
        cmd = "nmcli -t -f SSID,BSSID dev wifi list 2>/dev/null || iwlist scan 2>/dev/null";
      }

      exec(cmd, { timeout: 8000 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(this.parseWifi(stdout));
      });
    });
  }

  /**
   * Parse `netsh wlan show networks mode=bssid` (Windows), `airport -s`
   * (macOS) or `nmcli` (Linux) output into AP records {bssid, ssid, rssi}.
   * This is the laptop's "Wi-Fi fingerprint" — the set of access points a
   * stolen laptop sees is itself a locate signal (a cafe, an office, a home),
   * and it is uploaded with every fix so the dashboard can match by network,
   * not just coordinates.
   */
  parseWifi(raw) {
    const aps = [];
    const seen = new Set();

    // netsh format:
    //   SSID 1 : Cafe-Wifi
    //   BSSID 1 : a0:36:9f:11:22:33
    //   Signal : 85%
    //
    // nmcli -t format:
    //   Cafe-Wifi:a0:36:9f:11:22:33:...
    const blocks = raw.split(/\r?\n/);
    let cur = null;
    const flush = () => {
      if (cur && cur.bssid && !seen.has(cur.bssid)) {
        seen.add(cur.bssid);
        aps.push(cur);
      }
      cur = null;
    };
    for (const line of blocks) {
      const ssidM = line.match(/^\s*SSID\s*\d*\s*:\s*(.+)$/i);
      if (ssidM) {
        flush();
        cur = { ssid: ssidM[1].trim(), bssid: null, rssi: null };
        continue;
      }
      const bssidM = line.match(/([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/);
      if (bssidM && cur) {
        cur.bssid = bssidM[0].toUpperCase();
        continue;
      }
      const sigM = line.match(/Signal\s*:\s*(\d+)%/i);
      if (sigM && cur) {
        // Windows signal % maps roughly to RSSI: 100% ≈ -40 dBm, 50% ≈ -80.
        cur.rssi = -40 - Math.round((100 - Number(sigM[1])) * 0.8);
        continue;
      }
      // nmcli: first field is SSID, second is BSSID (colon-separated).
      const nmcli = line.split(":");
      if (nmcli.length >= 2 && /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(nmcli[1])) {
        flush();
        cur = { ssid: nmcli[0].trim(), bssid: nmcli[1].toUpperCase(), rssi: null };
        flush();
      }
    }
    flush();

    // Fallback (macOS `airport -s` / anything we could not parse): pull raw
    // MACs so we still get a fingerprint even without names or signal.
    if (aps.length === 0) {
      const macRe = /([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g;
      for (const mac of raw.match(macRe) || []) {
        const upper = mac.toUpperCase();
        if (!seen.has(upper)) {
          seen.add(upper);
          aps.push({ bssid: upper, ssid: null, rssi: null });
        }
      }
    }

    return aps.slice(0, 12).map((ap) => ({
      bssid: ap.bssid,
      ssid: ap.ssid || null,
      rssi: ap.rssi ?? -60,
    }));
  }

  /* ---------------- Signal 2: IP geolocation ---------------- */

  ipGeolocate() {
    return new Promise((resolve) => {
      const req = https.get("https://ipapi.co/json/", { timeout: 8000 }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            resolve({
              ip: j.ip,
              city: j.city,
              region: j.region,
              lat: parseFloat(j.latitude),
              lng: parseFloat(j.longitude),
            });
          } catch (_) {
            resolve(null);
          }
        });
      });
      // The `timeout` option only emits an event — destroy the socket so the
      // promise always settles and the tracking loop never stalls.
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(null));
    });
  }

  /* ---------------- Fusion: build the fix ---------------- */

  buildFix(wifi, ip, geo) {
    const now = new Date().toISOString();
    const networks = wifi && wifi.length > 0 ? wifi : [];

    // Signal 1: a REAL server-resolved Wi-Fi position. Never fabricated.
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
      return {
        lat: geo.lat,
        lng: geo.lng,
        accuracy: Number.isFinite(Number(geo.accuracy)) ? Number(geo.accuracy) : 50,
        source: "wifi_resolved",
        ipAddress: ip ? ip.ip : null,
        networks,
        timestamp: now,
        confidence: 80,
        resolvedBy: geo.source || "wifi_resolved",
      };
    }

    // Signal 2: IP geolocation (city-level, always available). The Wi-Fi
    // fingerprint still rides along so the dashboard can match by network.
    if (ip && ip.lat && ip.lng) {
      return {
        lat: ip.lat,
        lng: ip.lng,
        accuracy: 1200, // IP geolocation is city-level
        source: "ip",
        ipAddress: ip.ip,
        networks,
        timestamp: now,
        confidence: 55,
      };
    }

    // Signal 3: last known — honest answer, marked as such.
    if (this.lastFix) {
      return {
        ...this.lastFix,
        source: "last_known",
        confidence: Math.max(10, Math.round(this.lastFix.confidence * 0.7)),
        timestamp: now,
        lastKnownFrom: this.lastFix.timestamp,
      };
    }

    return null;
  }
}

module.exports = { TrackingEngine };
