/**
 * Password-reset end-to-end test (self-contained, hermetic).
 *
 * Boots its own Dravex server on a random port in FILE mode with
 * ALERT_WEBHOOK_URL pointing at a local capture server (also in this
 * process), then verifies the full forgot → deliver → reset → login flow:
 *
 *   1. register an account
 *   2. POST /api/auth/forgot { email }  → 200 (uniform, no account oracle)
 *   3. the reset token arrives via the webhook capture
 *   4. POST /api/auth/reset { token, newPassword } → fresh session
 *   5. login with the NEW password works, the OLD password is rejected
 *   6. a bogus token is rejected (400) — and the uniform 200 for unknown
 *      emails holds (no enumeration)
 *
 * Run:  cd server && node e2e-reset.js
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const PORT = 4300 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_FILE = path.join(__dirname, "reset-data.json");

let serverProc = null;
let capture = null;
let received = [];

async function post(p, b) {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b || {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch (_) {
      /* not up yet */
    }
    await sleep(400);
  }
  return false;
}

function startCapture() {
  return new Promise((resolve) => {
    capture = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          received.push(JSON.parse(body));
        } catch (_) {
          received.push({ raw: body });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    capture.listen(0, "127.0.0.1", () => resolve(capture.address().port));
  });
}

function startServer(webhookPort) {
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
        DATABASE_URL: "", // force hermetic file mode
        ALERT_WEBHOOK_URL: `http://127.0.0.1:${webhookPort}/reset`,
      },
      stdio: "ignore",
    });
    resolve();
  });
}

function stopAll() {
  try {
    fs.unlinkSync(DATA_FILE);
  } catch (_) {
    /* ignore */
  }
  if (capture) capture.close();
  if (serverProc) serverProc.kill();
}

(async () => {
  console.log("== Dravex password-reset E2E ==");
  const webhookPort = await startCapture();
  await startServer(webhookPort);
  if (!(await waitHealth())) {
    stopAll();
    throw new Error("reset server did not start");
  }

  // 1. Register.
  const email = `reset.${Date.now()}@test.dev`;
  const r0 = await post("/api/auth/register", { email, password: "old-password-1" });
  if (r0.status !== 201) throw new Error(`register failed (${r0.status})`);
  console.log("[1] account registered ✓");

  // 2. Forgot → uniform 200, delivered via webhook.
  const r1 = await post("/api/auth/forgot", { email });
  if (r1.status !== 200 || r1.json.deliveredVia !== "webhook") {
    throw new Error(`forgot not via webhook: ${JSON.stringify(r1.json)}`);
  }
  // 3. Unknown email also 200 (no account oracle), and it must NOT deliver.
  const r2 = await post("/api/auth/forgot", { email: "ghost@test.dev" });
  if (r2.status !== 200) throw new Error("forgot(unknown) not 200");
  await sleep(500);
  if (received.filter((p) => p.type === "password_reset").length !== 1) {
    throw new Error("reset delivered for unknown email — enumeration leak");
  }
  console.log("[2] forgot → webhook delivery · unknown email stays silent ✓");

  // 4. Capture the token from the webhook payload.
  const payload = received.find((p) => p.type === "password_reset");
  if (!payload || !payload.token || !payload.expiresAt) throw new Error("reset payload missing token");
  if (new Date(payload.expiresAt).getTime() <= Date.now()) throw new Error("reset token already expired");
  console.log("[3] reset token captured from webhook (1 h TTL) ✓");

  // 5. Reset with a bogus token → 400.
  const r3 = await post("/api/auth/reset", { token: "deadbeef", password: "new-password-2" });
  if (r3.status !== 400) throw new Error(`bogus token accepted (${r3.status})`);
  console.log("[4] bogus token rejected (400) ✓");

  // 6. Reset with the real token → fresh session, old password now dead.
  const r4 = await post("/api/auth/reset", { token: payload.token, password: "new-password-2" });
  if (r4.status !== 200 || !r4.json.token) throw new Error("reset with real token failed");
  const old = await post("/api/auth/login", { email, password: "old-password-1" });
  if (old.status !== 401) throw new Error("old password still valid after reset");
  const fresh = await post("/api/auth/login", { email, password: "new-password-2" });
  if (fresh.status !== 200 || !fresh.json.token) throw new Error("new password login failed");
  console.log("[5] reset → old password dead, new password logs in ✓");

  // 7. The reset token is single-use.
  const r5 = await post("/api/auth/reset", { token: payload.token, password: "third-password-3" });
  if (r5.status !== 400) throw new Error(`reset token reusable (${r5.status})`);
  console.log("[6] reset token is single-use ✓");

  console.log("== RESET E2E PASSED ==");
  stopAll();
})().then(
  () => {},
  (e) => {
    console.error("RESET E2E FAILED:", e.message);
    stopAll();
    process.exit(1);
  },
);
