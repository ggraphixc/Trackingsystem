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
 *   POST /api/devices/:id/token owner    → rotate an agent's credential
 *
 * Security status: optional auth via DRAVEX_OWNER_KEY — when set, owner
 * endpoints need `Authorization: Bearer <key>` and agent endpoints need the
 * per-device token issued at claim. Without the env var, the API stays open
 * (Phase-1 zero-config default). The pairing code and deviceId are the
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
const { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } = require("crypto");
const { createStorage } = require("./storage");
const { getVapidKeys, notifyAll } = require("./push");
const { maskPhone, normalizePhone, sendSms, smsStatus } = require("./sms");
const { resolveBeacon } = require("./beacon");
const { recoveryConfidence, deriveCase, lifecycleState, caseStatus, buildTimeline } = require("./recovery-intel");

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
// A fix after this many hours of silence raises a "reconnected" alert. The
// theft lab overrides it to simulate a stolen phone surfacing online.
const RECONNECT_GAP_HOURS = Number(process.env.RECONNECT_GAP_HOURS) || 12;

/* ---------------- store ---------------- */

const DEFAULT_SETTINGS = {
  ownerPhone: "",
  smsEnabled: true,
  smsLastSentAt: null,
  smsLastResult: null,
  evidenceRetentionDays: 90, // N3: NDPA data-minimization (clamped 30–730)
};

let store = {
  devices: {},
  pairCodes: {},
  alerts: [],
  pushSubscriptions: [],
  settings: DEFAULT_SETTINGS,
  stolen: [],
  users: {}, // userId → { userId, email, passHash, salt, role, createdAt }
  sessions: {}, // token → { userId, createdAt } (zero-dependency session store)
  resetTokens: {}, // token → { userId, expiresAt } (password reset, 1 h TTL)
  deliveryLog: [], // alert-delivery attempts: { id, channel, ok, error?, at, alert? }
  listings: {}, // N5 verified resale: deviceId → { price, condition, listedAt, interests[] }
};

/*
 * Operational metrics (Phase 2.5 observability) — in-memory counters bumped
 * by every handler and surfaced at GET /api/admin/health. Not persisted:
 * they describe the current process, which is what ops needs.
 */
const metrics = {
  startedAt: new Date().toISOString(),
  fixes: { received: 0 },
  geolocate: { requests: 0, resolved: 0, unresolved: 0, limited: 0 },
  sightings: { received: 0, stored: 0, deduped: 0, ghosts: 0, limited: 0 },
  commands: { queued: 0, delivered: 0, acked: 0 },
  sms: { attempts: 0, ok: 0, failed: 0 },
  webhooks: { sent: 0, failed: 0 },
  alerts: { raised: 0 },
  errors: { route: 0 },
  security: { denied401: 0, rateLimited: 0, registryChecks: 0, registryHits: 0 },
  // N3 retention sweep + N4 operator health checks (surfaced at admin/health).
  purge: { runs: 0, fixes: 0, evidence: 0, sightings: 0, lastAt: null },
  ops: { checks: 0, fired: 0, lastAt: null, last: [] },
};

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

/**
 * P3: enrich a stored evidence item with owner-facing metadata for the
 * Evidence Center — capture source, retention/expiry status (from the N3
 * evidenceRetentionDays policy) and sha256 integrity. The raw image itself
 * is never re-hashed per request (computed once at capture); only the
 * persisted hash is surfaced.
 */
function evidenceMeta(dev, e) {
  const capturedAt = e.capturedAt || e.receivedAt;
  const expiresAt = new Date(new Date(capturedAt).getTime() + retentionDays() * 24 * 3.6e6).toISOString();
  return {
    id: e.id,
    dataUrl: e.dataUrl,
    capturedAt,
    receivedAt: e.receivedAt,
    deviceId: dev.deviceId,
    source: e.source || "webcam",
    expiresAt,
    retained: new Date(expiresAt).getTime() > Date.now(),
    sha256: e.sha256 || null,
  };
}

function device(id) {
  if (!store.devices[id]) {
    store.devices[id] = {
      deviceId: id,
      hostname: null,
      serialNumber: null,
      imei: null, // phones only (laptops have serial numbers instead)
      platform: null,
      token: randomBytes(24).toString("hex"), // agent credential (claim returns it)
      ownerId: null, // account that owns this device (Phase 2.5 accounts)
      staticBeacon: null, // Dravex Tag hardware: fixed 12-hex beacon id
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
    if (gapHours > RECONNECT_GAP_HOURS) {
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
  // P5: while a device is LOST, a fresh location fix is a recovery signal
  // worth alerting on — throttled to one per 30 min per device (the owner's
  // phone must not buzz on every 2-min scan). SMS budget is preserved.
  if (dev.lost && fix && fix.timestamp) {
    const fixAgeH = (Date.now() - new Date(fix.timestamp).getTime()) / 3.6e6;
    const nowMs = Date.now();
    const last = dev.lastFixAlertAt ? new Date(dev.lastFixAlertAt).getTime() : 0;
    if (fixAgeH <= 6 && nowMs - last >= 30 * 60_000) {
      dev.lastFixAlertAt = now;
      raiseAlert(
        "fix",
        dev,
        `${dev.hostname || "Your device"} reported a new location (${fix.lat?.toFixed ? fix.lat.toFixed(4) : fix.lat}°, ${fix.lng?.toFixed ? fix.lng.toFixed(4) : fix.lng}°, ${fix.source || "?"}) — check the recovery view.`,
        { sms: false },
      );
    }
  }
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
  const alert = {
    id: randomUUID(),
    type,
    deviceId: dev.deviceId,
    hostname: dev.hostname || "a device",
    body,
    at: new Date().toISOString(),
    read: false,
  };
  store.alerts.push(alert);
  if (store.alerts.length > 50) store.alerts = store.alerts.slice(-50);
  metrics.alerts.raised++;
  saveStore();
  // Fire-and-forget: never block the request on push, SMS or webhook delivery.
  notifyAll(store, saveStore).catch(() => {});
  // opts.sms === false (community sightings) keeps SMS budget for the truly
  // urgent signals — every sighting could otherwise drain the owner's quota.
  if (opts.sms !== false) smsNotify(store, alert);
  // Webhook/email sink (M6): ALERT_WEBHOOK_URL (comma-separated URLs allowed)
  // receives every alert as JSON — point it at a webhook-to-email service or
  // any alerting endpoint. Failure never blocks the sync request.
  const hooks = (process.env.ALERT_WEBHOOK_URL || "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u));
  for (const hook of hooks) {
    fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert }),
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => {
        metrics.webhooks.sent++;
        if (r.ok) {
          logDelivery("webhook", true, null, alert);
        } else {
          metrics.webhooks.failed++;
          logDelivery("webhook", false, `HTTP ${r.status}`, alert);
        }
      })
      .catch((err) => {
        metrics.webhooks.failed++;
        logDelivery("webhook", false, err.message || "network error", alert);
      });
  }
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
  metrics.sms.attempts++;
  sendSms(s.ownerPhone, `[Dravex] ${prefix}: ${alert.body}`)
    .then((result) => {
      s.smsLastSentAt = new Date().toISOString();
      s.smsLastResult = result;
      if (result && result.ok) {
        metrics.sms.ok++;
        logDelivery("sms", true, null, alert);
      } else {
        metrics.sms.failed++;
        logDelivery("sms", false, (result && result.error) || "provider rejected", alert);
      }
      saveStore();
    })
    .catch((err) => {
      metrics.sms.failed++;
      logDelivery("sms", false, err.message || "sms error", alert);
    });
}

function cors(req, res) {
  // Allowlist-first: when CORS_ORIGIN is set (production), only that origin
  // may call the API cross-origin; otherwise fall back to `*` for the
  // zero-config Phase-1 development mode. Never echo an untrusted origin.
  const allowed = process.env.CORS_ORIGIN || "*";
  const origin = req.headers.origin;
  if (allowed === "*" || !origin || origin === allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed === "*" ? "*" : allowed);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,PUT");
    // Authorization must be allowed: the web dashboard sends `Bearer <owner
    // key>` cross-origin, which otherwise fails the CORS preflight.
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
}

function json(res, status, body) {
  // Observability: every 401/429 is a signal (auth failures, rate-limit hits).
  if (status === 401) metrics.security.denied401++;
  if (status === 429) metrics.security.rateLimited++;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Append an alert-delivery attempt to the persisted ring buffer (newest
 * first, capped at 20) so the Service-health view can show what actually
 * reached the owner — SMS and webhook deliveries, successes and failures.
 */
function logDelivery(channel, ok, error, alert) {
  store.deliveryLog = store.deliveryLog || [];
  store.deliveryLog.unshift({
    id: randomUUID(),
    channel,
    ok: !!ok,
    error: error || null,
    at: new Date().toISOString(),
    alert: alert
      ? { id: alert.id, type: alert.type, deviceId: alert.deviceId, hostname: alert.hostname, body: alert.body }
      : null,
  });
  if (store.deliveryLog.length > 20) store.deliveryLog = store.deliveryLog.slice(0, 20);
  saveStore();
}

/* ---------------- N3: data retention (NDPA data-minimization) ---------------- */

/** Owner-configured retention window in days (clamped 30–730, default 90). */
function retentionDays() {
  const n = Number(store.settings && store.settings.evidenceRetentionDays);
  return Number.isFinite(n) && n >= 30 && n <= 730 ? Math.floor(n) : 90;
}

/**
 * Purge fixes/evidence/sightings older than the retention window. The most
 * recent fix per device is always kept (a device with no fix at all is useless
 * in a theft), and the `lastFix` snapshot survives regardless — NDPA
 * data-minimization without breaking recovery. Runs on a 6 h schedule, at
 * boot, and on demand via POST /api/admin/purge.
 */
function purgeExpiredData() {
  const cutoff = Date.now() - retentionDays() * 86400000;
  const purged = { fixes: 0, evidence: 0, sightings: 0 };
  for (const dev of Object.values(store.devices || {})) {
    // Purge by CAPTURE time (timestamp/capturedAt/at) — a burst-synced offline
    // vault legitimately uploads old fixes, and the retention window is about
    // when the data was created, not when it reached the server.
    const fixes = (dev.fixes || []).filter(
      (f) => new Date(f.timestamp || f.receivedAt || 0).getTime() >= cutoff,
    );
    if ((dev.fixes || []).length && fixes.length === 0 && dev.lastFix) fixes.push(dev.lastFix);
    purged.fixes += (dev.fixes || []).length - fixes.length;
    dev.fixes = fixes;

    const evidence = (dev.evidence || []).filter(
      (e) => new Date(e.capturedAt || e.receivedAt || 0).getTime() >= cutoff,
    );
    purged.evidence += (dev.evidence || []).length - evidence.length;
    dev.evidence = evidence;

    const sightings = (dev.sightings || []).filter(
      (s) => new Date(s.at || s.receivedAt || 0).getTime() >= cutoff,
    );
    purged.sightings += (dev.sightings || []).length - sightings.length;
    dev.sightings = sightings;
  }
  metrics.purge.runs += 1;
  metrics.purge.fixes += purged.fixes;
  metrics.purge.evidence += purged.evidence;
  metrics.purge.sightings += purged.sightings;
  metrics.purge.lastAt = new Date().toISOString();
  if (purged.fixes + purged.evidence + purged.sightings > 0) saveStore();
  return purged;
}

/* ---------------- N4: observability alerting (operator webhook) ---------------- */

// Thresholds, env-tunable (the theft lab lowers them to test the pipeline).
const OPS_INTERVAL_S = Number(process.env.OPS_ALERT_INTERVAL_S) || 60;
const OPS_COOLDOWN_S = Number(process.env.OPS_ALERT_COOLDOWN_S) || 900;
const OPS_GEO_MIN_REQUESTS = Number(process.env.OPS_GEO_MIN_REQUESTS) || 5;
const OPS_GEO_UNRESOLVED_RATIO = Number(process.env.OPS_GEO_UNRESOLVED_RATIO) || 0.5;
const OPS_DELIVERY_FAIL_DELTA = Number(process.env.OPS_DELIVERY_FAIL_DELTA) || 3;
const OPS_SURGE_MIN_CONNECTED = Number(process.env.OPS_SURGE_MIN_CONNECTED) || 2;
const OPS_RATE_LIMIT_STORM = Number(process.env.OPS_RATE_LIMIT_STORM) || 20;

const OPS_STATE = { last: null, lastConnected: null, cooldownUntil: {} };

/**
 * Evaluate the /api/admin/health surfaces against thresholds since the last
 * check. Returns the list of breached conditions (each fires at most once per
 * cooldown — dedupe so a persistent problem doesn't spam the operator).
 */
function opsBreaches() {
  const now = Date.now();
  const m = metrics;
  const prev = OPS_STATE.last || m;
  // { slug, message }: the cooldown dedupes by STABLE slug — the display
  // message embeds volatile numbers ("18 throttled…"), which would otherwise
  // change every check and defeat the cooldown (persistent problem → spam).
  const fired = [];

  const geo = m.geolocate;
  if (
    geo.requests >= OPS_GEO_MIN_REQUESTS &&
    geo.unresolved / geo.requests >= OPS_GEO_UNRESOLVED_RATIO
  ) {
    fired.push({ slug: "geolocate-unresolved", message: `geolocate unresolved spike: ${geo.unresolved}/${geo.requests} unresolved` });
  }

  const failDelta =
    m.sms.failed - prev.sms.failed + (m.webhooks.failed - prev.webhooks.failed);
  if (failDelta >= OPS_DELIVERY_FAIL_DELTA) {
    fired.push({ slug: "delivery-failures", message: `${failDelta} SMS/webhook delivery failure(s) in the last check window` });
  }

  const all = Object.values(store.devices || {});
  const connected = all.filter(
    (d) => d.lastSeenAt && now - new Date(d.lastSeenAt).getTime() < 5 * 60_000,
  ).length;
  if (
    OPS_STATE.lastConnected !== null &&
    OPS_STATE.lastConnected >= OPS_SURGE_MIN_CONNECTED &&
    connected < OPS_STATE.lastConnected / 2
  ) {
    fired.push({ slug: "offline-surge", message: `offline-device surge: connected ${OPS_STATE.lastConnected} → ${connected}` });
  }
  OPS_STATE.lastConnected = connected;

  const rateDelta = m.security.rateLimited - prev.security.rateLimited;
  if (rateDelta >= OPS_RATE_LIMIT_STORM) {
    fired.push({ slug: "rate-limit-storm", message: `rate-limit/abuse storm: ${rateDelta} throttled requests in the last check window` });
  }

  OPS_STATE.last = {
    sms: { ...m.sms },
    webhooks: { ...m.webhooks },
    security: { ...m.security },
  };
  return fired.filter((f) => !OPS_STATE.cooldownUntil[f.slug] || OPS_STATE.cooldownUntil[f.slug] <= now);
}

/**
 * Run one operator health check: any breached condition raises an "ops"
 * alert through the normal pipeline (push + ALERT_WEBHOOK_URL + delivery
 * log), each at most once per cooldown. Never throws.
 */
function runOpsHealthCheck() {
  metrics.ops.checks += 1;
  const fired = opsBreaches();
  metrics.ops.lastAt = new Date().toISOString();
  metrics.ops.last = fired.map((f) => f.message);
  if (!fired.length) return { ok: true, fired: [] };
  const dev = { deviceId: "ops", hostname: "Dravex server" };
  for (const condition of fired) {
    OPS_STATE.cooldownUntil[condition.slug] = Date.now() + OPS_COOLDOWN_S * 1000;
    metrics.ops.fired += 1;
    raiseAlert("ops", dev, `Service-health check: ${condition.message}.`, { sms: false });
  }
  return { ok: true, fired: fired.map((f) => f.message) };
}

/* ---------------- N5: verified resale listings (second-life market) ---------------- */

/** Public-safe listing shape for a device (no owner data, no device secrets). */
function listingFor(deviceId) {
  const l = store.listings && store.listings[deviceId];
  if (!l) return null;
  return {
    price: l.price,
    condition: l.condition,
    listedAt: l.listedAt,
    interestCount: (l.interests || []).length,
  };
}

/** Match a public check query against LISTED devices (IMEI/serial → listing). */
function listingLookup(query) {
  const digits = String(query || "").replace(/\D/g, "");
  const alpha = String(query || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  for (const dev of Object.values(store.devices || {})) {
    const imeiHit = dev.imei && dev.imei.replace(/\D/g, "") === digits;
    const serialHit =
      dev.serialNumber && dev.serialNumber.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() === alpha;
    if ((imeiHit || serialHit) && store.listings && store.listings[dev.deviceId]) {
      return { dev, listing: store.listings[dev.deviceId] };
    }
  }
  return null;
}

/* ---------------- scheduled tasks (N3 + N4) ---------------- */

/**
 * P5 "device went offline" alerts. A device can only be KNOWN offline
 * retrospectively (there is no signal of absence), so this sweep runs on the
 * same 6 h schedule as retention: any LOST device whose lastSeenAt is older
 * than OFFLINE_ALERT_HOURS gets one "offline" alert per quiet episode.
 * Cooldown is keyed on the lastSeenAt value itself — the alert fires again
 * only if the device is seen again and then goes quiet once more (no spam on
 * an already-quiet device across sweeps). Honest framing: this is "quiet for
 * Xh", not a claim of tracking a powered-off device.
 */
const OFFLINE_ALERT_HOURS = Number(process.env.OFFLINE_ALERT_HOURS) || 6;

function checkOfflineDevices() {
  const now = Date.now();
  const threshold = OFFLINE_ALERT_HOURS * 3.6e6;
  for (const dev of Object.values(store.devices || {})) {
    if (!dev.lost || !dev.lastSeenAt) continue;
    if (dev.lastOfflineAlertedAt === dev.lastSeenAt) continue; // episode already reported
    const quietMs = now - new Date(dev.lastSeenAt).getTime();
    if (quietMs < threshold) continue;
    dev.lastOfflineAlertedAt = dev.lastSeenAt;
    saveStore();
    raiseAlert(
      "offline",
      dev,
      `${dev.hostname || "Your device"} has been quiet for ${Math.round(quietMs / 3.6e6)}h — data off or powered down. Dravex cannot track a powered-off phone; keep the IMEI trace (police → carrier) moving.`,
      { sms: false },
    );
  }
}

function startScheduledTasks() {
  setInterval(purgeExpiredData, 6 * 3600 * 1000).unref();
  setInterval(runOpsHealthCheck, Math.max(10, OPS_INTERVAL_S) * 1000).unref();
  setInterval(checkOfflineDevices, 6 * 3600 * 1000).unref();
  runOpsHealthCheck(); // baseline snapshot — never fires on a fresh process
  checkOfflineDevices(); // sweep once at boot too
  console.log(
    `Dravex scheduled tasks: retention sweep every 6 h (${retentionDays()} days), ops health check every ${OPS_INTERVAL_S}s, offline-quiet sweep every 6 h`,
  );
}

/* ---------------- optional auth (Phase 2-lite) ---------------- */

/**
 * When DRAVEX_OWNER_KEY is NOT set, everything stays open (Phase-1 default —
 * zero-config agents + dashboards). When it IS set:
 *   - owner endpoints (devices list, mark-lost, alerts, settings, command
 *     queue, evidence/sightings/fixes reads) require
 *     `Authorization: Bearer <DRAVEX_OWNER_KEY>`
 *   - device endpoints (fix/evidence/event upload, command poll/ack) require
 *     `Authorization: Bearer <deviceToken>` — issued at claim, rotate via
 *     POST /api/devices/:id/token
 * /api/health, /api/check, POST /api/sightings and POST /api/pair/claim stay
 * public (the single-use pairing code is the claim credential).
 */
const OWNER_KEY = process.env.DRAVEX_OWNER_KEY || "";

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
function ownerOk(req) {
  if (!OWNER_KEY) return true;
  if (bearer(req) === OWNER_KEY) return true;
  // Phase 2.5 accounts: a valid session token is ALSO an owner credential —
  // per-owner dashboards keep working even while DRAVEX_OWNER_KEY is set.
  return !!sessionUserId(req);
}
function deviceOk(req, dev) {
  if (!OWNER_KEY) return true;
  return !!dev.token && bearer(req) === dev.token;
}
function ownerOrDeviceOk(req, dev) {
  // A present account session scopes strictly to that owner: the legacy
  // open-mode/device-token bypass must not leak another owner's device to a
  // logged-in user (enforced in open AND key modes alike).
  if (sessionUserId(req)) return ownerOfDeviceOk(req, dev);
  return ownerOfDeviceOk(req, dev) || deviceOk(req, dev);
}

/**
 * Auth for endpoints that aren't scoped to one device but ARE called by
 * agents (e.g. /api/geolocate): the owner key, or ANY valid device token.
 * In open mode (no OWNER_KEY) this is always true.
 */
function anyDeviceOk(req) {
  if (!OWNER_KEY) return true;
  if (ownerOk(req)) return true;
  const bearer = req.headers.authorization || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
  return !!token && Object.values(store.devices).some((d) => d.token === token);
}

/* ----------------- Phase 2.5: per-owner accounts ----------------- */

/**
 * User accounts + sessions — the multi-owner model. Backward compatible:
 * DRAVEX_OWNER_KEY keeps working exactly as before, and in open mode
 * (no key) everything stays open. When a session token is present, owner
 * operations are scoped to that user's devices.
 *
 *   register/login → { token }   (Bearer <sessionToken> on later calls)
 *   devices claimed under a session get ownerId = that user's id
 *   GET /api/devices with a session returns ONLY that user's devices
 *   device-scoped owner actions check ownership (403 for other owners)
 */

function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 64).toString("hex");
}

function newSession(userId) {
  const token = randomBytes(32).toString("hex");
  store.sessions[token] = { userId, createdAt: new Date().toISOString() };
  // Bound the session map: a long-lived server must never grow it forever.
  const keys = Object.keys(store.sessions);
  if (keys.length > 5000) {
    const sorted = keys.sort((a, b) =>
      store.sessions[a].createdAt < store.sessions[b].createdAt ? -1 : 1,
    );
    for (const k of sorted.slice(0, keys.length - 5000)) delete store.sessions[k];
  }
  return token;
}

/** Resolve the session user from the Bearer token (or null). */
function sessionUserId(req) {
  const token = bearer(req);
  if (!token) return null;
  const s = store.sessions[token];
  return s ? s.userId : null;
}

/**
 * Ownership gate for a device. True when: open mode, owner key, or the
 * session user owns the device. Sessions are strict: a user can only act on
 * devices they claimed under their own account — legacy devices (ownerId
 * null) are unowned and must be claimed by an account to be controlled.
 */
function ownerOfDeviceOk(req, dev) {
  if (!ownerOk(req)) return false;
  const uid = sessionUserId(req);
  if (!uid) return true; // owner key (or open mode) sees all
  return dev.ownerId === uid;
}

/** 401 when unauthenticated; 403 when authed but wrong owner. */
function requireOwnerOf(req, res, dev) {
  if (!ownerOk(req)) {
    json(res, 401, { error: "Owner key or account session required." });
    return false;
  }
  if (!ownerOfDeviceOk(req, dev)) {
    json(res, 403, { error: "This device belongs to another owner." });
    return false;
  }
  return true;
}

/**
 * Administrative surfaces (service health, delivery retry) are OPERATOR-only:
 * the DRAVEX_OWNER_KEY, or open mode. An account session must never see other
 * owners' delivery logs / device aggregates, so these do NOT accept sessions.
 */
function adminOk(req) {
  if (!OWNER_KEY) return true; // open mode — no boundary exists
  return bearer(req) === OWNER_KEY;
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
 * In-memory per-IP rate limiters (sliding 60 s window). Each public or
 * semi-public surface gets its own so one channel can't be hammered without
 * affecting the others:
 *   check    30/min — /api/check (stolen-registry enumeration friction)
 *   claim    10/min — /api/pair/claim (pairing-code brute force)
 *   sighting 30/min — POST /api/sightings (fake-sighting floods)
 *   contact   5/min — POST /api/devices/:id/contact (finder-message spam)
 * Not a security boundary — friction + honesty, cheap to run.
 */
function makeLimiter(perMin) {
  const hits = new Map();
  return {
    limited(ip) {
      const now = Date.now();
      if (hits.size > 1000) {
        for (const [k, v] of hits) {
          if (!v.some((t) => now - t < 60_000)) hits.delete(k);
        }
      }
      const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
      if (recent.length >= perMin) {
        hits.set(ip, recent);
        return true;
      }
      recent.push(now);
      hits.set(ip, recent);
      return false;
    },
  };
}
const checkLimiter = makeLimiter(30);
const claimLimiter = makeLimiter(10);
const sightingLimiter = makeLimiter(30);
const contactLimiter = makeLimiter(5);
const geoLimiter = makeLimiter(20); // /api/geolocate hits a PAID provider
const authLimiter = makeLimiter(10); // register/login — public, brute-force + storage-DoS guard
const adminLimiter = makeLimiter(10); // admin retry-delivery — fires webhooks/SMS

/* ---------------- routes ---------------- */

async function route(req, res) {
  cors(req, res);
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
    if (checkLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many checks — try again in a minute." });
    }
    const q = url.searchParams.get("q") || url.searchParams.get("imei") || url.searchParams.get("serial") || "";
    const cleaned = String(q).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (cleaned.length < 6) {
      return json(res, 400, { error: "Enter a valid IMEI or serial number (at least 6 characters)." });
    }
    metrics.security.registryChecks++;
    const verdict = registryVerdict(registryLookup(cleaned));
    if (verdict.found) metrics.security.registryHits++;
    // N5: if this physical device is in a verified resale listing, tell the
    // buyer it is legitimately on the market (public-safe: price + condition
    // only, never owner data).
    const listed = listingLookup(cleaned);
    // Only advertise verified resale when the registry reads CLEAN — a listed
    // device whose current owner re-reported it lost must show STOLEN, never
    // both. (Listings require a transfer, which clears the registry, but the
    // new owner can mark it lost afterwards.)
    if (listed && !verdict.found) {
      verdict.resaleReady = true;
      verdict.listing = listingFor(listed.dev.deviceId);
      verdict.message =
        "This device is listed for verified resale by its owner — registry clean, ownership transferred.";
    }
    return json(res, 200, verdict);
  }

  // GET /api/public/recovery/:id — the Phase-3 finder experience (P4).
  // Public, rate-limited, and deliberately thin: a good samaritan who finds
  // a lost device lands here from the owner's shared recovery link and sees
  // ONLY that the device is lost + the owner's one-way recovery message.
  // NEVER exposed: location, operator, sightings, owner identity, phone,
  // email, or the reporting device's position. Unknown and not-lost IDs
  // return the SAME shape ({ lost: false }) so nobody can probe which IDs
  // exist — the anti-probe pattern used by /api/sightings.
  if (!isPost && parts[0] === "api" && parts[1] === "public" && parts[2] === "recovery" && parts[3]) {
    if (checkLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many requests — try again in a minute." });
    }
    const dev = store.devices[parts[3]];
    if (!dev || !dev.lost) {
      // Identical shape for unknown AND not-lost — no existence oracle.
      return json(res, 200, { lost: false, label: null, recoveryMessage: null });
    }
    return json(res, 200, {
      lost: true,
      label: deviceType(dev) === "phone" ? "A phone" : "A laptop",
      recoveryMessage: dev.recoveryMessage || null,
      caseId: dev.deviceId,
    });
  }

  // GET /api/alerts/latest?since=<iso> → { alerts: [...recent], unreadCount }
  if (!isPost && url.pathname === "/api/alerts/latest") {
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
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
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
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
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
    const keys = getVapidKeys(store, saveStore);
    return json(res, 200, { publicKey: keys.publicKey });
  }

  // POST /api/push/subscribe { subscription: PushSubscriptionJSON }
  if (isPost && url.pathname === "/api/push/subscribe") {
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
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
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
    const results = await notifyAll(store, saveStore);
    return json(res, 200, { ok: true, results });
  }

  // GET /api/settings → owner SMS-alert config + provider status.
  // The phone number is returned MASKED — this endpoint is unauthenticated
  // and the server binds 0.0.0.0 in production.
  if (!isPost && url.pathname === "/api/settings") {
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
    return json(res, 200, {
      ownerPhone: maskPhone(store.settings.ownerPhone),
      smsEnabled: store.settings.smsEnabled !== false,
      evidenceRetentionDays: retentionDays(),
      sms: smsStatus(store),
    });
  }

  // POST /api/settings { ownerPhone?, smsEnabled?, evidenceRetentionDays? } → save + return config
  if (isPost && url.pathname === "/api/settings") {
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
    const body = await readBody(req);
    if (body.ownerPhone !== undefined) {
      const normalized = normalizePhone(String(body.ownerPhone));
      if (!normalized) {
        return json(res, 400, { error: "Enter a valid phone number, e.g. +2348012345678." });
      }
      store.settings.ownerPhone = normalized;
    }
    if (body.smsEnabled !== undefined) store.settings.smsEnabled = !!body.smsEnabled;
    if (body.evidenceRetentionDays !== undefined) {
      const n = Number(body.evidenceRetentionDays);
      if (!Number.isFinite(n) || n < 30 || n > 730) {
        return json(res, 400, { error: "Evidence retention must be 30–730 days." });
      }
      store.settings.evidenceRetentionDays = Math.floor(n);
    }
    saveStore();
    // The POST response returns the raw number (the owner just typed it and
    // the dashboard needs it back for the input field).
    return json(res, 200, {
      ownerPhone: store.settings.ownerPhone,
      smsEnabled: store.settings.smsEnabled !== false,
      evidenceRetentionDays: retentionDays(),
      sms: smsStatus(store),
    });
  }

  // POST /api/sms/test → text the owner now (log mode until a provider is set)
  if (isPost && url.pathname === "/api/sms/test") {
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
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
    if (sightingLimiter.limited(req.socket.remoteAddress || "unknown")) {
      metrics.sightings.limited++;
      return json(res, 429, { error: "Too many sightings — slow down." });
    }
    const body = await readBody(req);
    const beacon = String(body.beacon || "").trim().toLowerCase();
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (beacon && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      metrics.sightings.received++;
      const dev = resolveBeacon(store, beacon);
      if (!dev) {
        metrics.sightings.ghosts++; // unknown beacon swallowed (anti-probe)
      } else {
        // Dedupe: the same scanner position for the same beacon within 5 min is
        // one sighting — a phone scanning on a duty cycle must not flood the
        // recovery view with identical reports.
        const sig = `${beacon}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
        const nowMs = Date.now();
        if (!dev.lastSightingSignatures) dev.lastSightingSignatures = [];
        const fresh = dev.lastSightingSignatures.filter((s) => nowMs - s.at < 5 * 60_000);
        if (!fresh.some((s) => s.key === sig)) {
          fresh.push({ key: sig, at: nowMs });
          if (fresh.length > 10) fresh = fresh.slice(-10);
          dev.lastSightingSignatures = fresh;
          metrics.sightings.stored++;
          storeSighting(dev, {
            beacon,
            lat,
            lng,
            accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null,
            at: typeof body.at === "string" ? body.at : new Date().toISOString(),
          });
        } else {
          metrics.sightings.deduped++;
        }
      }
    }
    return json(res, 201, { ok: true });
  }

  // POST /api/geolocate { bssids: ["A0:36:9F:11:22:33", …] } — owner/device
  // auth (owner key OR any valid device token), rate-limited 20/min/IP: this
  // endpoint calls a PAID geolocation provider, so it must not be open to
  // quota abuse. Resolves a Wi-Fi fingerprint into a real coordinate via
  // Google Geolocation API with Mozilla Location fallback. Cache: resolved
  // BSSIDs are remembered (30 days) so repeat scans never burn the quota.
  // WITHOUT GEOLOCATION_API_KEY it answers honestly:
  // 501 { source: "unresolved" } — the desktop must never fake a coordinate.
  if (isPost && url.pathname === "/api/geolocate") {
    if (!anyDeviceOk(req)) return json(res, 401, { error: "Owner key or device token required." });
    metrics.geolocate.requests++;
    if (geoLimiter.limited(req.socket.remoteAddress || "unknown")) {
      metrics.geolocate.limited++;
      return json(res, 429, { error: "Too many geolocation requests — try again in a minute." });
    }
    const body = await readBody(req);
    const bssids = (Array.isArray(body.bssids) ? body.bssids : [])
      .map((b) => String(b).trim().toUpperCase())
      .filter((b) => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(b))
      .slice(0, 20);
    if (bssids.length === 0) return json(res, 400, { error: "No valid BSSIDs provided." });

    // 1) Cache hit — the fingerprint is already resolved. Prune expired
    // entries opportunistically so the persisted geoCache never grows unbounded.
    store.geoCache = store.geoCache || {};
    const now = Date.now();
    if (store.geoCache._prunedAt === undefined || now - store.geoCache._prunedAt > 24 * 3.6e6) {
      store.geoCache._prunedAt = now;
      for (const [k, v] of Object.entries(store.geoCache)) {
        if (k !== "_prunedAt" && now - new Date(v.at).getTime() > 30 * 24 * 3.6e6) delete store.geoCache[k];
      }
      if (Object.keys(store.geoCache).length > 5000) {
        // Hard cap: keep only the 2000 freshest entries.
        const sorted = Object.entries(store.geoCache)
          .filter(([k]) => k !== "_prunedAt")
          .sort((a, b) => new Date(b[1].at) - new Date(a[1].at));
        store.geoCache = { _prunedAt: store.geoCache._prunedAt };
        for (const [k, v] of sorted.slice(0, 2000)) store.geoCache[k] = v;
      }
    }
    for (const b of bssids) {
      const hit = store.geoCache[b];
      if (hit && now - new Date(hit.at).getTime() < 30 * 24 * 3.6e6) {
        return json(res, 200, {
          ok: true,
          source: "wifi_resolved",
          lat: hit.lat,
          lng: hit.lng,
          accuracy: hit.accuracy,
          cached: true,
        });
      }
    }

    if (!process.env.GEOLOCATION_API_KEY) {
      metrics.geolocate.unresolved++;
      return json(res, 501, {
        ok: false,
        source: "unresolved",
        error: "Wi-Fi geolocation is not configured on this server (set GEOLOCATION_API_KEY).",
      });
    }

    // 2) Google Geolocation, then Mozilla Location as fallback.
    const wifiAccessPoints = bssids.map((macAddress) => ({ macAddress }));
    let resolved = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const resG = await fetch(
        `https://www.googleapis.com/geolocation/v1/geolocate?key=${encodeURIComponent(process.env.GEOLOCATION_API_KEY)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wifiAccessPoints }), signal: ctrl.signal },
      );
      clearTimeout(t);
      if (resG.ok) {
        const j = await resG.json();
        if (j && j.location && Number.isFinite(j.location.lat) && Number.isFinite(j.location.lng)) {
          resolved = { lat: j.location.lat, lng: j.location.lng, accuracy: Number(j.accuracy) || 50 };
        }
      }
    } catch (_) {
      /* fall through to Mozilla */
    }
    if (!resolved) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const resM = await fetch(
          `https://location.services.mozilla.com/v1/geolocate?key=${encodeURIComponent(process.env.GEOLOCATION_API_KEY)}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wifiAccessPoints }), signal: ctrl.signal },
        );
        clearTimeout(t);
        if (resM.ok) {
          const j = await resM.json();
          if (j && j.location && Number.isFinite(j.location.lat) && Number.isFinite(j.location.lng)) {
            resolved = { lat: j.location.lat, lng: j.location.lng, accuracy: Number(j.accuracy) || 100 };
          }
        }
      } catch (_) {
        /* unresolved */
      }
    }
    if (!resolved) {
      metrics.geolocate.unresolved++;
      return json(res, 502, { ok: false, source: "unresolved", error: "No geolocation provider answered for this fingerprint." });
    }
    // Cache the whole fingerprint so the next scan is instant and quota-free.
    for (const b of bssids) store.geoCache[b] = { ...resolved, at: new Date().toISOString() };
    metrics.geolocate.resolved++;
    saveStore();
    return json(res, 200, { ok: true, source: "wifi_resolved", ...resolved, cached: false });
  }

  // GET /api/nearest?lat=&lng=&maxM= — owner auth. The nearest device fix to
  // a point (used for "nearest device to a community sighting"). In Neon mode
  // this runs a real PostGIS ST_Distance query; file mode uses haversine with
  // the identical API contract.
  if (!isPost && url.pathname === "/api/nearest") {
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const maxM = Number(url.searchParams.get("maxM") || 50000);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return json(res, 400, { error: "Invalid coordinates." });
    }
    const nearest = await storage.nearestFix(store, lat, lng, Number.isFinite(maxM) ? maxM : 50000);
    return json(res, 200, { nearest });
  }

  // POST /api/auth/register { email, password } → { ok, userId, token }
  // Public but rate-limited (10/min/IP): registering fills the user store and
  // scrypt hashing is CPU work — an attacker must not be able to loop it.
  if (isPost && url.pathname === "/api/auth/register") {
    if (authLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many registration attempts — try again in a minute." });
    }
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json(res, 400, { error: "Enter a valid email address." });
    }
    if (password.length < 8) {
      return json(res, 400, { error: "Password must be at least 8 characters." });
    }
    store.users = store.users || {};
    if (Object.values(store.users).some((u) => u.email === email)) {
      // 409 doubles as an account-existence oracle — acceptable for now; the
      // 10/min/IP limit keeps it from being enumerable at scale.
      return json(res, 409, { error: "An account with this email already exists — log in instead." });
    }
    const userId = randomUUID();
    const salt = randomBytes(16).toString("hex");
    // Every account is an independent owner with an isolated device list:
    // devices claimed under a session belong to that user (ownerId).
    store.users[userId] = { userId, email, passHash: hashPassword(password, salt), salt, role: "owner", createdAt: new Date().toISOString() };
    const token = newSession(userId);
    saveStore();
    return json(res, 201, { ok: true, userId, token, email });
  }

  // POST /api/auth/login { email, password } → { ok, userId, token }
  if (isPost && url.pathname === "/api/auth/login") {
    if (authLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many login attempts — try again in a minute." });
    }
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = Object.values(store.users || {}).find((u) => u.email === email);
    if (!user) return json(res, 401, { error: "Unknown email or wrong password." });
    const hash = hashPassword(password, user.salt);
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(user.passHash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return json(res, 401, { error: "Unknown email or wrong password." });
    }
    const token = newSession(user.userId);
    saveStore();
    return json(res, 200, { ok: true, userId: user.userId, token, email: user.email });
  }

  // POST /api/auth/logout — invalidate the current session token.
  if (isPost && url.pathname === "/api/auth/logout") {
    const token = bearer(req);
    if (token && store.sessions[token]) delete store.sessions[token];
    saveStore();
    return json(res, 200, { ok: true });
  }

  // POST /api/auth/forgot { email } — issue a password-reset token (1 h TTL)
  // and deliver it via the ALERT_WEBHOOK_URL webhook (webhook→email service)
  // or the server console in log mode. ALWAYS answers 200: the response must
  // not reveal whether an account exists. Rate-limited with the auth limiter.
  if (isPost && url.pathname === "/api/auth/forgot") {
    if (authLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many requests — try again in a minute." });
    }
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    let deliveredVia = "none";
    if (email) {
      const user = Object.values(store.users || {}).find((u) => u.email === email);
      if (user) {
        const token = randomBytes(24).toString("hex");
        const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
        store.resetTokens = store.resetTokens || {};
        // Sweep expired tokens on every request, then bound the map: a
        // long-lived server must not accumulate stale reset tokens.
        for (const [k, v] of Object.entries(store.resetTokens)) {
          if (new Date(v.expiresAt).getTime() < Date.now()) delete store.resetTokens[k];
        }
        if (Object.keys(store.resetTokens).length > 1000) store.resetTokens = {};
        store.resetTokens[token] = { userId: user.userId, expiresAt };
        const payload = { type: "password_reset", email, token, expiresAt };
        const hooks = (process.env.ALERT_WEBHOOK_URL || "")
          .split(",")
          .map((u) => u.trim())
          .filter((u) => /^https?:\/\//.test(u));
        for (const hook of hooks) {
          fetch(hook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
          }).catch(() => {});
          deliveredVia = "webhook";
        }
        if (deliveredVia === "none") {
          // Log mode: the operator reads the reset link from the server
          // console and forwards it. Honest, testable, zero-dependency.
          console.log(`[Dravex password-reset] ${email} → ${token} (expires ${expiresAt})`);
          deliveredVia = "log";
        }
        saveStore();
      }
    }
    return json(res, 200, { ok: true, deliveredVia });
  }

  // POST /api/auth/reset { token, password } — redeem a reset token, set a
  // new password (scrypt + fresh salt), invalidate the token, and return a
  // fresh session so the owner is signed in immediately after resetting.
  if (isPost && url.pathname === "/api/auth/reset") {
    const body = await readBody(req);
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    const entry = (store.resetTokens || {})[token];
    if (!entry) return json(res, 400, { error: "Invalid or expired reset token — request a new one." });
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      delete store.resetTokens[token];
      saveStore();
      return json(res, 400, { error: "This reset token has expired — request a new one." });
    }
    if (password.length < 8) {
      return json(res, 400, { error: "Password must be at least 8 characters." });
    }
    const user = store.users[entry.userId];
    if (!user) {
      delete store.resetTokens[token];
      saveStore();
      return json(res, 400, { error: "Account no longer exists." });
    }
    const salt = randomBytes(16).toString("hex");
    user.salt = salt;
    user.passHash = hashPassword(password, salt);
    delete store.resetTokens[token];
    const session = newSession(user.userId);
    saveStore();
    return json(res, 200, { ok: true, userId: user.userId, token: session, email: user.email });
  }

  // GET /api/auth/me — who is this session? (counts their devices)
  if (!isPost && url.pathname === "/api/auth/me") {
    const uid = sessionUserId(req);
    if (!uid || !store.users[uid]) return json(res, 401, { error: "Not signed in." });
    const user = store.users[uid];
    const deviceCount = Object.values(store.devices).filter((d) => d.ownerId === uid).length;
    return json(res, 200, { ok: true, userId: uid, email: user.email, role: user.role, deviceCount, createdAt: user.createdAt });
  }

  // GET /api/admin/health — Phase 2.5 observability: what the service is
  // doing right now, without checking every device manually. Operator-only:
  // the owner key (NOT an account session — see adminOk).
  if (!isPost && url.pathname === "/api/admin/health") {
    if (!adminOk(req)) return json(res, 401, { error: "Owner key required." });
    const now = Date.now();
    const all = Object.values(store.devices);
    const connected = all.filter((d) => d.lastSeenAt && now - new Date(d.lastSeenAt).getTime() < 5 * 60_000).length;
    const ages = all
      .map((d) => (d.lastFix ? now - new Date(d.lastFix.timestamp).getTime() : null))
      .filter((x) => x !== null);
    return json(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      uptimeS: Math.round((now - new Date(metrics.startedAt).getTime()) / 1000),
      storage: { mode: storage.mode, describe: storage.describe() },
      devices: {
        paired: all.length,
        connected, // seen within 5 min
        offline: all.length - connected,
        lost: all.filter((d) => d.lost).length,
      },
      lastFixAgeMin: ages.length ? { oldest: Math.round(Math.max(...ages) / 60000), newest: Math.round(Math.min(...ages) / 60000) } : null,
      geolocate: metrics.geolocate,
      sightings: metrics.sightings,
      commands: {
        queued: metrics.commands.queued,
        delivered: metrics.commands.delivered,
        acked: metrics.commands.acked,
        deliveryRate: metrics.commands.queued
          ? Math.round((metrics.commands.acked / metrics.commands.queued) * 100) + "%"
          : "—",
      },
      sms: { attempts: metrics.sms.attempts, ok: metrics.sms.ok, failed: metrics.sms.failed, provider: smsStatus(store).provider },
      webhooks: metrics.webhooks,
      alerts: metrics.alerts,
      errors: metrics.errors,
      security: metrics.security,
      retention: { days: retentionDays(), purge: metrics.purge },
      ops: {
        checks: metrics.ops.checks,
        fired: metrics.ops.fired,
        lastAt: metrics.ops.lastAt,
        last: metrics.ops.last,
      },
      deliveryLog: (store.deliveryLog || []).slice(0, 20),
    });
  }

  // POST /api/admin/retry-delivery { id } — re-fire a failed SMS/webhook
  // delivery from the Service-health log. Re-runs the webhook sink + SMS
  // fallback for the recorded alert and logs the retry. Operator-only (owner
  // key, not a session) and rate-limited: it fires paid/quotated channels.
  if (isPost && url.pathname === "/api/admin/retry-delivery") {
    if (!adminOk(req)) return json(res, 401, { error: "Owner key required." });
    if (adminLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many retries — try again in a minute." });
    }
    const body = await readBody(req);
    const entry = (store.deliveryLog || []).find((e) => e.id === body.id);
    if (!entry || !entry.alert) return json(res, 404, { error: "Delivery entry not found." });
    const results = [];
    // Re-fire the webhook sink.
    const hooks = (process.env.ALERT_WEBHOOK_URL || "").split(",").map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    for (const hook of hooks) {
      try {
        const r = await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alert: entry.alert }),
          signal: AbortSignal.timeout(5000),
        });
        results.push({ channel: "webhook", ok: r.ok, error: r.ok ? null : `HTTP ${r.status}` });
        logDelivery("webhook", r.ok, r.ok ? null : `HTTP ${r.status}`, entry.alert);
      } catch (err) {
        results.push({ channel: "webhook", ok: false, error: err.message || "network error" });
        logDelivery("webhook", false, err.message || "network error", entry.alert);
      }
    }
    // Re-fire the SMS fallback (subject to its rate limit).
    const s = store.settings || {};
    if (s.smsEnabled !== false && s.ownerPhone) {
      const result = await sendSms(s.ownerPhone, `[Dravex] ${entry.alert.body}`);
      results.push({ channel: "sms", ok: !!(result && result.ok), error: (result && result.error) || null });
      logDelivery("sms", !!(result && result.ok), (result && result.error) || null, entry.alert);
    } else {
      results.push({ channel: "sms", ok: false, error: "no owner phone configured" });
    }
    return json(res, 200, { ok: true, results });
  }

  // POST /api/pair/register { label } → { code, deviceId }. When called with
  // an account session, the code (and the device claimed with it) belongs to
  // that user; with the owner key it is the legacy shared owner.
  if (isPost && parts.join("/") === "api/pair/register") {
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key or account session required." });
    const body = await readBody(req);
    const deviceId = randomUUID();
    const code = body.label
      ? `DX-${body.label.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}-${Math.floor(1000 + Math.random() * 9000)}`
      : `DX-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
    store.pairCodes[code] = { deviceId, ownerId: sessionUserId(req) || null };
    device(deviceId);
    saveStore();
    return json(res, 201, { code, deviceId });
  }

  // POST /api/pair/claim { code, hostname, serialNumber, platform, staticBeacon? }
  // → { deviceId, token }. The pairing code is the credential; the returned
  // token authenticates the agent's device-scoped calls once DRAVEX_OWNER_KEY
  // is set. A Dravex Tag can claim with its fixed 12-hex staticBeacon id.
  // Brute-force hardened: 10 claims/min/IP and a code locks after 5 failures
  // (it is deleted — the owner must issue a fresh code).
  if (isPost && parts.join("/") === "api/pair/claim") {
    if (claimLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many pairing attempts — wait a minute." });
    }
    const body = await readBody(req);
    const code = String(body.code || "").trim().toUpperCase();
    store.claimFails = store.claimFails || {};
    // Bound the persisted failure map (one key per attempted code value) so
    // distributed guessing can't grow it forever.
    if (Object.keys(store.claimFails).length > 5000) store.claimFails = {};
    if (store.claimFails[code] >= 5) {
      delete store.pairCodes[code]; // locked: destroy the code entirely
      delete store.claimFails[code];
      saveStore();
      return json(res, 429, { error: "This pairing code is locked — issue a new one." });
    }
    const entry = store.pairCodes[code];
    if (!entry) {
      // Count failures against this code value (covers real brute-force AND
      // a typo'd code reaching its limit — either way, lock and move on).
      store.claimFails[code] = (store.claimFails[code] || 0) + 1;
      saveStore();
      return json(res, 404, { error: "Unknown or expired pairing code." });
    }
    const deviceId = typeof entry === "string" ? entry : entry.deviceId;
    const dev = device(deviceId);
    dev.hostname = body.hostname || dev.hostname;
    dev.serialNumber = body.serialNumber || dev.serialNumber;
    dev.imei = body.imei || dev.imei;
    dev.platform = body.platform || dev.platform;
    if (dev.ownerId === null && typeof entry === "object" && entry.ownerId) dev.ownerId = entry.ownerId;
    const sb = String(body.staticBeacon || "").toLowerCase();
    if (/^[0-9a-f]{12}$/.test(sb)) dev.staticBeacon = sb;
    dev.pairedAt = dev.pairedAt || new Date().toISOString();
    dev.lastSeenAt = new Date().toISOString();
    delete store.pairCodes[code]; // single use
    delete store.claimFails[code];
    saveStore();
    return json(res, 200, { deviceId, token: dev.token });
  }

  // GET /api/devices — with an account session, ONLY that user's devices;
  // without a session (owner key or open mode) everything is visible.
  if (!isPost && parts.join("/") === "api/devices") {
    if (!ownerOk(req)) return json(res, 401, { error: "Owner key required." });
    const uid = sessionUserId(req);
    const list = Object.values(store.devices)
      .filter((d) => !uid || d.ownerId === uid)
      .map((d) => ({
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
      verifiedAt: d.verifiedAt || null,
      transferredAt: d.transferredAt || null,
      recoveryMessage: d.recoveryMessage || null,
      contactCount: (d.contactMessages || []).length,
      ownerId: d.ownerId || null,
      listing: listingFor(d.deviceId),
    }));
    return json(res, 200, list);
  }

  /* ---------------- N5: verified resale + public counters ---------------- */

  // GET /api/stats — public aggregate counters (landing page). Counters only,
  // never owner or device data.
  if (!isPost && url.pathname === "/api/stats") {
    const all = Object.values(store.devices || {});
    return json(res, 200, {
      ok: true,
      protected: all.length,
      recovered: all.filter(
        (d) => d.verifiedAt || (d.events || []).some((e) => e.type === "recovered"),
      ).length,
      sighted: all.reduce((n, d) => n + (d.sightings || []).length, 0),
      listings: Object.keys(store.listings || {}).length,
    });
  }

  // GET /api/listings — public verified-resale browse (generic labels only).
  if (!isPost && url.pathname === "/api/listings") {
    const out = Object.entries(store.listings || {})
      .map(([deviceId, l]) => {
        const dev = store.devices[deviceId];
        return {
          deviceId,
          type: dev ? deviceType(dev) : null,
          label: dev ? (deviceType(dev) === "phone" ? "A phone" : "A laptop") : "A device",
          price: l.price,
          condition: l.condition,
          listedAt: l.listedAt,
          interestCount: (l.interests || []).length,
        };
      })
      .sort((a, b) => (a.listedAt < b.listedAt ? 1 : -1));
    return json(res, 200, { listings: out });
  }

  // POST /api/listings { deviceId, price, condition } — owner lists a
  // TRANSFERRED device for verified resale. Only devices that completed the
  // legitimate transfer flow can be listed (registry cleared, ownership
  // released) — the second-life market can never launder a stolen device.
  if (isPost && url.pathname === "/api/listings") {
    const body = await readBody(req);
    const dev = store.devices[body.deviceId];
    if (!dev) return json(res, 404, { error: "Device not found." });
    if (!requireOwnerOf(req, res, dev)) return;
    if (!dev.transferredAt) {
      return json(res, 400, {
        error: "Only transferred devices can be listed — complete the ownership transfer first.",
      });
    }
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 100_000_000) {
      return json(res, 400, { error: "Enter a valid price in NGN (0 – 100,000,000)." });
    }
    const condition = String(body.condition || "").trim().slice(0, 40);
    if (!condition) return json(res, 400, { error: "Condition is required (e.g. Good, Fair, Refurbished)." });
    store.listings = store.listings || {};
    store.listings[dev.deviceId] = {
      price: Math.round(price),
      condition,
      listedAt: new Date().toISOString(),
      interests: [],
    };
    saveStore();
    raiseAlert(
      "listing",
      dev,
      `${dev.hostname || "A device"} is listed for verified resale at ₦${Math.round(price).toLocaleString("en-NG")} (${condition}).`,
    );
    return json(res, 200, { ok: true, listing: listingFor(dev.deviceId) });
  }

  // POST /api/listings/unlist { deviceId } — owner pulls a listing.
  if (isPost && url.pathname === "/api/listings/unlist") {
    const body = await readBody(req);
    const dev = store.devices[body.deviceId];
    if (!dev) return json(res, 404, { error: "Device not found." });
    if (!requireOwnerOf(req, res, dev)) return;
    delete store.listings[dev.deviceId];
    saveStore();
    return json(res, 200, { ok: true });
  }

  // POST /api/listings/:deviceId/interest { message? } — public, rate-limited.
  // A buyer expresses interest; the owner is alerted through the existing
  // privacy-preserving alert channel (the buyer's identity is never recorded).
  if (isPost && parts[0] === "api" && parts[1] === "listings" && parts[3] === "interest") {
    if (contactLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many requests — try again later." });
    }
    const listing = store.listings && store.listings[parts[2]];
    if (!listing) return json(res, 404, { error: "Listing not found." });
    const dev = store.devices[parts[2]];
    const body = await readBody(req);
    const message =
      String(body.message || "").trim().slice(0, 280) ||
      "A buyer is interested in your listing.";
    listing.interests = listing.interests || [];
    if (listing.interests.length >= 20) listing.interests = listing.interests.slice(-19);
    listing.interests.push({ message, at: new Date().toISOString() });
    saveStore();
    if (dev) {
      raiseAlert(
        "interest",
        dev,
        `${dev.hostname || "Your device"}: a buyer expressed interest in your listing (${listing.condition}, ₦${listing.price.toLocaleString("en-NG")}) — check the listings view.`,
        { sms: false },
      );
    }
    return json(res, 200, { ok: true });
  }

  // POST /api/admin/purge — run the N3 retention sweep now (operator only).
  if (isPost && url.pathname === "/api/admin/purge") {
    if (!adminOk(req)) return json(res, 401, { error: "Owner key required." });
    if (adminLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many requests — try again in a minute." });
    }
    purgeExpiredData();
    return json(res, 200, {
      ok: true,
      days: retentionDays(),
      purged: metrics.purge,
      ranAt: metrics.purge.lastAt,
    });
  }

  // POST /api/admin/ops-check — evaluate N4 health thresholds now (operator).
  if (isPost && url.pathname === "/api/admin/ops-check") {
    if (!adminOk(req)) return json(res, 401, { error: "Owner key required." });
    if (adminLimiter.limited(req.socket.remoteAddress || "unknown")) {
      return json(res, 429, { error: "Too many requests — try again in a minute." });
    }
    const result = runOpsHealthCheck();
    return json(res, 200, { ok: true, ...result });
  }

  // /api/devices/:id/... (devices are only created by pair/register and claim)
  if (parts[0] === "api" && parts[1] === "devices" && parts[2]) {
    const dev = store.devices[parts[2]];
    if (!dev) return json(res, 404, { error: "Device not found." });
    const action = parts[3];

    if (action === "fixes") {
      if (isPost) {
        if (!deviceOk(req, dev)) return json(res, 401, { error: "Device token required." });
        const body = await readBody(req);
        if (!body.fix) return json(res, 400, { error: "Missing fix." });
        metrics.fixes.received++;
        storeFix(dev, body.fix);
        saveStore();
        return json(res, 201, { ok: true });
      }
      if (!ownerOrDeviceOk(req, dev)) return json(res, 401, { error: "Owner key or device token required." });
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "10", 10));
      return json(res, 200, dev.fixes.slice(-limit).reverse());
    }

    // POST /api/devices/:id/batch { items: [{type, fix|dataUrl|event}] } —
    // the agent's offline-vault burst sync (one call, many items).
    if (action === "batch") {
      if (isPost) {
        if (!deviceOk(req, dev)) return json(res, 401, { error: "Device token required." });
        const body = await readBody(req);
        const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
        let received = 0;
        for (const item of items) {
          try {
            if (item && item.type === "fix" && item.fix) {
              metrics.fixes.received++;
              storeFix(dev, item.fix);
              received++;
            } else if (item && item.type === "evidence" &&
                typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:image/")) {
              dev.evidence.push({
                id: randomUUID(),
                dataUrl: item.dataUrl,
                capturedAt: item.capturedAt || new Date().toISOString(),
                receivedAt: new Date().toISOString(),
                source: item.source || "webcam",
                sha256: createHash("sha256").update(item.dataUrl).digest("hex"),
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
        if (!deviceOk(req, dev)) return json(res, 401, { error: "Device token required." });
        const body = await readBody(req);
        const ev = body.event;
        if (!ev || typeof ev.type !== "string") return json(res, 400, { error: "Missing event." });
        storeEvent(dev, ev);
        saveStore();
        return json(res, 201, { ok: true });
      }
      if (!ownerOrDeviceOk(req, dev)) return json(res, 401, { error: "Owner key or device token required." });
      return json(res, 200, [...(dev.events || [])].reverse());
    }

    // POST /api/devices/:id/lost { lost: bool } — owner marks the device lost.
    // Sets the flag (sightings then raise alerts) AND queues a `lost`/`found`
    // command so the phone agent arms/disarms its community beacon itself —
    // the beacon is only ever broadcast while lost (privacy-first).
    if (action === "lost" && isPost) {
      if (!requireOwnerOf(req, res, dev)) return;
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

    // POST /api/devices/:id/transfer — ownership handover for the second-life
    // market (the "Verified → Recovered" lifecycle's resale path). The device
    // is cleared from the stolen registry, its lost state is dropped, the OLD
    // agent credential is rotated (the previous owner's agent can no longer
    // call device-scoped endpoints) and a fresh single-use pairing code is
    // issued for the NEW owner's agent to claim. PRIVACY: the previous
    // owner's location history, webcam evidence and sightings are PURGED —
    // webcam photos are high-risk NDPA data and must never follow a device
    // into a stranger's hands.
    if (action === "transfer" && isPost) {
      if (!requireOwnerOf(req, res, dev)) return;
      dev.lost = false;
      dev.recoveryCode = null;
      dev.verifiedAt = null;
      dev.transferredAt = new Date().toISOString();
      // Purge everything the previous owner generated on this physical device.
      dev.fixes = [];
      dev.lastFix = null;
      dev.evidence = [];
      dev.sightings = [];
      dev.lastSightingAlertAt = null;
      dev.lastSightingSignatures = [];
      dev.contactMessages = [];
      dev.recoveryMessage = null;
      dev.events = [{ type: "transfer", at: dev.transferredAt }];
      dev.lastSeenAt = null;
      dev.reconnectedAt = null;
      // Registry: this physical device reads clean for its next owner.
      syncRegistry(dev);
      // Rotate the credential so only the new owner's agent can act.
      dev.token = randomBytes(24).toString("hex");
      // Release ownership: the previous owner's account must lose access to a
      // device it sold (the strict session filter + ownership gate key on
      // ownerId). The buyer's account rebinds it when they claim the fresh
      // code from a session-authed dashboard.
      dev.ownerId = null;
      const code = `DX-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
      store.pairCodes[code] = dev.deviceId;
      // Disarm any pending lost/found commands so the next owner starts clean.
      dev.commands = (dev.commands || []).filter((c) => c.executedAt);
      raiseAlert("transfer", dev, `${dev.hostname || "A device"} was transferred to a new owner — registry cleared, previous owner data purged, new pairing code issued.`);
      saveStore();
      return json(res, 200, { ok: true, code, deviceId: dev.deviceId });
    }

    // POST /api/devices/:id/verify — the owner confirms the device is back
    // ("Verified → Recovered"). Resolves the registry and records a recovered
    // event; unlike mark-found it also pins verifiedAt for the recovery view.
    if (action === "verify" && isPost) {
      if (!requireOwnerOf(req, res, dev)) return;
      dev.lost = false;
      dev.recoveryCode = null;
      dev.verifiedAt = new Date().toISOString();
      dev.events.push({ type: "recovered", at: dev.verifiedAt });
      dev.commands = (dev.commands || []).filter((c) => c.executedAt); // disarm
      syncRegistry(dev);
      raiseAlert("recovered", dev, `${dev.hostname || "A device"} was verified recovered by its owner.`);
      saveStore();
      return json(res, 200, { ok: true, verifiedAt: dev.verifiedAt });
    }

    // POST /api/devices/:id/forget — owner permanently removes a device from
    // the account (test devices, retired agents, hardware sold outside Dravex).
    // Clears its stolen-registry entries, verified-resale listing, alerts and
    // all stored data. Irreversible — the dashboard confirms before calling.
    if (action === "forget" && isPost) {
      if (!requireOwnerOf(req, res, dev)) return;
      store.stolen = (store.stolen || []).filter((e) => e.deviceId !== dev.deviceId);
      delete store.listings[dev.deviceId];
      // Kill any outstanding pairing codes for this device: the device()
      // getter lazily re-creates a missing device on claim, so a stale code
      // would otherwise resurrect the forgotten device with a fresh token.
      for (const [code, id] of Object.entries(store.pairCodes || {})) {
        if (id === dev.deviceId) delete store.pairCodes[code];
      }
      delete store.devices[dev.deviceId];
      // Privacy: evidence and alert history go with the device. The persisted
      // deliveryLog keeps its entries deliberately — it is an append-only
      // audit trail of what was delivered, not recoverable device data.
      store.alerts = (store.alerts || []).filter((a) => a.deviceId !== dev.deviceId);
      saveStore();
      return json(res, 200, { ok: true });
    }

    // PUT /api/devices/:id/recovery-message { message, contactPreference? }
    // — owner sets the one-way message shown to a good samaritan who finds
    // the device (never reveals the owner's identity to the public).
    if (action === "recovery-message" && req.method === "PUT") {
      if (!requireOwnerOf(req, res, dev)) return;
      const body = await readBody(req);
      const message = String(body.message || "").trim().slice(0, 280);
      if (!message) return json(res, 400, { error: "Message is required." });
      dev.recoveryMessage = {
        message,
        contactPreference: String(body.contactPreference || "").trim().slice(0, 120) || null,
        at: new Date().toISOString(),
      };
      saveStore();
      return json(res, 200, { ok: true, recoveryMessage: dev.recoveryMessage });
    }

    // POST /api/devices/:id/contact { message } — public, rate-limited.
    // A good samaritan (or a thief having a change of heart) sends the owner
    // ONE message through this device's own recovery page. The sender's
    // identity is never recorded — only the message text and time.
    if (action === "contact" && isPost) {
      if (contactLimiter.limited(req.socket.remoteAddress || "unknown")) {
        return json(res, 429, { error: "Too many messages — try again later." });
      }
      const body = await readBody(req);
      const message = String(body.message || "").trim().slice(0, 280);
      if (!message) return json(res, 400, { error: "Message is required." });
      if (!dev.lost) return json(res, 200, { ok: true }); // quiet no-op: not in recovery
      dev.contactMessages = dev.contactMessages || [];
      if (dev.contactMessages.length >= 10) dev.contactMessages = dev.contactMessages.slice(-9);
      dev.contactMessages.push({
        id: randomUUID(),
        message,
        at: new Date().toISOString(),
      });
      saveStore();
      raiseAlert("contact", dev, `${dev.hostname || "Your device"}: a finder sent you a message — check the recovery view.`);
      return json(res, 200, { ok: true });
    }

    // GET /api/devices/:id/sightings — community BLE sightings, newest first.
    if (action === "sightings" && !isPost) {
      if (!ownerOrDeviceOk(req, dev)) return json(res, 401, { error: "Owner key or device token required." });
      return json(res, 200, [...(dev.sightings || [])].reverse());
    }

    if (action === "evidence") {
      if (isPost) {
        if (!deviceOk(req, dev)) return json(res, 401, { error: "Device token required." });
        const body = await readBody(req);
        if (typeof body.dataUrl !== "string" || !body.dataUrl.startsWith("data:image/")) {
          return json(res, 400, { error: "Evidence must be a data:image/ URL." });
        }
        dev.evidence.push({
          id: randomUUID(),
          dataUrl: body.dataUrl,
          capturedAt: body.capturedAt || new Date().toISOString(),
          receivedAt: new Date().toISOString(),
          source: body.source || "webcam",
          sha256: createHash("sha256").update(body.dataUrl).digest("hex"),
        });
        dev.lastSeenAt = new Date().toISOString();
        saveStore();
        // P5: fresh webcam evidence on a LOST device — "evidence received".
        if (dev.lost) {
          raiseAlert(
            "evidence",
            dev,
            `${dev.hostname || "Your device"}: new webcam evidence captured — open the Evidence gallery.`,
            { sms: false },
          );
        }
        return json(res, 201, { ok: true });
      }
      if (!ownerOrDeviceOk(req, dev)) return json(res, 401, { error: "Owner key or device token required." });
      return json(res, 200, [...dev.evidence].reverse().map((e) => evidenceMeta(dev, e)));
    }

    if (action === "commands") {
      // POST /api/devices/:id/commands/:cid/ack — agent confirms execution.
      // Must be checked before the generic commands handler below.
      if (isPost && parts[4] && parts[5] === "ack") {
        if (!deviceOk(req, dev)) return json(res, 401, { error: "Device token required." });
        const cmd = dev.commands.find((c) => c.id === parts[4]);
        if (!cmd) return json(res, 404, { error: "Command not found." });
        cmd.executedAt = new Date().toISOString();
        metrics.commands.acked++;
        saveStore();
        // P5: an acked command on a LOST device means the agent acted on it —
        // the owner wants to know the moment a lock/alarm/webcam fired.
        if (dev.lost && cmd.type) {
          raiseAlert(
            "command_ack",
            dev,
            `${dev.hostname || "Your device"} executed the ${cmd.type} command — ${cmd.type === "webcam" ? "evidence should arrive shortly" : "check the recovery view"}.`,
            { sms: false },
          );
        }
        return json(res, 200, { ok: true });
      }

      if (isPost) {
        if (!requireOwnerOf(req, res, dev)) return;
        const body = await readBody(req);
        const type = ["lock", "alarm", "webcam"].includes(body.type) ? body.type : null;
        if (!type) return json(res, 400, { error: "Invalid command type." });
        dev.commands.push({
          id: randomUUID(),
          type,
          createdAt: new Date().toISOString(),
          executedAt: null,
        });
        metrics.commands.queued++;
        saveStore();
        return json(res, 201, { ok: true, id: dev.commands[dev.commands.length - 1].id });
      }
      // Agent polls with ?after=<commandId> to get only newer commands.
      if (!deviceOk(req, dev)) return json(res, 401, { error: "Device token required." });
      const after = url.searchParams.get("after");
      let pending = dev.commands.filter((c) => !c.executedAt);
      if (after) {
        const idx = dev.commands.findIndex((c) => c.id === after);
        pending = idx >= 0 ? pending.filter((c) => dev.commands.indexOf(c) > idx) : pending;
      }
      metrics.commands.delivered += pending.length;
      return json(res, 200, pending);
    }

    // POST /api/devices/:id/token — owner rotates the agent credential.
    // Needed when enabling auth on a store that has pre-auth devices (their
    // tokens were minted at creation but never delivered to the agent).
    if (action === "token" && isPost) {
      if (!requireOwnerOf(req, res, dev)) return;
      dev.token = randomBytes(24).toString("hex");
      saveStore();
      return json(res, 200, { ok: true, token: dev.token });
    }

    // GET /api/devices/:id/case — the Phase-3 recovery case projection
    // (lifecycle state, case status, timeline, confidence + factors). Pure
    // read-side derivation — it references the device's own arrays, never
    // duplicates them, and never invents signals.
    if (action === "case" && !isPost) {
      if (!ownerOrDeviceOk(req, dev)) return json(res, 401, { error: "Owner key or device token required." });
      return json(res, 200, deriveCase(dev));
    }

    // GET /api/devices/:id/evidence-pack — the Phase-3 "Export Recovery
    // Evidence Pack": a JSON bundle (device identity, incident summary,
    // lifecycle, timeline, location history, sightings, commands, evidence
    // index, recovery events). Respects the evidenceRetentionDays policy —
    // evidence older than the window is EXCLUDED (never bypass retention).
    // No finder identity is ever included. Owner only.
    if (action === "evidence-pack" && !isPost) {
      if (!requireOwnerOf(req, res, dev)) return;
      const retention = retentionDays();
      const cutoff = Date.now() - retention * 24 * 3.6e6;
      const retainedEvidence = (dev.evidence || []).filter((e) => {
        const at = new Date(e.capturedAt || e.receivedAt || 0).getTime();
        return at >= cutoff;
      });
      const pack = {
        generatedAt: new Date().toISOString(),
        retentionDays: retention,
        device: {
          deviceId: dev.deviceId,
          hostname: dev.hostname || null,
          serialNumber: dev.serialNumber || null,
          imei: dev.imei || null,
          platform: dev.platform || null,
          type: deviceType(dev),
          operator: deviceOperator(dev) || null,
          pairedAt: dev.pairedAt || null,
        },
        lifecycle: deriveCase(dev),
        incident: {
          reportedAt: (dev.events || []).find((e) => e.type === "lost")?.at || null,
          lost: !!dev.lost,
          recoveryMessage: dev.recoveryMessage || null,
        },
        timeline: buildTimeline(dev),
        locationHistory: {
          fixCount: (dev.fixes || []).length,
          lastFix: dev.lastFix || null,
          lastSeenAt: dev.lastSeenAt || null,
          fixes: (dev.fixes || []).slice(-50).map((f) => ({
            lat: f.lat,
            lng: f.lng,
            accuracy: f.accuracy ?? null,
            source: f.source,
            timestamp: f.timestamp || f.receivedAt,
          })),
        },
        community: {
          sightingCount: (dev.sightings || []).length,
          sightings: (dev.sightings || []).slice(-50).map((s) => ({
            lat: s.lat,
            lng: s.lng,
            accuracy: s.accuracy ?? null,
            at: s.at || s.receivedAt,
          })),
        },
        commands: (dev.commands || []).map((c) => ({
          id: c.id,
          type: c.type,
          createdAt: c.createdAt,
          executedAt: c.executedAt || null,
        })),
        evidence: retainedEvidence.map((e) => ({
          id: e.id,
          capturedAt: e.capturedAt || e.receivedAt,
          receivedAt: e.receivedAt,
          // Metadata only — the raw image stays in the evidence gallery.
        })),
        recoveryEvents: (dev.events || []).filter((e) =>
          ["lost", "found", "reconnected", "sim_change", "recovered", "transfer"].includes(e.type),
        ),
      };
      return json(res, 200, pack);
    }

    if (!isPost && !action) {
      if (!ownerOrDeviceOk(req, dev)) return json(res, 401, { error: "Owner key or device token required." });
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
        verifiedAt: dev.verifiedAt || null,
        transferredAt: dev.transferredAt || null,
        recoveryMessage: dev.recoveryMessage || null,
        contactMessages: (dev.contactMessages || []).slice(-10).reverse(),
        listing: listingFor(dev.deviceId),
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
    metrics.errors.route++;
    json(res, 500, { error: "Internal error." });
  });
});

async function boot() {
  try {
    const loaded = await storage.load();
    if (loaded) {
      // New keys (users/sessions/claimFails/geoCache) must default to their
      // empty shapes when the persisted blob predates them — otherwise the
      // first register/claim after an upgrade throws on `store.sessions[…]`.
      store = {
        devices: {},
        pairCodes: {},
        alerts: [],
        pushSubscriptions: [],
        settings: { ...DEFAULT_SETTINGS },
        stolen: [],
        users: {},
        sessions: {},
        resetTokens: {},
        deliveryLog: [],
        claimFails: {},
        geoCache: {},
        listings: {},
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
  // N3 retention sweep + N4 operator health checks (unref'd timers).
  startScheduledTasks();
  server.listen(PORT, HOST, () => {
    console.log(`Dravex sync server listening on http://${HOST}:${PORT}`);
  });
}

boot();
