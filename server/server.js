/**
 * Dravex Sync Server.
 *
 * Zero-dependency Node HTTP server that connects desktop agents to the web
 * dashboard:
 *
 *   POST /api/pair/register     dashboard → creates a pairing code for an agent
 *   POST /api/pair/claim        agent     → claims a code, links its identity
 *   GET  /api/devices           dashboard → list paired devices
 *   POST /api/devices/:id/fixes agent    → upload a location fix
 *   GET  /api/devices/:id/fixes dashboard → latest fixes
 *   POST /api/devices/:id/evidence agent → upload webcam evidence
 *   GET  /api/devices/:id/evidence dashboard → evidence list
 *   POST /api/devices/:id/commands dashboard → queue a remote command
 *   GET  /api/devices/:id/commands agent → poll for pending commands
 *   GET  /api/alerts/latest     dashboard → recent alerts + unread count
 *   POST /api/alerts/read       dashboard → mark alert(s) read
 *   GET  /api/push/vapid-key    dashboard → VAPID public key for subscribing
 *   POST /api/push/subscribe    dashboard → store a push subscription
 *   POST /api/push/test         dashboard → send a test push to all subscribers
 *   GET  /api/settings          dashboard → SMS-alert config + provider status
 *   POST /api/settings          dashboard → save owner phone + enable SMS
 *   POST /api/sms/test          dashboard → send a test SMS to the owner
 *   GET  /api/check             public    → stolen-device check (IMEI/serial)
 *
 * Security status (Phase 1): the API is intentionally unauthenticated so the
 * agents and the public check can work with zero setup. The pairing code and
 * deviceId are the de-facto secrets. That means anyone who can reach the API
 * can also read the recoveryCode returned by POST /lost or delivered in the
 * command payload — Phase 2 must gate /lost, /devices and /commands behind
 * real auth. /api/check is rate-limited (30/min/IP) against enumeration.
 *
 * Storage is dual-mode (storage.js): a JSON file by default, or Neon
 * Postgres the moment DATABASE_URL is set — the API contract never changes.
 * Reconnects and SIM changes raise in-app alerts, web pushes AND an SMS
 * fallback to the owner's number (sms.js) when one is configured.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { createStorage } = require("./storage");
const { getVapidKeys, notifyAll } = require("./push");
const { maskPhone, normalizePhone, sendSms, smsStatus } = require("./sms");
const { resolveBeacon } = require("./beacon");

// Zero-dependency .env loader (server/.env — gitignored). Runs before
// storage decides its mode so DATABASE_URL is honoured. Existing process
// env (e.g. Render dashboard) always wins.
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
} catch (_) {
  /* non-fatal */
}

const PORT = process.env.PORT || 4173;
// Location + evidence data must not be exposed to the LAN by default.
const HOST = process.env.HOST || "127.0.0.1";
const FIX_HISTORY_LIMIT = 100;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // evidence photos are data: URLs — cap uploads

/* ---------------- store ---------------- */

const DEFAULT_SETTINGS = {
  ownerPhone: "",
  smsEnabled: true,
  smsLastSentAt: null,
  smsLastResult: null,
};

let store = { devices: {}, pairCodes: {}, alerts: [], pushSubscriptions: [], settings: DEFAULT_SETTINGS, stolen: [] };

// Nigerian mobile operators by MNC (MCC 621). The Android agent fingerprints
// the SIM as "<mcc><mnc>|<state>" — decode it so the dashboard can show the
// operator on a phone, and name the operator a swapped-in SIM was replaced by.
const NIGERIA_OPERATORS = {
  "01": "MTEL",
  "20": "MTN",
  "25": "Visafone",
  "30": "Airtel",
  "50": "Glo",
  "60": "9mobile",
  "99": "Smile",
};

function operatorName(fingerprint) {
  const mccmnc = String(fingerprint || "").split("|")[0].trim();
  const m = mccmnc.match(/^(\d{3})(\d+)$/);
  if (!m) return mccmnc ? `MCC ${mccmnc}` : null;
  if (m[1] === "621") return NIGERIA_OPERATORS[m[2]] || `MNC ${m[2]}`;
  return `${m[1]} · ${NIGERIA_OPERATORS[m[2]] || m[2]}`;
}

/** The operator the device is currently (or last) running a SIM from. */
function deviceOperator(dev) {
  const sim = (dev.events || []).filter((e) => e.type === "sim_change").pop();
  const fp = sim && sim.detail ? sim.detail.to || sim.detail.from : null;
  return operatorName(fp);
}

/** Phones run the Android/iOS agent; everything else is a laptop/desktop. */
function deviceType(dev) {
  return ["android", "ios"].includes(dev.platform) ? "phone" : "laptop";
}
const storage = createStorage();

let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.write(store), 200);
}

/* ---------------- helpers ---------------- */

function device(id) {
  if (!store.devices[id]) {
    store.devices[id] = {
      deviceId: id,
      hostname: null,
      serialNumber: null,
      imei: null, // phones only (laptops have serial numbers instead)
      platform: null,
      pairedAt: null,
      lastSeenAt: null,
      reconnectedAt: null,
      lastFix: null,
      fixes: [],
      evidence: [],
      commands: [],
      events: [],
      sightings: [],
      lost: false,
    };
  }
  return store.devices[id];
}

/**
 * Record a fix. lastSeenAt always moves forward (so the dashboard's "last
 * seen" is honest), and a fix arriving after a long silence is recorded as
 * a "reconnected" event — the stolen phone surfaced online.
 */
function storeFix(dev, fix) {
  const now = new Date().toISOString();
  dev.events = dev.events || [];
  if (dev.lastSeenAt) {
    const gapHours = (Date.now() - new Date(dev.lastSeenAt).getTime()) / 3.6e6;
    if (gapHours > 12) {
      dev.reconnectedAt = now;
      dev.events.push({
        type: "reconnected",
        at: now,
        detail: { gapHours: Math.round(gapHours) },
      });
      raiseAlert("reconnected", dev, `${dev.hostname || "A device"} came back online after ${Math.round(gapHours)}h offline.`);
    }
  }
  dev.lastFix = { ...fix, receivedAt: now };
  dev.fixes.push(dev.lastFix);
  if (dev.fixes.length > FIX_HISTORY_LIMIT) dev.fixes = dev.fixes.slice(-FIX_HISTORY_LIMIT);
  dev.lastSeenAt = now;
}

/** Record a device event (sim_change, etc.) and refresh lastSeenAt. */
function storeEvent(dev, event) {
  dev.events = dev.events || [];
  dev.events.push({ ...event, at: event.at || new Date().toISOString() });
  dev.lastSeenAt = new Date().toISOString();
  if (event.type === "sim_change") {
    const to = event.detail && event.detail.to;
    raiseAlert("sim_change", dev, `The SIM card in ${dev.hostname || "your device"} was changed${to ? ` (new SIM: ${to})` : ""} — the phone is likely being reused.`);
  }
}

/**
 * Push an in-app alert into the alerts store (capped ring buffer), then ping
 * every registered push subscription so the owner's browser notifies them.
 */
function raiseAlert(type, dev, body, opts = {}) {
  store.alerts = store.alerts || [];
  store.alerts.push({
    id: randomUUID(),
    type,
    deviceId: dev.deviceId,
    hostname: dev.hostname || "a device",
    body,
    at: new Date().toISOString(),
    read: false,
  });
  if (store.alerts.length > 50) store.alerts = store.alerts.slice(-50);
  saveStore();
  // Fire-and-forget: never block the request on push or SMS delivery.
  notifyAll(store, saveStore).catch(() => {});
  // opts.sms === false (community sightings) keeps SMS budget for the truly
  // urgent signals — every sighting could otherwise drain the owner's quota.
  if (opts.sms !== false) smsNotify(store, store.alerts[store.alerts.length - 1]);
}

/**
 * A community BLE sighting: another Dravex phone heard this device's
 * beacon. Privacy-first: sightings are ONLY recorded for devices the owner
 * has marked LOST (the beacon only broadcasts while lost), and alerts are
 * throttled to one per 30 min per device so a noisy area or a beacon replay
 * can't flood the owner's phone.
 */
const SIGHTING_ALERT_MIN_MS = 30 * 60_000;

function storeSighting(dev, sighting) {
  if (!dev.lost) return; // never store sightings for non-lost devices
  dev.sightings = dev.sightings || [];
  dev.sightings.push({ ...sighting, receivedAt: new Date().toISOString() });
  if (dev.sightings.length > 50) dev.sightings = dev.sightings.slice(-50);
  saveStore();
  const now = Date.now();
  if (dev.lastSightingAlertAt && now - new Date(dev.lastSightingAlertAt).getTime() < SIGHTING_ALERT_MIN_MS) {
    return;
  }
  dev.lastSightingAlertAt = new Date().toISOString();
  raiseAlert(
    "sighting",
    dev,
    `${dev.hostname || "Your device"} was just seen by a Dravex phone nearby (${sighting.lat.toFixed(4)}°, ${sighting.lng.toFixed(4)}°). A community member heard its Bluetooth beacon — move now.`,
    { sms: false },
  );
}

/**
 * Fire-and-forget SMS fallback for the owner — works when push can't reach
 * them (browser closed, no data). Log mode until a provider is configured.
 *
 * Rate-limited (1 SMS / 60 s, 10 / rolling hour): the events endpoint is
 * unauthenticated in Phase 1, so this caps SMS-cost abuse if a pairing code
 * gets spammed with fake sim_change events.
 */
function smsNotify(store, alert) {
  const s = store.settings || {};
  if (s.smsEnabled === false || !s.ownerPhone) return;
  const now = Date.now();
  if (s.smsLastSentAt && now - new Date(s.smsLastSentAt).getTime() < 60_000) return;
  if (!s.smsWindow || now - s.smsWindow.start > 3.6e6) {
    s.smsWindow = { start: now, count: 0 };
  }
  if (s.smsWindow.count >= 10) return;
  s.smsWindow.count += 1;
  const prefix = alert.type === "sim_change" ? "SIM CHANGE" : "DEVICE ONLINE";
  sendSms(s.ownerPhone, `[Dravex] ${prefix}: ${alert.body}`)
    .then((result) => {
      s.smsLastSentAt = new Date().toISOString();
      s.smsLastResult = result;
      saveStore();
    })
    .catch(() => {});
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    let tooLarge = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy(); // abort the stream; 'error' below resolves
      }
    });
    req.on("end", () => {
      if (tooLarge) return resolve({});
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

/* ---------------- stolen-device registry ---------------- */

/**
 * Dravex Device Check — the buyer-protection registry.
 *
 * When an owner marks a device LOST, a public entry is created keyed by IMEI
 * (phones) or serial number (laptops). Anyone can query it at GET /api/check
 * — no auth, and NEVER any owner, deviceId or location details. Resolved
 * entries (owner recovered the device) come back as "clean" so honest
 * sellers aren't flagged by an old report.
 */
function syncRegistry(dev) {
  store.stolen = store.stolen || [];
  let entry = store.stolen.find((e) => e.deviceId === dev.deviceId);
  if (dev.lost) {
    if (!entry) {
      store.stolen.push({
        id: randomUUID(),
        deviceId: dev.deviceId,
        type: deviceType(dev),
        imei: dev.imei || null,
        serialNumber: dev.serialNumber || null,
        label: dev.hostname || "A device",
        status: "reported",
        reportedAt: new Date().toISOString(),
        resolvedAt: null,
      });
    } else {
      entry.status = "reported";
      entry.resolvedAt = null;
      if (dev.imei) entry.imei = dev.imei;
      if (dev.serialNumber) entry.serialNumber = dev.serialNumber;
      if (dev.hostname) entry.label = dev.hostname;
    }
  } else {
    // Owner says found: resolve EVERY active report on this physical device's
    // identifiers (IMEI/serial are unique per device). A recovered device must
    // read clean again — a stale duplicate report must never keep it flagged.
    const mine = [dev.imei, dev.serialNumber].filter(Boolean);
    const now = new Date().toISOString();
    (store.stolen || []).forEach((e) => {
      if (e.status !== "reported") return;
      if ((e.imei && mine.includes(e.imei)) || (e.serialNumber && mine.includes(e.serialNumber))) {
        e.status = "resolved";
        e.resolvedAt = now;
      }
    });
  }
}

/**
 * Match a public check query (IMEI digits or serial alphanumerics).
 * An ACTIVE report always wins over a resolved one for the same identifier —
 * buyers must see the live stolen listing even if an older report for that
 * serial/IMEI was resolved by a previous owner or a re-run.
 */
function registryLookup(query) {
  const digits = String(query || "").replace(/\D/g, "");
  const alpha = String(query || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const hits = (store.stolen || []).filter(
    (e) =>
      (e.imei && e.imei.replace(/\D/g, "") === digits) ||
      (e.serialNumber && e.serialNumber.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() === alpha),
  );
  return hits.find((e) => e.status === "reported") || hits[0] || null;
}

/**
 * Public verdict. NEVER exposes owner data: the label is a generic type label
 * ("A phone"/"A laptop") — an owner's hostname (e.g. "Ada-MacBook-Pro") must
 * never be readable by anyone who checks an IMEI.
 */
function registryVerdict(entry) {
  const genericLabel = entry ? (entry.type === "phone" ? "A phone" : "A laptop") : null;
  if (entry && entry.status === "reported") {
    return {
      found: true,
      status: "reported_stolen",
      type: entry.type,
      label: genericLabel,
      reportedAt: entry.reportedAt,
      message:
        "This device is listed in the Dravex stolen-device registry. Do not buy it — report it to the nearest police station.",
    };
  }
  return {
    found: false,
    status: "clean",
    type: entry ? entry.type : null,
    label: genericLabel,
    previouslyReported: !!entry,
    message: entry
      ? "No active stolen report for this device (a past report was resolved by the owner)."
      : "No stolen-device report found for this IMEI/serial. Ask for the original receipt and verify it powers on without a lock.",
  };
}

/*
 * Public-check rate limit (30/min per IP, in-memory): /api/check is a
 * deliberately open oracle, so a simple limiter stops registry enumeration
 * (repeated queries differing by reported-vs-clean). Not a security boundary
 * — it's friction, and Phase-2 auth will replace it.
 */
const checkHits = new Map();
function checkRateLimited(ip) {
  const now = Date.now();
  if (checkHits.size > 500) {
    for (const [k, v] of checkHits) {
      if (!v.some((t) => now - t < 60_000)) checkHits.delete(k);
    }
  }
  const recent = (checkHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 30) {
    checkHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  checkHits.set(ip, recent);
  return false;
}

/* ---------------- routes ---------------- */

async function route(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean); // ['api', 'devices', ':id', 'fixes']
  const isPost = req.method === "POST";

  if (url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      devices: Object.keys(store.devices).length,
      mode: storage.mode,
      time: new Date().toISOString(),
    });
  }

  // GET /api/check?imei=… | ?serial=… | ?q=… — public Dravex Device Check.
  // Buyer protection: query the stolen registry before buying a used phone or
  // laptop. Returns a verdict ONLY — never owner, deviceId or location data.
  if (!isPost && url.pathname === "/api/check") {
    if (checkRateLimited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many checks — try again in a minute." });
    }
    const q = url.searchParams.get("q") || url.searchParams.get("imei") || url.searchParams.get("serial") || "";
    const cleaned = String(q).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (cleaned.length < 6) {
      return json(res, 400, { error: "Enter a valid IMEI or serial number (at least 6 characters)." });
    }
    return json(res, 200, registryVerdict(registryLookup(cleaned)));
  }

  // GET /api/alerts/latest?since=<iso> → { alerts: [...recent], unreadCount }
  if (!isPost && url.pathname === "/api/alerts/latest") {
    const since = url.searchParams.get("since");
    let alerts = [...(store.alerts || [])].reverse().slice(0, 20);
    if (since) alerts = alerts.filter((a) => a.at > since);
    return json(res, 200, {
      alerts,
      unreadCount: (store.alerts || []).filter((a) => !a.read).length,
    });
  }

  // POST /api/alerts/read { id } | { all: true }
  if (isPost && url.pathname === "/api/alerts/read") {
    const body = await readBody(req);
    if (body.all) {
      (store.alerts || []).forEach((a) => (a.read = true));
    } else {
      const alert = (store.alerts || []).find((a) => a.id === body.id);
      if (alert) alert.read = true;
    }
    saveStore();
    return json(res, 200, { ok: true });
  }

  // GET /api/push/vapid-key → { publicKey } (base64url raw P-256 point)
  if (!isPost && url.pathname === "/api/push/vapid-key") {
    const keys = getVapidKeys(store, saveStore);
    return json(res, 200, { publicKey: keys.publicKey });
  }

  // POST /api/push/subscribe { subscription: PushSubscriptionJSON }
  if (isPost && url.pathname === "/api/push/subscribe") {
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== "string" || !sub.keys) {
      return json(res, 400, { error: "Missing subscription." });
    }
    store.pushSubscriptions = store.pushSubscriptions || [];
    store.pushSubscriptions = store.pushSubscriptions.filter((s) => s.endpoint !== sub.endpoint);
    store.pushSubscriptions.push({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      createdAt: new Date().toISOString(),
    });
    saveStore();
    return json(res, 201, { ok: true });
  }

  // POST /api/push/test → ping every subscription, report per-endpoint result
  if (isPost && url.pathname === "/api/push/test") {
    const results = await notifyAll(store, saveStore);
    return json(res, 200, { ok: true, results });
  }

  // GET /api/settings → owner SMS-alert config + provider status.
  // The phone number is returned MASKED — this endpoint is unauthenticated
  // and the server binds 0.0.0.0 in production.
  if (!isPost && url.pathname === "/api/settings") {
    return json(res, 200, {
      ownerPhone: maskPhone(store.settings.ownerPhone),
      smsEnabled: store.settings.smsEnabled !== false,
      sms: smsStatus(store),
    });
  }

  // POST /api/settings { ownerPhone?, smsEnabled? } → save + return config
  if (isPost && url.pathname === "/api/settings") {
    const body = await readBody(req);
    if (body.ownerPhone !== undefined) {
      const normalized = normalizePhone(String(body.ownerPhone));
      if (!normalized) {
        return json(res, 400, { error: "Enter a valid phone number, e.g. +2348012345678." });
      }
      store.settings.ownerPhone = normalized;
    }
    if (body.smsEnabled !== undefined) store.settings.smsEnabled = !!body.smsEnabled;
    saveStore();
    // The POST response returns the raw number (the owner just typed it and
    // the dashboard needs it back for the input field).
    return json(res, 200, {
      ownerPhone: store.settings.ownerPhone,
      smsEnabled: store.settings.smsEnabled !== false,
      sms: smsStatus(store),
    });
  }

  // POST /api/sms/test → text the owner now (log mode until a provider is set)
  if (isPost && url.pathname === "/api/sms/test") {
    const owner = store.settings.ownerPhone;
    if (!owner) {
      return json(res, 400, { error: "Set your phone number first — POST /api/settings { ownerPhone }." });
    }
    const result = await sendSms(
      owner,
      "[Dravex] Test SMS — SMS alerts are working. You will be texted here if a device reconnects or its SIM changes.",
    );
    store.settings.smsLastSentAt = new Date().toISOString();
    store.settings.smsLastResult = result;
    saveStore();
    return json(res, 200, result);
  }

  // POST /api/sightings { beacon, lat, lng, accuracy, at? } — the community
  // BLE relay: any Dravex phone that hears a device's beacon reports it
  // here with the SCANNER's GPS position. Anonymous (the scanner may be any
  // user's phone) — always answer 201 so nobody can probe which beacons exist.
  if (isPost && url.pathname === "/api/sightings") {
    const body = await readBody(req);
    const beacon = String(body.beacon || "").trim().toLowerCase();
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (beacon && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const dev = resolveBeacon(store, beacon);
      if (dev) {
        storeSighting(dev, {
          beacon,
          lat,
          lng,
          accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null,
          at: typeof body.at === "string" ? body.at : new Date().toISOString(),
        });
      }
    }
    return json(res, 201, { ok: true });
  }

  // POST /api/pair/register { label } → { code, deviceId }
  if (isPost && parts.join("/") === "api/pair/register") {
    const body = await readBody(req);
    const deviceId = randomUUID();
    const code = body.label
      ? `DX-${body.label.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}-${Math.floor(1000 + Math.random() * 9000)}`
      : `DX-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
    store.pairCodes[code] = deviceId;
    device(deviceId);
    saveStore();
    return json(res, 201, { code, deviceId });
  }

  // POST /api/pair/claim { code, hostname, serialNumber, platform } → { deviceId }
  if (isPost && parts.join("/") === "api/pair/claim") {
    const body = await readBody(req);
    const deviceId = store.pairCodes[body.code];
    if (!deviceId) return json(res, 404, { error: "Unknown or expired pairing code." });
    const dev = device(deviceId);
    dev.hostname = body.hostname || dev.hostname;
    dev.serialNumber = body.serialNumber || dev.serialNumber;
    dev.imei = body.imei || dev.imei;
    dev.platform = body.platform || dev.platform;
    dev.pairedAt = dev.pairedAt || new Date().toISOString();
    dev.lastSeenAt = new Date().toISOString();
    delete store.pairCodes[body.code]; // single use
    saveStore();
    return json(res, 200, { deviceId });
  }

  // GET /api/devices
  if (!isPost && parts.join("/") === "api/devices") {
    const list = Object.values(store.devices).map((d) => ({
      deviceId: d.deviceId,
      hostname: d.hostname,
      serialNumber: d.serialNumber,
      imei: d.imei,
      platform: d.platform,
      pairedAt: d.pairedAt,
      lastSeenAt: d.lastSeenAt,
      reconnectedAt: d.reconnectedAt,
      lastFix: d.lastFix,
      commandCount: d.commands.length,
      evidenceCount: d.evidence.length,
      events: (d.events || []).slice(-20),
      type: deviceType(d),
      lost: !!d.lost,
      operator: deviceOperator(d),
      sightingCount: (d.sightings || []).length,
    }));
    return json(res, 200, list);
  }

  // /api/devices/:id/... (devices are only created by pair/register and claim)
  if (parts[0] === "api" && parts[1] === "devices" && parts[2]) {
    const dev = store.devices[parts[2]];
    if (!dev) return json(res, 404, { error: "Device not found." });
    const action = parts[3];

    if (action === "fixes") {
      if (isPost) {
        const body = await readBody(req);
        if (!body.fix) return json(res, 400, { error: "Missing fix." });
        storeFix(dev, body.fix);
        saveStore();
        return json(res, 201, { ok: true });
      }
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "10", 10));
      return json(res, 200, dev.fixes.slice(-limit).reverse());
    }

    // POST /api/devices/:id/batch { items: [{type, fix|dataUrl|event}] } —
    // the agent's offline-vault burst sync (one call, many items).
    if (action === "batch") {
      if (isPost) {
        const body = await readBody(req);
        const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
        let received = 0;
        for (const item of items) {
          try {
            if (item && item.type === "fix" && item.fix) {
              storeFix(dev, item.fix);
              received++;
            } else if (item && item.type === "evidence" &&
                typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:image/")) {
              dev.evidence.push({
                id: randomUUID(),
                dataUrl: item.dataUrl,
                capturedAt: item.capturedAt || new Date().toISOString(),
                receivedAt: new Date().toISOString(),
              });
              dev.lastSeenAt = new Date().toISOString();
              received++;
            } else if (item && item.type === "event" && item.event && typeof item.event.type === "string") {
              storeEvent(dev, item.event);
              received++;
            }
          } catch (_) {
            /* skip malformed item */
          }
        }
        saveStore();
        return json(res, 201, { ok: true, received, failed: items.length - received });
      }
      return json(res, 400, { error: "POST only." });
    }

    // POST /api/devices/:id/events { event: {type, detail} } — SIM changes,
    // reconnects and other device lifecycle signals.
    if (action === "events") {
      if (isPost) {
        const body = await readBody(req);
        const ev = body.event;
        if (!ev || typeof ev.type !== "string") return json(res, 400, { error: "Missing event." });
        storeEvent(dev, ev);
        saveStore();
        return json(res, 201, { ok: true });
      }
      return json(res, 200, [...(dev.events || [])].reverse());
    }

    // POST /api/devices/:id/lost { lost: bool } — owner marks the device lost.
    // Sets the flag (sightings then raise alerts) AND queues a `lost`/`found`
    // command so the phone agent arms/disarms its community beacon itself —
    // the beacon is only ever broadcast while lost (privacy-first).
    if (action === "lost" && isPost) {
      const body = await readBody(req);
      dev.lost = !!body.lost;
      if (dev.lost) {
        // Recovery code for the app-level ownership check: accept an owner-set
        // 4-8 digit PIN, otherwise generate one — the dashboard shows it so
        // the owner can unlock the app if the phone comes back to them.
        if (body.recoveryCode !== undefined) {
          const code = String(body.recoveryCode).replace(/\D/g, "").slice(0, 8);
          if (code.length >= 4) dev.recoveryCode = code;
        }
        if (!dev.recoveryCode) dev.recoveryCode = String(Math.floor(100000 + Math.random() * 900000));
        dev.events.push({
          type: "lost",
          at: new Date().toISOString(),
          detail: { recoveryCode: !!dev.recoveryCode },
        });
        raiseAlert(
          "stolen",
          dev,
          `${dev.hostname || "A device"} was reported lost — community beacon armed. Nearby Dravex devices will now detect it.`,
        );
      } else {
        dev.recoveryCode = null;
        dev.events.push({ type: "found", at: new Date().toISOString() });
        raiseAlert("found", dev, `${dev.hostname || "A device"} was marked found.`);
      }
      if (!dev.commands.some((c) => c.type === (dev.lost ? "lost" : "found") && !c.executedAt)) {
        dev.commands.push({
          id: randomUUID(),
          type: dev.lost ? "lost" : "found",
          createdAt: new Date().toISOString(),
          executedAt: null,
          payload: dev.lost && dev.recoveryCode ? { recoveryCode: dev.recoveryCode } : undefined,
        });
      }
      // Feed the buyer-protection registry (IMEI / serial lookup).
      syncRegistry(dev);
      saveStore();
      return json(res, 200, {
        ok: true,
        lost: dev.lost,
        recoveryCode: dev.lost ? dev.recoveryCode : null,
      });
    }

    // GET /api/devices/:id/sightings — community BLE sightings, newest first.
    if (action === "sightings" && !isPost) {
      return json(res, 200, [...(dev.sightings || [])].reverse());
    }

    if (action === "evidence") {
      if (isPost) {
        const body = await readBody(req);
        if (typeof body.dataUrl !== "string" || !body.dataUrl.startsWith("data:image/")) {
          return json(res, 400, { error: "Evidence must be a data:image/ URL." });
        }
        dev.evidence.push({
          id: randomUUID(),
          dataUrl: body.dataUrl,
          capturedAt: body.capturedAt || new Date().toISOString(),
          receivedAt: new Date().toISOString(),
        });
        dev.lastSeenAt = new Date().toISOString();
        saveStore();
        return json(res, 201, { ok: true });
      }
      return json(res, 200, [...dev.evidence].reverse());
    }

    if (action === "commands") {
      // POST /api/devices/:id/commands/:cid/ack — agent confirms execution.
      // Must be checked before the generic commands handler below.
      if (isPost && parts[4] && parts[5] === "ack") {
        const cmd = dev.commands.find((c) => c.id === parts[4]);
        if (!cmd) return json(res, 404, { error: "Command not found." });
        cmd.executedAt = new Date().toISOString();
        saveStore();
        return json(res, 200, { ok: true });
      }

      if (isPost) {
        const body = await readBody(req);
        const type = ["lock", "alarm", "webcam"].includes(body.type) ? body.type : null;
        if (!type) return json(res, 400, { error: "Invalid command type." });
        dev.commands.push({
          id: randomUUID(),
          type,
          createdAt: new Date().toISOString(),
          executedAt: null,
        });
        saveStore();
        return json(res, 201, { ok: true, id: dev.commands[dev.commands.length - 1].id });
      }
      // Agent polls with ?after=<commandId> to get only newer commands.
      const after = url.searchParams.get("after");
      let pending = dev.commands.filter((c) => !c.executedAt);
      if (after) {
        const idx = dev.commands.findIndex((c) => c.id === after);
        pending = idx >= 0 ? pending.filter((c) => dev.commands.indexOf(c) > idx) : pending;
      }
      return json(res, 200, pending);
    }

    if (!isPost && !action) {
      return json(res, 200, {
        deviceId: dev.deviceId,
        hostname: dev.hostname,
        serialNumber: dev.serialNumber,
        imei: dev.imei,
        platform: dev.platform,
        pairedAt: dev.pairedAt,
        lastSeenAt: dev.lastSeenAt,
        reconnectedAt: dev.reconnectedAt,
        lastFix: dev.lastFix,
        evidenceCount: dev.evidence.length,
        commandCount: dev.commands.length,
        events: (dev.events || []).slice(-20),
        sightings: (dev.sightings || []).slice(-10).reverse(),
        type: deviceType(dev),
        lost: !!dev.lost,
        operator: deviceOperator(dev),
        sightingCount: (dev.sightings || []).length,
      });
    }

    return json(res, 404, { error: "Unknown action." });
  }

  return json(res, 404, { error: "Not found." });
}

/* ---------------- boot ---------------- */

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error("Route error:", err);
    json(res, 500, { error: "Internal error." });
  });
});

async function boot() {
  try {
    const loaded = await storage.load();
    if (loaded) {
      store = {
        devices: {},
        pairCodes: {},
        alerts: [],
        pushSubscriptions: [],
        settings: { ...DEFAULT_SETTINGS },
        ...loaded,
      };
      store.settings = { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) };
    }
  } catch (err) {
    console.error("Failed to load store:", err.message);
    if (storage.mode === "neon") {
      console.error("Neon is unreachable — fix DATABASE_URL or unset it to fall back to the JSON file.");
      process.exit(1);
    }
  }
  console.log(`Dravex sync server: storage = ${storage.describe()}`);
  server.listen(PORT, HOST, () => {
    console.log(`Dravex sync server listening on http://${HOST}:${PORT}`);
  });
}

boot();
