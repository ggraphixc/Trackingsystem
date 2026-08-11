/**
 * TrackNaija Sync Server.
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

let store = { devices: {}, pairCodes: {}, alerts: [], pushSubscriptions: [], settings: DEFAULT_SETTINGS };
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
function raiseAlert(type, dev, body) {
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
  smsNotify(store, store.alerts[store.alerts.length - 1]);
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
  sendSms(s.ownerPhone, `[TrackNaija] ${prefix}: ${alert.body}`)
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
      "[TrackNaija] Test SMS — SMS alerts are working. You will be texted here if a device reconnects or its SIM changes.",
    );
    store.settings.smsLastSentAt = new Date().toISOString();
    store.settings.smsLastResult = result;
    saveStore();
    return json(res, 200, result);
  }

  // POST /api/pair/register { label } → { code, deviceId }
  if (isPost && parts.join("/") === "api/pair/register") {
    const body = await readBody(req);
    const deviceId = randomUUID();
    const code = body.label
      ? `TN-${body.label.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)}-${Math.floor(1000 + Math.random() * 9000)}`
      : `TN-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
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
  console.log(`TrackNaija sync server: storage = ${storage.describe()}`);
  server.listen(PORT, HOST, () => {
    console.log(`TrackNaija sync server listening on http://${HOST}:${PORT}`);
  });
}

boot();
