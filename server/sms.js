/**
 * TrackNaija SMS alerts — zero-dependency provider module.
 *
 * The sync server texts the owner when a stolen device surfaces online or its
 * SIM changes — the fallback channel for owners with no data or Wi-Fi, and
 * the most reliable alert in a Nigerian theft scenario (everyone reads SMS).
 *
 * Providers are auto-detected from environment variables:
 *
 *   Twilio  → TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   Termii  → TERMII_API_KEY, TERMII_FROM     (Nigeria-native, DND-friendly)
 *   log     → no credentials: messages print to the server console. This is
 *             the default so the whole flow is testable before you add an
 *             account (and the E2E suite runs against it).
 *
 * Uses the global fetch (Node 18+). Never throws — every function returns a
 * result object so the HTTP routes can never 500 on a delivery hiccup.
 */

/* ---------------- provider detection ---------------- */

function smsProvider() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (sid && token && from) return "twilio";
  if (process.env.TERMII_API_KEY && process.env.TERMII_FROM) return "termii";
  return "log";
}

/** Normalise an owner phone number: "+234 801 234 5678" → "+2348012345678". */
function normalizePhone(input) {
  if (!input) return null;
  let cleaned = String(input).replace(/[\s\-().]/g, "");
  // Nigeria's "+234(0)801…" convention: drop the spurious 0 right after the
  // country code so it becomes valid international E.164 (+234801…). Local
  // numbers without "+" are left untouched (they keep their leading 0).
  cleaned = cleaned.replace(/^\+(\d{1,3})0(?=\d)/, "+$1");
  return /^\+?[0-9]{7,15}$/.test(cleaned) ? cleaned : null;
}

function maskPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 5) return "****";
  const prefix = phone.replace(/[0-9]/g, ""); // keep "+" etc.
  return `${prefix}****${digits.slice(-4)}`;
}

/* ---------------- providers ---------------- */

async function sendTwilio(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const body = new URLSearchParams({ To: to, From: from, Body: message });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        },
        body: body.toString(),
        signal: controller.signal,
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, mode: "twilio", error: data.message || `HTTP ${res.status}` };
    return { ok: true, mode: "twilio", messageId: data.sid || String(res.status) };
  } catch (err) {
    return {
      ok: false,
      mode: "twilio",
      error: err.name === "AbortError" ? "timed out" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sendTermii(to, message) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        from: process.env.TERMII_FROM,
        sms: message,
        type: "plain",
        channel: "dnd", // route around Nigeria DND — alerts must get through
        api_key: process.env.TERMII_API_KEY,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== "success") {
      return { ok: false, mode: "termii", error: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, mode: "termii", messageId: data.message_id || String(res.status) };
  } catch (err) {
    return {
      ok: false,
      mode: "termii",
      error: err.name === "AbortError" ? "timed out" : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- public API ---------------- */

/** Send one SMS to `to`. Resolves to { ok, mode, messageId?, error? } — never rejects. */
async function sendSms(to, message) {
  const provider = smsProvider();
  if (provider === "twilio") return sendTwilio(to, message);
  if (provider === "termii") return sendTermii(to, message);
  console.log(`[TrackNaija SMS:log] to=${to} — ${message}`);
  return { ok: true, mode: "log", messageId: "log" };
}

/** Status payload for the dashboard's SMS card. */
function smsStatus(store) {
  const s = store.settings || {};
  return {
    enabled: s.smsEnabled !== false,
    provider: smsProvider(),
    ownerPhone: s.ownerPhone ? maskPhone(s.ownerPhone) : null,
    lastSentAt: s.smsLastSentAt || null,
    lastResult: s.smsLastResult || null,
  };
}

module.exports = { smsProvider, normalizePhone, maskPhone, sendSms, smsStatus };
