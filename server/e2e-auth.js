/**
 * Auth-mode end-to-end test.
 *
 * Run against a server started WITH auth enabled:
 *   DRAVEX_OWNER_KEY=test-owner-key-123 node server.js
 *   node e2e-auth.js
 *
 * Verifies: public endpoints stay open, owner endpoints require the key,
 * device endpoints require the per-device token issued at claim, and the
 * recovery code / mark-lost are owner-only.
 */
const { SyncClient } = require("../desktop/src/sync-client");

const BASE = "http://localhost:4173";
const KEY = process.env.DRAVEX_OWNER_KEY || "test-owner-key-123";

async function api(path, body, bearer) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

(async () => {
  console.log("== Dravex auth E2E (DRAVEX_OWNER_KEY set) ==");

  // 1. Public endpoints stay open without any credential.
  let r = await api("/api/health");
  if (r.status !== 200) throw new Error(`health not public (${r.status})`);
  r = await api("/api/check?q=ZZZ999");
  if (r.status !== 200) throw new Error(`check not public (${r.status})`);
  console.log(`[1] public: health ${r.status}, check ${r.status}`);

  // 2. Owner-only endpoints reject requests without the key.
  r = await api("/api/pair/register", { label: "AUTH" });
  if (r.status !== 401) throw new Error(`register w/o key allowed (${r.status})`);
  r = await api("/api/devices");
  if (r.status !== 401) throw new Error(`devices list w/o key allowed (${r.status})`);
  console.log("[2] owner endpoints reject without key: 401 401");

  // 3. With the key, pairing works.
  r = await api("/api/pair/register", { label: "AUTH" }, KEY);
  if (r.status !== 201 || !r.json.code) throw new Error("register with key failed");
  console.log(`[3] register with key: ${r.status} (code ${r.json.code})`);

  // 4. Claim needs only the code (it's the credential) and issues a token.
  const client = new SyncClient(BASE);
  const claim = await client.claim(r.json.code, {
    hostname: "AUTH-LAPTOP",
    serialNumber: "AUTH-SN-001",
    platform: "win32",
  });
  if (!claim || !claim.deviceId || !claim.token) throw new Error("claim did not issue a token");
  console.log(`[4] claim -> deviceId + token: yes (${claim.deviceId.slice(0, 8)}…)`);

  // 5. Device-scoped uploads reject without the token.
  const bare = new SyncClient(BASE);
  const noTokenFix = await bare.postFix(claim.deviceId, {
    lat: 6.5244, lng: 3.3792, accuracy: 40, source: "wifi",
    timestamp: new Date().toISOString(), confidence: 80,
  });
  if (noTokenFix !== null) throw new Error("fix uploaded without device token");
  console.log("[5] fix without token: rejected (401)");

  // 6. With the token they pass.
  client.setDeviceToken(claim.token);
  if (!(await client.postFix(claim.deviceId, {
    lat: 6.5244, lng: 3.3792, accuracy: 40, source: "wifi",
    timestamp: new Date().toISOString(), confidence: 80,
  }))) throw new Error("fix with token failed");
  console.log("[6] fix with token: ok");

  // 7. A device token alone is NOT enough for owner reads.
  const devOnly = new SyncClient(BASE).setDeviceToken(claim.token);
  if ((await devOnly.listDevices()) !== null) throw new Error("device token leaked owner list");
  console.log("[7] devices list with device token only: rejected (401)");

  // 8. Owner key unlocks the list + mark-lost + recovery code.
  const owner = new SyncClient(BASE).setOwnerKey(KEY);
  const list = await owner.listDevices();
  if (!Array.isArray(list)) throw new Error("owner list failed with key");
  const lost = await owner.setDeviceLost(claim.deviceId, true);
  if (!lost || !lost.recoveryCode) throw new Error("mark-lost/recovery code failed with key");
  console.log(`[8] owner with key: list ${list.length} rows, lost -> recoveryCode ${lost.recoveryCode}`);

  // 9. The agent polls + acks commands with its token.
  const cmds = await client.getCommands(claim.deviceId, null);
  const lostCmd = cmds.find((c) => c.type === "lost");
  if (!lostCmd) throw new Error("lost command not delivered with token");
  if (!(await client.ackCommand(claim.deviceId, lostCmd.id))) throw new Error("ack with token failed");
  console.log("[9] command poll + ack with token: ok");

  // 10. Mark-lost (owner-only) is rejected with just a device token.
  if ((await devOnly.setDeviceLost(claim.deviceId, false)) !== null) {
    throw new Error("mark-lost allowed with device token only");
  }
  console.log("[10] mark-lost with device token only: rejected (401)");

  // 11. Community sightings stay anonymous/public.
  r = await api("/api/sightings", { beacon: "aabbccddeeff", lat: 6.5, lng: 3.4 });
  if (r.status !== 201) throw new Error(`sighting not public (${r.status})`);
  console.log(`[11] sighting public: ${r.status}`);

  console.log("== AUTH E2E PASSED ==");
})().then(
  () => {},
  (e) => {
    console.error("AUTH E2E FAILED:", e.message);
    process.exit(1);
  },
);
