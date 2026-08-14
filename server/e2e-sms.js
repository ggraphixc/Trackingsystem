/**
 * Dravex P2 — Live SMS verification (hermetic).
 *
 * Verifies the SMS pipeline without real credentials:
 *
 *   A. Log-mode default — no provider env → POST /api/sms/test returns
 *      { ok: true, mode: "log" } (messages print to console; E2E-safe).
 *
 *   B. Provider-failure honesty — with a non-functional Termii key set, a
 *      sim_change alert must (1) record the failed SMS in deliveryLog,
 *      (2) allow a retry through Service Health (POST /api/admin/retry-delivery)
 *      that re-fires and logs a fresh attempt, (3) respect the 1/min SMS
 *      throttle so a second alert within the window sends nothing (no spam).
 *
 * Real delivery to a Nigerian number still requires TERMII_API_KEY +
 * TERMII_FROM on the live server (see docs/DEPLOY.md §4) — this suite proves
 * the pipeline around it.
 *
 * Run: cd server && node e2e-sms.js   (boots and stops its own servers)
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { SyncClient } = require("../desktop/src/sync-client");

const PORT = 5000 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_FILE = path.join(__dirname, "sms-lab-data.json");

let serverProc = null;

let passed = 0;
let failed = 0;
function ok(label) {
  passed++;
  console.log(`  ✓ ${label}`);
}
function bad(label, extra) {
  failed++;
  console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
}
function check(cond, label, extra) {
  if (cond) ok(label);
  else bad(label, extra || "");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  try {
    const res = await fetch(BASE + path, {
      method: body !== undefined ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      /* non-JSON */
    }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: { error: err.message } };
  }
}

function startServer(extraEnv = {}) {
  return new Promise((resolve) => {
    try {
      fs.unlinkSync(DATA_FILE);
    } catch (_) {
      /* no file yet */
    }
    serverProc = spawn(process.execPath, ["server.js"], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_FILE,
        DATABASE_URL: "",
        DRAVEX_OWNER_KEY: "",
        RECONNECT_GAP_HOURS: "0.001",
        TERMII_API_KEY: "",
        TERMII_FROM: "",
        TWILIO_ACCOUNT_SID: "",
        TWILIO_AUTH_TOKEN: "",
        TWILIO_PHONE_NUMBER: "",
        ...extraEnv,
      },
      stdio: "ignore",
    });
    resolve();
  });
}

function stopServer() {
  try {
    fs.unlinkSync(DATA_FILE);
  } catch (_) {
    /* ignore */
  }
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}

async function waitFor(fn, label, tries = 30, gapMs = 1000) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(gapMs);
  }
  bad(label, "timed out");
  return null;
}

async function bootAndHealth() {
  for (let i = 0; i < 40; i++) {
    const h = await api("/api/health");
    if (h.status === 200) return true;
    await sleep(250);
  }
  return false;
}

/* ---------------- A. log mode by default ---------------- */

async function partA() {
  console.log("\n— A: log-mode default (no provider credentials) —");
  startServer();
  check(await bootAndHealth(), "A0 server booted", "");

  const settings = await api("/api/settings", { ownerPhone: "+2348012345678", smsEnabled: true });
  check(settings.status === 200, "A1 settings saved (owner phone + sms enabled)", JSON.stringify(settings.json).slice(0, 120));

  const test = await api("/api/sms/test", {});
  check(
    test.status === 200 && test.json && test.json.ok === true && test.json.mode === "log",
    "A2 sms/test → log mode (ok, no provider)",
    JSON.stringify(test.json),
  );

  const readout = await api("/api/settings"); // GET → masked readout
  check(
    readout.status === 200 && readout.json && readout.json.sms && readout.json.sms.provider === "log",
    "A3 settings readout reports provider=log",
    JSON.stringify(readout.json?.sms),
  );
  check(
    readout.json && typeof readout.json.ownerPhone === "string" && readout.json.ownerPhone.includes("****"),
    "A4 phone masked in readout (no credential exposure)",
    readout.json?.ownerPhone,
  );

  stopServer();
}

/* ---------------- B. failure → retry → throttle (fake Termii) ---------------- */

async function partB() {
  console.log("\n— B: provider failure → deliveryLog → retry → 1/min throttle —");
  startServer({ TERMII_API_KEY: "test-invalid-key", TERMII_FROM: "Dravex" });
  check(await bootAndHealth(), "B0 server booted (fake Termii provider)", "");

  const settings = await api("/api/settings", { ownerPhone: "+2348012345678", smsEnabled: true });
  check(settings.status === 200, "B1 settings saved", "");

  // Claim a device so we can raise a sim_change alert.
  const pair = await api("/api/pair/register", { label: "SMSLAB" });
  const client = new SyncClient(BASE);
  const claim = await client.claim(pair.json.code, { hostname: "SMS-TECNO", platform: "android" });
  const deviceId = claim.deviceId;
  check(!!deviceId, "B2 device claimed", "");

  // sim_change → alert → smsNotify fires async against the fake provider.
  await client.postEvent(deviceId, { type: "sim_change", detail: { from: "621|1", to: "621|5" } });

  const entry = await waitFor(async () => {
    const h = await api("/api/admin/health"); // GET
    const log = (h.json && h.json.deliveryLog) || [];
    const sms = log.find((e) => e.channel === "sms");
    return sms ? sms : null;
  }, "B3 failed SMS delivery recorded in deliveryLog", 25, 1000);

  if (entry) {
    check(
      entry.ok === false && !!entry.error,
      "B3 provider failure recorded (ok=false + error)",
      `channel=${entry.channel} ok=${entry.ok} error=${entry.error}`,
    );
    check(
      entry.alert && entry.alert.type === "sim_change",
      "B3 entry carries the sim_change alert context",
      entry.alert?.type,
    );

    // B4: retry through Service Health re-fires and logs a fresh attempt.
    const smsBefore = (await api("/api/admin/health")).json.deliveryLog.filter((e) => e.channel === "sms").length;
    const retry = await api("/api/admin/retry-delivery", { id: entry.id });
    check(retry.status === 200 && retry.json && retry.json.ok, "B4 retry-delivery accepted", JSON.stringify(retry.json).slice(0, 160));
    const after = await waitFor(async () => {
      const log = (await api("/api/admin/health")).json.deliveryLog;
      const smsNow = log.filter((e) => e.channel === "sms").length;
      return smsNow > smsBefore ? smsNow : null;
    }, "B4 retry re-fired a NEW sms delivery entry", 25, 1000);
    check(!!after, "B4 retry logged a fresh attempt", `sms entries ${smsBefore} → ${after}`);
  }

  // B5: throttle — a second sim_change within 60 s must NOT send another SMS.
  const countBefore = (await api("/api/admin/health")).json.deliveryLog.filter((e) => e.channel === "sms").length;
  await client.postEvent(deviceId, { type: "sim_change", detail: { from: "621|5", to: "621|1" } });
  await sleep(3000); // give a hypothetical (buggy) send time to appear
  const countAfter = (await api("/api/admin/health")).json.deliveryLog.filter((e) => e.channel === "sms").length;
  check(
    countAfter === countBefore,
    "B5 1/min throttle held — second alert sent no SMS (no spam)",
    `sms entries ${countBefore} → ${countAfter}`,
  );

  stopServer();
}

(async () => {
  await partA();
  await partB();
  console.log(`\ne2e-sms: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
