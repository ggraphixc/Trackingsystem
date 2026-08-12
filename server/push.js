/**
 * Dravex web-push — zero-dependency VAPID implementation.
 *
 * Strategy: the server sends a *payload-less* push (a "ping", Content-Length 0).
 * Per the Web Push spec a push without a payload still wakes the service
 * worker's `push` handler; the worker then fetches /api/alerts/latest and
 * renders the notification itself. This avoids implementing RFC 8291 message
 * encryption (ECDH + HKDF + AES-GCM) entirely — much less code, no crypto
 * edge cases, and the notification content is always fresh.
 *
 * VAPID: ES256 JWT signed with an auto-generated P-256 keypair. The public
 * key (raw 65-byte point, base64url) is handed to the browser for
 * PushManager.subscribe(applicationServerKey); the private key stays in the
 * server store and is reused across restarts.
 */

const crypto = require("crypto");

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:alerts@dravex.local";

/* ------------------------------ base64url -------------------------------- */

function b64u(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ------------------------------- VAPID keys ------------------------------ */

/**
 * Load the persisted VAPID keypair (from the store) or generate one, persist
 * it, and return { publicKey, privateKeyObject }.
 */
function getVapidKeys(store, persist) {
  if (store.vapidKeys && store.vapidKeys.publicKey && store.vapidKeys.privateKeyPkcs8) {
    const privateKeyObject = crypto.createPrivateKey({
      key: Buffer.from(store.vapidKeys.privateKeyPkcs8, "base64"),
      format: "der",
      type: "pkcs8",
    });
    return { publicKey: store.vapidKeys.publicKey, privateKeyObject };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  // Raw 65-byte uncompressed point (0x04 || X || Y) — what browsers expect.
  const pubRaw = b64u(publicKey.export({ type: "spki", format: "der" }).subarray(-65));
  const privateKeyPkcs8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  store.vapidKeys = { publicKey: pubRaw, privateKeyPkcs8 };
  if (persist) persist();
  console.log("Dravex push: generated VAPID keys (public key:", pubRaw.slice(0, 16) + "…)");
  return { publicKey: pubRaw, privateKeyObject: privateKey };
}

/* --------------------------------- signing ------------------------------- */

/** Convert a DER-encoded ECDSA signature into the raw r||s form VAPID expects. */
function derToRaw(der) {
  // DER: 0x30 <len> 0x02 <len> <r> 0x02 <len> <s>
  let off = 2; // skip 0x30 + total length
  if (der[0] !== 0x30 || der[off] !== 0x02) throw new Error("Invalid ECDSA signature");
  const rLen = der[off + 1];
  let r = der.slice(off + 2, off + 2 + rLen);
  off += 2 + rLen;
  if (der[off] !== 0x02) throw new Error("Invalid ECDSA signature");
  const sLen = der[off + 1];
  let s = der.slice(off + 2, off + 2 + sLen);

  // Strip leading zeros, then left-pad back to exactly 32 bytes each.
  const strip = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    b = b.slice(i);
    return b.length < 32 ? Buffer.concat([Buffer.alloc(32 - b.length), b]) : b;
  };
  r = strip(r);
  s = strip(s);
  return Buffer.concat([r, s]);
}

function signVapidToken(privateKeyObject, audience, subject) {
  const header = { alg: "ES256", typ: "JWT" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // ≤ 24h, as browsers enforce
    sub: subject,
  };
  const data = `${b64u(Buffer.from(JSON.stringify(header)))}.${b64u(Buffer.from(JSON.stringify(payload)))}`;
  const sig = crypto.sign("sha256", Buffer.from(data), privateKeyObject);
  return `${data}.${b64u(derToRaw(sig))}`;
}

/* ---------------------------------- send --------------------------------- */

/**
 * Send a payload-less push to one subscription.
 * @returns {Promise<string>} 'ok' | 'gone' | 'http-<status>' | 'error:<msg>'
 */
async function sendPush(endpoint, keys) {
  try {
    const token = signVapidToken(keys.privateKeyObject, new URL(endpoint).origin, VAPID_SUBJECT);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${token}, k=${keys.publicKey}`,
        TTL: "60",
        "Content-Type": "text/plain",
      },
      body: "", // Content-Length 0 → wakes the SW, no encrypted payload
    });
    if (res.status === 404 || res.status === 410) return "gone"; // subscription expired
    if (res.status >= 400) return `http-${res.status}`;
    return "ok";
  } catch (err) {
    return `error:${err.message}`;
  }
}

/**
 * Ping every registered subscription. Subscriptions the push service reports
 * as gone (404/410) are pruned from the store.
 * @returns {Promise<Array<{ endpoint: string, result: string }>>}
 */
async function notifyAll(store, persist) {
  try {
    const keys = getVapidKeys(store, persist);
    const subs = store.pushSubscriptions || [];
    const kept = [];
    const results = [];
    for (const sub of subs) {
      const result = await sendPush(sub.endpoint, keys);
      results.push({ endpoint: `${sub.endpoint.slice(0, 44)}…`, result });
      // Only prune subscriptions the push service says are dead (404/410).
      // Transient failures (429 rate-limit, 5xx, network) keep the
      // subscription — dropping it would silently kill the owner's alerts.
      if (result !== "gone") kept.push(sub);
    }
    if (kept.length !== subs.length) {
      store.pushSubscriptions = kept;
      if (persist) persist();
    }
    return results;
  } catch (err) {
    // A push-service hiccup must never 500 a sync request.
    console.error("notifyAll failed:", err.message);
    return [];
  }
}

module.exports = { getVapidKeys, sendPush, notifyAll };
