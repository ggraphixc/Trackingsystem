const { exec } = require("child_process");
const { EventEmitter } = require("events");
const fs = require("fs");
const https = require("https");

/**
 * TrackNaija desktop "signal ladder".
 *
 * Laptops have no GPS and no IMEI, so the ladder is:
 *   1. Wi-Fi positioning   — scan nearby BSSIDs (indoor-accurate)
 *   2. IP geolocation      — public IP lookup (coarse, always available)
 *   3. Last known fix      — whatever we stored last time
 *
 * A real deployment resolves BSSIDs against a Wi-Fi geolocation database
 * (e.g. Google Geolocation API / Mozilla Location). The scaffold demonstrates
 * the pipeline with a demo mapping + IP fallback.
 */
class TrackingEngine extends EventEmitter {
  constructor(stateFile) {
    super();
    this.stateFile = stateFile;
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
    const fix = this.buildFix(wifi, ip);
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

  parseWifi(raw) {
    const aps = [];
    const macRe = /([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g;
    const macs = raw.match(macRe) || [];
    for (const mac of macs.slice(0, 12)) {
      aps.push({ bssid: mac.toUpperCase(), rssi: -40 - Math.floor(Math.random() * 45) });
    }
    return aps;
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

  buildFix(wifi, ip) {
    const now = new Date().toISOString();

    // Demo mapping: if we see 1+ APs we assume an indoor (Wi-Fi-accurate)
    // position. In production, resolve BSSIDs against a geolocation DB.
    if (wifi && wifi.length > 0) {
      const base = this.lastFix && this.lastFix.source === "wifi" ? this.lastFix : null;
      return {
        lat: base ? base.lat + (Math.random() - 0.5) * 0.0006 : 6.5244 + (Math.random() - 0.5) * 0.01,
        lng: base ? base.lng + (Math.random() - 0.5) * 0.0006 : 3.3792 + (Math.random() - 0.5) * 0.01,
        accuracy: 30 + Math.round(Math.random() * 40), // ~30–70 m
        source: "wifi",
        ipAddress: ip ? ip.ip : null,
        networks: wifi.length,
        timestamp: now,
        confidence: 80,
      };
    }

    if (ip && ip.lat && ip.lng) {
      return {
        lat: ip.lat,
        lng: ip.lng,
        accuracy: 1200, // IP geolocation is city-level
        source: "ip",
        ipAddress: ip.ip,
        networks: 0,
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
