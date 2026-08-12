/**
 * Phase 2.5 account-isolation end-to-end test.
 *
 * Run against a server started in open mode OR with DRAVEX_OWNER_KEY set:
 *   node server.js                       (open mode)
 *   DRAVEX_OWNER_KEY=... node server.js  (auth mode)
 *   node e2e-accounts.js
 *
 * Verifies the per-owner account model:
 *   - register/login/logout/me round-trip with validation (400/409)
 *   - two accounts see ONLY their own devices
 *   - cross-owner actions on another user's device are rejected (403)
 *   - logout invalidates the session token
 *   - re-login issues a fresh working session
 *   - sessions keep working when DRAVEX_OWNER_KEY is also set (ownerOk
 *     accepts session tokens — see server.js)
 */
const { SyncClient } = require("../desktop/src/sync-client");

const BASE = "http://localhost:4173";
// Unique emails per run so the suite is repeatable against a persistent
// Neon DB (a re-run must not 409 on its own previous users).
const RUN = Date.now();
const EMAIL_A = `alice.${RUN}@test.dev`;
const EMAIL_B = `bob.${RUN}@test.dev`;
const PASSWORD = "hunter2-password";

let step = 0;
function ok(label) {
  step++;
  console.log(`[${step}] ${label}`);
}

async function api(path, body, bearer) {
  const res = await fetch(BASE + path, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function register(email) {
  const r = await api("/api/auth/register", { email, password: PASSWORD });
  if (r.status !== 201 || !r.json.token) throw new Error(`register ${email} failed: ${r.status}`);
  return r.json.token;
}

(async () => {
  console.log("== Dravex accounts E2E (Phase 2.5) ==");

  // 1. Validation: weak password and bad email are rejected up front.
  let r = await api("/api/auth/register", { email: EMAIL_A, password: "short" });
  if (r.status !== 400) throw new Error(`weak password accepted (${r.status})`);
  r = await api("/api/auth/register", { email: "not-an-email", password: PASSWORD });
  if (r.status !== 400) throw new Error(`bad email accepted (${r.status})`);
  ok("register validation: 400 400");

  // 2. Two accounts register; duplicate email is a 409.
  const tokenA = await register(EMAIL_A);
  const tokenB = await register(EMAIL_B);
  r = await api("/api/auth/register", { email: EMAIL_A, password: PASSWORD });
  if (r.status !== 409) throw new Error(`duplicate email allowed (${r.status})`);
  ok("two accounts + duplicate-email 409");

  // 3. /api/auth/me reports email + device count for each session.
  r = await api("/api/auth/me", undefined, tokenA);
  if (r.status !== 200 || r.json.email !== EMAIL_A || r.json.deviceCount !== 0) {
    throw new Error(`me(A) unexpected: ${r.status} ${JSON.stringify(r.json)}`);
  }
  r = await api("/api/auth/me", undefined, tokenB);
  if (r.status !== 200 || r.json.email !== EMAIL_B) throw new Error("me(B) failed");
  ok("auth/me: both sessions resolve to their own user");

  // 4. Each account pairs its own device (session → ownerId on the code).
  r = await api("/api/pair/register", { label: "A" }, tokenA);
  if (r.status !== 201) throw new Error("pair register A failed");
  const codeA = r.json.code;
  r = await api("/api/pair/register", { label: "B" }, tokenB);
  if (r.status !== 201) throw new Error("pair register B failed");
  const codeB = r.json.code;

  const agentA = new SyncClient(BASE);
  const agentB = new SyncClient(BASE);
  const claimA = await agentA.claim(codeA, { hostname: "ALICE-LAPTOP", serialNumber: "SN-ALICE-1", platform: "win32" });
  const claimB = await agentB.claim(codeB, { hostname: "BOB-PHONE", serialNumber: "SN-BOB-1", platform: "android", imei: "350000000000001" });
  if (!claimA || !claimB) throw new Error("claims failed");
  ok("each account paired + claimed its own device");

  // 5. Device lists are isolated: each session sees exactly one device, its own.
  r = await api("/api/devices", undefined, tokenA);
  const devsA = r.json;
  if (r.status !== 200 || !Array.isArray(devsA) || devsA.length !== 1 || devsA[0].hostname !== "ALICE-LAPTOP") {
    throw new Error(`Alice sees wrong devices: ${JSON.stringify(devsA)}`);
  }
  r = await api("/api/devices", undefined, tokenB);
  const devsB = r.json;
  if (r.status !== 200 || !Array.isArray(devsB) || devsB.length !== 1 || devsB[0].hostname !== "BOB-PHONE") {
    throw new Error(`Bob sees wrong devices: ${JSON.stringify(devsB)}`);
  }
  ok("device isolation: each session sees only its own device");

  // 6. Cross-owner actions are 403: Alice cannot touch Bob's device.
  r = await api(`/api/devices/${claimB.deviceId}/lost`, { lost: true }, tokenA);
  if (r.status !== 403) throw new Error(`Alice could mark Bob's device lost (${r.status})`);
  r = await api(`/api/devices/${claimB.deviceId}/transfer`, {}, tokenA);
  if (r.status !== 403) throw new Error(`Alice could transfer Bob's device (${r.status})`);
  r = await api(`/api/devices/${claimA.deviceId}/lost`, { lost: true }, tokenB);
  if (r.status !== 403) throw new Error(`Bob could mark Alice's device lost (${r.status})`);
  r = await api(`/api/devices/${claimA.deviceId}/fixes?limit=5`, undefined, tokenB);
  if (r.status === 200) throw new Error(`Bob could read Alice's fixes (${r.status})`);
  ok("cross-owner isolation: 403 403 403 + fixes read rejected");

  // 7. Owners CAN act on their own devices (mark-lost round trip).
  r = await api(`/api/devices/${claimA.deviceId}/lost`, { lost: true }, tokenA);
  if (r.status !== 200 || !r.json.recoveryCode) throw new Error("Alice mark-lost failed");
  r = await api(`/api/devices/${claimA.deviceId}/lost`, { lost: false }, tokenA);
  if (r.status !== 200) throw new Error("Alice mark-found failed");
  ok("owner self-service: mark lost + found ok");

  // 8. me() deviceCount updates after claiming.
  r = await api("/api/auth/me", undefined, tokenA);
  if (r.status !== 200 || r.json.deviceCount !== 1) throw new Error(`deviceCount=${r.json.deviceCount}`);
  ok("auth/me deviceCount = 1");

  // 9. Logout invalidates the session (me() is session-only in BOTH modes).
  r = await api("/api/auth/logout", {}, tokenA);
  if (r.status !== 200) throw new Error("logout failed");
  r = await api("/api/auth/me", undefined, tokenA);
  if (r.status !== 401) throw new Error(`me after logout allowed (${r.status})`);
  ok("logout invalidates session (me → 401)");

  // 10. Re-login issues a fresh working session.
  r = await api("/api/auth/login", { email: EMAIL_A, password: PASSWORD });
  if (r.status !== 200 || !r.json.token) throw new Error("re-login failed");
  const tokenA2 = r.json.token;
  r = await api("/api/auth/me", undefined, tokenA2);
  if (r.status !== 200 || r.json.email !== EMAIL_A) throw new Error("fresh session broken");
  ok("re-login: fresh session works");

  // 11. Transfer under a session: the seller's account loses access (ownerId
  // is cleared — a sold device must not stay controllable by its old owner).
  r = await api(`/api/devices/${claimA.deviceId}/transfer`, {}, tokenA2);
  if (r.status !== 200 || !r.json.code) throw new Error("Alice transfer with session failed");
  r = await api("/api/devices", undefined, tokenA2);
  if (r.status !== 200 || !Array.isArray(r.json) || r.json.length !== 0) {
    throw new Error(`old owner still sees transferred device: ${JSON.stringify(r.json)}`);
  }
  ok("transfer clears ownership: seller's device list is empty");

  // 12. The unowned device is controlled by no one — Bob still gets 403.
  r = await api(`/api/devices/${claimA.deviceId}/lost`, { lost: true }, tokenB);
  if (r.status !== 403) throw new Error(`unowned device controllable by Bob (${r.status})`);
  ok("unowned after transfer: cross-owner still 403");

  console.log("== ACCOUNTS E2E PASSED ==");
})().then(
  () => {},
  (e) => {
    console.error("ACCOUNTS E2E FAILED:", e.message);
    process.exit(1);
  },
);
