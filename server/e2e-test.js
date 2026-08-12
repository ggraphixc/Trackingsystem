/**
 * End-to-end sync test — simulates the dashboard and the agent against the
 * sync server using the agent's real SyncClient module.
 *
 * Run:  cd server && node e2e-test.js   (server must be running on :4173)
 */
const { SyncClient } = require("../desktop/src/sync-client");

const BASE = "http://localhost:4173";

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

(async () => {
  console.log("== Dravex sync E2E ==");

  // 1. Dashboard creates a pairing code.
  const pair = await api("/api/pair/register", { label: "TEST" });
  console.log("[1] pairing code:", pair.code);
  if (!pair.code) throw new Error("no pairing code");

  // 2. Agent claims it (real SyncClient code path).
  const client = new SyncClient(BASE);
  const claim = await client.claim(pair.code, {
    hostname: "TEST-LAPTOP",
    serialNumber: "SN12345",
    platform: "win32",
  });
  console.log("[2] agent claimed:", claim.deviceId);
  if (!claim || !claim.deviceId) throw new Error("claim failed");
  const deviceId = claim.deviceId;

  // 3. Agent uploads a location fix.
  const fix = {
    lat: 6.5244,
    lng: 3.3792,
    accuracy: 40,
    source: "wifi",
    networks: 5,
    ipAddress: "105.112.44.201",
    timestamp: new Date().toISOString(),
    confidence: 80,
  };
  await client.postFix(deviceId, fix);
  const fixes = await api(`/api/devices/${deviceId}/fixes`);
  console.log(`[3] fixes stored: ${fixes.length} (source=${fixes[0]?.source})`);
  if (fixes[0]?.source !== "wifi") throw new Error("fix not stored");

  // 4. Agent uploads webcam evidence.
  await client.postEvidence(deviceId, "data:image/png;base64,AAAA");
  const evidence = await api(`/api/devices/${deviceId}/evidence`);
  console.log(`[4] evidence stored: ${evidence.length}`);
  if (evidence.length !== 1) throw new Error("evidence not stored");

  // 5. Dashboard queues a remote command.
  const cmd = await api(`/api/devices/${deviceId}/commands`, { type: "alarm" });
  console.log("[5] command queued:", cmd.id);
  if (!cmd.ok) throw new Error("command not queued");

  // 6. Agent polls and acks it.
  const pending = await client.getCommands(deviceId, null);
  console.log(`[6] agent polls -> pending: ${pending.map((c) => c.type).join(",")}`);
  if (pending.length !== 1 || pending[0].type !== "alarm") throw new Error("command not delivered");
  await client.ackCommand(deviceId, pending[0].id);
  const after = await client.getCommands(deviceId, null);
  console.log(`[7] after ack, pending: ${after.length}`);
  if (after.length !== 0) throw new Error("ack failed");

  // 8. Dashboard sees the linked device summary.
  const dev = await api(`/api/devices/${deviceId}`);
  console.log("[8] dashboard view:", {
    hostname: dev.hostname,
    serial: dev.serialNumber,
    evidenceCount: dev.evidenceCount,
    commandCount: dev.commandCount,
  });

  // 9. Offline-vault burst sync: agent flushes fixes + evidence + a SIM-change
  // event captured while the phone had no data, in ONE batch call.
  const batch = await api(`/api/devices/${deviceId}/batch`, {
    items: [
      {
        type: "fix",
        fix: {
          lat: 9.0765,
          lng: 7.3986,
          accuracy: 60,
          source: "gps",
          timestamp: new Date().toISOString(),
          confidence: 90,
        },
      },
      { type: "evidence", dataUrl: "data:image/jpeg;base64,BBBB" },
      {
        type: "event",
        event: { type: "sim_change", detail: { from: "621|1", to: "621|5" } },
      },
    ],
  });
  console.log(`[9] vault batch: ok=${batch.ok} received=${batch.received} failed=${batch.failed}`);
  if (!batch.ok || batch.received !== 3 || batch.failed !== 0) throw new Error("batch sync failed");

  // 10. Events and batched evidence are persisted on the device.
  const dev2 = await api(`/api/devices/${deviceId}`);
  console.log(
    "[10] device events:",
    dev2.events.map((e) => e.type).join(","),
    "· evidence count:",
    dev2.evidenceCount,
  );
  if (!dev2.events.some((e) => e.type === "sim_change")) throw new Error("sim_change event not stored");
  if (dev2.evidenceCount !== 2) throw new Error("batched evidence not stored");

  // 11. The sim_change raised an in-app alert (alerts + unread count).
  const latest = await api("/api/alerts/latest");
  const simAlert = latest.alerts.find((a) => a.type === "sim_change" && a.deviceId === deviceId);
  console.log(`[11] alerts: ${latest.alerts.length} total, unread=${latest.unreadCount}, sim alert: ${!!simAlert}`);
  if (!simAlert) throw new Error("sim_change alert not raised");
  if (latest.unreadCount < 1) throw new Error("unread count is zero");

  // 12. Marking alerts read clears the unread badge.
  const read = await api("/api/alerts/read", { all: true });
  const afterRead = await api("/api/alerts/latest");
  console.log(`[12] marked all read: ok=${read.ok}, unread after=${afterRead.unreadCount}`);
  if (!read.ok || afterRead.unreadCount !== 0) throw new Error("mark-read failed");

  // 13. VAPID public key is served for browser push subscriptions.
  const vapid = await api("/api/push/vapid-key");
  console.log(`[13] vapid public key: ${vapid.publicKey ? vapid.publicKey.slice(0, 16) + "…" : "MISSING"}`);
  if (!vapid.publicKey || !/^[A-Za-z0-9_-]+$/.test(vapid.publicKey)) throw new Error("vapid key invalid");

  // 14. A (fake) push subscription persists; a test push reports per-endpoint.
  const sub = await api("/api/push/subscribe", {
    // Port 9 is closed — fails fast with ECONNREFUSED instead of a slow DNS hang.
    subscription: { endpoint: "https://127.0.0.1:9/fake-endpoint", keys: { p256dh: "AAAA", auth: "BBBB" } },
  });
  const test = await api("/api/push/test", { ping: true });
  console.log(`[14] subscribe ok=${sub.ok}, test push raw: ${JSON.stringify(test)}`);
  if (!sub.ok || !test.results || test.results.length !== 1) throw new Error("push subscribe/test failed");

  // 15. Owner configures SMS fallback alerts (phone number + enable). The
  // POST echoes the raw number back; the public GET is masked for privacy.
  const set = await api("/api/settings", { ownerPhone: "+2348012345678", smsEnabled: true });
  const got = await api("/api/settings");
  console.log(
    `[15] settings: raw=${set.ownerPhone} getMasked=${got.ownerPhone} enabled=${got.smsEnabled} provider=${got.sms?.provider}`,
  );
  if (
    set.ownerPhone !== "+2348012345678" ||
    !set.smsEnabled ||
    !got.smsEnabled ||
    !String(got.ownerPhone).includes("****")
  ) {
    throw new Error("settings not saved / not masked");
  }

  // 16. Test SMS — log mode (no provider credentials in CI) must still report ok.
  const sms = await api("/api/sms/test", {});
  console.log(`[16] sms test: ok=${sms.ok} mode=${sms.mode}${sms.error ? ` err=${sms.error}` : ""}`);
  if (!sms.ok || !sms.mode) throw new Error("sms test failed");

  // 17. The alert flow records SMS delivery status on the settings readout.
  const settings2 = await api("/api/settings");
  console.log(
    `[17] sms status: provider=${settings2.sms?.provider} lastSentAt=${settings2.sms?.lastSentAt ? "yes" : "no"} lastMode=${settings2.sms?.lastResult?.mode}`,
  );
  if (!settings2.sms?.lastSentAt) throw new Error("sms lastSentAt not recorded");

  // 18. Invalid phone numbers are rejected with a 400.
  const bad = await fetch(BASE + "/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerPhone: "not-a-phone" }),
  });
  console.log(`[18] invalid phone rejected: HTTP ${bad.status}`);
  if (bad.status !== 400) throw new Error("invalid phone not rejected");

  // 19. The desktop agent reports Wi-Fi BSSIDs with each fix — the laptop
  // fingerprint. The server must store them untouched.
  const wifiFix = {
    lat: 6.6018,
    lng: 3.3515,
    accuracy: 25,
    source: "wifi",
    networks: [
      { bssid: "A0:36:9F:11:22:33", ssid: "Spectranet-NG", rssi: -52 },
      { bssid: "F8:1A:67:44:55:66", ssid: "Starbucks-Wifi", rssi: -68 },
    ],
    timestamp: new Date().toISOString(),
    confidence: 85,
  };
  await client.postFix(deviceId, wifiFix);
  const wifiFixes = await api(`/api/devices/${deviceId}/fixes`);
  const latestFix = wifiFixes[0];
  console.log(
    `[19] wifi fingerprint: networks=${Array.isArray(latestFix?.networks) ? latestFix.networks.length : "none"} firstBssid=${latestFix?.networks?.[0]?.bssid}`,
  );
  if (!Array.isArray(latestFix?.networks) || latestFix.networks[0]?.bssid !== "A0:36:9F:11:22:33") {
    throw new Error("wifi fingerprint not stored");
  }

  // 20. Owner marks the device lost → community BLE beacon becomes active and
  // sightings will now raise alerts. A `lost` command is queued so the phone
  // agent arms its own beacon.
  const lostRes = await api(`/api/devices/${deviceId}/lost`, { lost: true });
  const lostCmds = await client.getCommands(deviceId, null);
  console.log(
    `[20] mark lost: ok=${lostRes.ok} lost=${lostRes.lost} queued=${lostCmds.map((c) => c.type).join(",")}`,
  );
  if (!lostRes.ok || lostRes.lost !== true) throw new Error("mark-lost failed");
  if (!lostCmds.some((c) => c.type === "lost")) throw new Error("lost command not queued");
  // Ack it so later steps see a clean queue.
  const lostCmd = lostCmds.find((c) => c.type === "lost");
  await client.ackCommand(deviceId, lostCmd.id);

  // 21. ANOTHER Dravex phone (anonymous — no deviceId, just the beacon it
  // heard over BLE) reports a sighting with the scanner's GPS position.
  const { beaconFor } = require("./beacon");
  const beacon = beaconFor(deviceId);
  const sighting = await api("/api/sightings", {
    beacon,
    lat: 6.5244,
    lng: 3.3792,
    accuracy: 18,
  });
  const sightings = await api(`/api/devices/${deviceId}/sightings`);
  console.log(
    `[21] sighting: reportOk=${sighting.ok} stored=${sightings.length} beacon=${beacon} loc=${sightings[0]?.lat.toFixed(4)},${sightings[0]?.lng.toFixed(4)}`,
  );
  if (!sighting.ok || sightings.length !== 1) throw new Error("sighting not stored");

  // 22. Because the device is lost, the sighting raised an in-app alert.
  const alerts2 = await api("/api/alerts/latest");
  const sightingAlert = alerts2.alerts.find((a) => a.type === "sighting" && a.deviceId === deviceId);
  console.log(`[22] sighting alert raised: ${!!sightingAlert}`);
  if (!sightingAlert) throw new Error("sighting alert not raised");

  // 23. Unknown beacons are silently swallowed (201) — scanners can't probe
  // which devices exist.
  const ghost = await api("/api/sightings", {
    beacon: "deadbeefcafe", // 12 hex chars, matches nobody
    lat: 6.5,
    lng: 3.4,
  });
  const ghosts = await api(`/api/devices/${deviceId}/sightings`);
  console.log(`[23] ghost beacon: ok=${ghost.ok} deviceSightingsStill=${ghosts.length}`);
  if (!ghost.ok || ghosts.length !== 1) throw new Error("ghost beacon leaked");

  // 24. Device list exposes the new phone-first fields.
  const devices2 = await api("/api/devices");
  const row = devices2.find((d) => d.deviceId === deviceId);
  console.log(
    `[24] device row: type=${row.type} lost=${row.lost} sightings=${row.sightingCount} operator=${row.operator}`,
  );
  if (row.type !== "laptop" || !row.lost || row.sightingCount !== 1) throw new Error("device row fields wrong");

  // 25. Re-marking lost generates a recovery code and delivers it inside the
  // `lost` command payload — the Android agent uses it for the ownership lock.
  const lostAgain = await api(`/api/devices/${deviceId}/lost`, { lost: true });
  const lostCmds2 = await client.getCommands(deviceId, null);
  const lostCmd2 = lostCmds2.find((c) => c.type === "lost");
  console.log(
    `[25] re-lost: recoveryCode=${lostAgain.recoveryCode} payloadCode=${lostCmd2?.payload?.recoveryCode}`,
  );
  if (!/^\d{4,8}$/.test(String(lostAgain.recoveryCode))) throw new Error("no recovery code generated");
  if (lostCmd2?.payload?.recoveryCode !== lostAgain.recoveryCode) {
    throw new Error("recovery code not delivered in command payload");
  }
  await client.ackCommand(deviceId, lostCmd2.id);

  // 26. The public Dravex Device Check flags the device's serial as stolen —
  // verdict only, NEVER owner/deviceId/location data (label stays generic).
  const hit = await api("/api/check?q=SN12345");
  console.log(`[26] check serial: found=${hit.found} status=${hit.status} label=${hit.label}`);
  if (!hit.found || hit.status !== "reported_stolen") throw new Error("registry check missed the stolen device");
  if ("deviceId" in hit || "hostname" in hit) throw new Error("check endpoint leaked owner data");
  if (hit.label !== "A laptop") throw new Error("check endpoint leaked a personal device label");

  // 27. Unknown identifiers come back clean — the registry can't be probed.
  const miss = await api("/api/check?q=ZZZ999UNKNOWN");
  console.log(`[27] check unknown: found=${miss.found} status=${miss.status}`);
  if (miss.found) throw new Error("unknown serial flagged as stolen");

  // 28. Marking found resolves the registry entry — the device reads clean
  // again (with a previouslyReported note, so honest sellers aren't flagged).
  const foundRes = await api(`/api/devices/${deviceId}/lost`, { lost: false });
  const afterFound = await api("/api/check?q=SN12345");
  console.log(
    `[28] mark found: ok=${foundRes.ok} check=${afterFound.status} previouslyReported=${afterFound.previouslyReported}`,
  );
  if (!foundRes.ok || afterFound.found || afterFound.status !== "clean" || !afterFound.previouslyReported) {
    throw new Error("resolved registry entry not returned as clean");
  }

  // 29. Too-short check queries are rejected with a 400.
  const short = await fetch(BASE + "/api/check?q=abc");
  console.log(`[29] short query rejected: HTTP ${short.status}`);
  if (short.status !== 400) throw new Error("short query not rejected");

  // 30. Wi-Fi geolocation is HONEST when unconfigured: without
  // GEOLOCATION_API_KEY the server answers 501 { source: "unresolved" } — the
  // desktop must never fabricate a coordinate from a fingerprint.
  const geo = await fetch(BASE + "/api/geolocate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bssids: ["A0:36:9F:11:22:33", "F8:1A:67:44:55:66"] }),
  });
  const geoBody = await geo.json();
  console.log(`[30] geolocate unconfigured: HTTP ${geo.status} source=${geoBody.source}`);
  if (geo.status !== 501 || geoBody.source !== "unresolved") throw new Error("geolocate not honest when unconfigured");

  // 31. /api/nearest answers with the nearest device fix (haversine in file
  // mode, PostGIS ST_Distance on Neon — same contract). The query uses a
  // coordinate unique to THIS run's deviceId so stale devices from earlier
  // runs against a persistent store can't win the distance query.
  const seed = parseInt(deviceId.slice(0, 4), 16) % 1000;
  const uLat = 5 + seed / 10000;
  const uLng = 3 + seed / 10000;
  await client.postFix(deviceId, {
    lat: uLat, lng: uLng, accuracy: 25, source: "gps",
    timestamp: new Date().toISOString(), confidence: 90,
  });
  // The server persists (and mirrors spatial points) on a 200 ms debounce —
  // settle before querying so the mirror includes this run's fresh fix.
  await new Promise((r) => setTimeout(r, 800));
  const near = await api(`/api/nearest?lat=${uLat}&lng=${uLng}&maxM=10000`);
  console.log(`[31] nearest: ${near.nearest ? near.nearest.deviceId === deviceId ? "this device" : "other" : "none"} dist=${near.nearest?.distMeters}m`);
  if (!near.nearest || near.nearest.deviceId !== deviceId) throw new Error("nearest device query failed");

  // 32. Ownership transfer (second-life): the registry clears and a fresh
  // single-use pairing code is issued for the new owner's agent.
  const transfer = await api(`/api/devices/${deviceId}/transfer`, {});
  const checkAfterTransfer = await api("/api/check?q=SN12345");
  const claimNew = await client.claim(transfer.code, {
    hostname: "NEW-OWNER-LAPTOP",
    serialNumber: "SN12345",
    platform: "win32",
  });
  console.log(
    `[32] transfer: ok=${transfer.ok} newCode=${!!transfer.code} check=${checkAfterTransfer.status} newClaim=${claimNew.deviceId === deviceId}`,
  );
  if (!transfer.ok || !transfer.code) throw new Error("transfer failed");
  if (checkAfterTransfer.found) throw new Error("registry not cleared after transfer");
  if (claimNew.deviceId !== deviceId) throw new Error("new owner could not claim the transferred device");

  // 33. Verified lifecycle: re-mark lost, then verify → recovered event and a
  // clean registry read for the same physical serial.
  await api(`/api/devices/${deviceId}/lost`, { lost: true });
  const verify = await api(`/api/devices/${deviceId}/verify`, {});
  const devVerified = await api(`/api/devices/${deviceId}`);
  const checkVerified = await api("/api/check?q=SN12345");
  console.log(
    `[33] verify: ok=${verify.ok} verifiedAt=${!!devVerified.verifiedAt} recoveredEvent=${devVerified.events.some((e) => e.type === "recovered")} check=${checkVerified.status}`,
  );
  if (!verify.ok || !devVerified.verifiedAt) throw new Error("verify failed");
  if (!devVerified.events.some((e) => e.type === "recovered")) throw new Error("recovered event missing");
  if (checkVerified.found) throw new Error("registry not resolved after verify");

  // 34. Recovery message + finder contact (M4): owner sets the one-way message,
  // a finder posts anonymously, and the message lands in the device + alerts.
  await api(`/api/devices/${deviceId}/lost`, { lost: true });
  const msg = await fetch(BASE + `/api/devices/${deviceId}/recovery-message`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "This is my phone — please contact me through Dravex.", contactPreference: "police station" }),
  });
  const contact = await fetch(BASE + `/api/devices/${deviceId}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "I found this phone at the market." }),
  });
  const devContacted = await api(`/api/devices/${deviceId}`);
  const contactAlert = (await api("/api/alerts/latest")).alerts.find(
    (a) => a.type === "contact" && a.deviceId === deviceId,
  );
  console.log(
    `[34] contact: msg=${msg.status} contact=${contact.status} inbox=${devContacted.contactMessages?.length ?? 0} alert=${!!contactAlert} ownerMsg=${devContacted.recoveryMessage?.message?.slice(0, 20)}…`,
  );
  if (msg.status !== 200 || !devContacted.recoveryMessage) throw new Error("recovery message not saved");
  if (contact.status !== 200 || (devContacted.contactMessages || []).length !== 1) {
    throw new Error("finder contact not stored");
  }
  if (!contactAlert) throw new Error("contact alert not raised");

  // 35. A finder message for a NON-lost device is a quiet no-op (200, nothing
  // stored) — the channel can't be used to poke at non-recovery devices.
  await api(`/api/devices/${deviceId}/lost`, { lost: false });
  const quiet = await fetch(BASE + `/api/devices/${deviceId}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "ping" }),
  });
  const devQuiet = await api(`/api/devices/${deviceId}`);
  console.log(`[35] contact on safe device: HTTP ${quiet.status} inboxStill=${devQuiet.contactMessages?.length ?? 0}`);
  if (quiet.status !== 200 || (devQuiet.contactMessages || []).length !== 1) {
    throw new Error("contact channel leaked onto a non-lost device");
  }

  // 36. Regression guard: GET /api/admin/health must be 200 in open mode and
  // expose the deliveryLog key (Phase 2.5 observability). This caught a real
  // 500 (undefined `sms`) — keep it pinned so it can't regress.
  const ah = await fetch(BASE + "/api/admin/health");
  const ahJson = await ah.json().catch(() => ({}));
  console.log(`[36] admin health: HTTP ${ah.status} deliveryLog=${Array.isArray(ahJson.deliveryLog)}`);
  if (ah.status !== 200 || !Array.isArray(ahJson.deliveryLog)) {
    throw new Error("admin/health regressed (expected 200 + deliveryLog array)");
  }

  console.log("== E2E PASSED ==");
})().then(
  () => {
    // Exit naturally (no process.exit) so pending fetch keep-alive handles
    // close cleanly — avoids the Node/Windows UV assertion on forced exit.
  },
  (e) => {
    console.error("E2E FAILED:", e.message);
    process.exit(1);
  },
);
