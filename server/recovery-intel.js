/**
 * Dravex Recovery Intelligence (Phase 3, P1 + P2).
 *
 * Pure, deterministic, dependency-free functions that turn a device's raw
 * stored signals (fixes, events, sightings, evidence, commands) into:
 *
 *   1. recoveryConfidence(dev) — an explainable 0–100 estimate of how fresh
 *      and strong the available signals are. NOT a probability of recovery;
 *      it is labelled as a "Recovery confidence — based on freshness and
 *      strength of available signals."
 *
 *   2. deriveCase(dev) — a coherent Recovery Case view over the existing
 *      device/event model. It NEVER duplicates stored data: the case is a
 *      read-side projection that references the device's own arrays. There is
 *      exactly one lifecycle model (Protected → Lost → Stolen → Detected →
 *      Sighted → Verified → Recovered) — the case adds the owner-facing
 *      wrapper (OPEN / ACTIVE RECOVERY / RECOVERED / CLOSED) on top.
 *
 * Scoring rules (P1): every factor is optional and only contributes when the
 * underlying signal EXISTS — missing data never fabricates a factor. The
 * engine is intentionally transparent: the returned `factors` array explains
 * every point of the score.
 *
 *   - signalRecency:   age of the last fix.   <1h=30, <6h=24, <24h=16,
 *                      <72h=8, else 3, no fix=0
 *   - sourceQuality:   quality of the last fix source.
 *                      gps=15, wifi_resolved=12, wifi=9, ip=6, last_known=3
 *   - sightingRecency: age of the most recent community sighting.
 *                      <6h=25, <24h=15, <72h=8, else 2, none=0
 *   - reconnect:       +10 when the device reconnected within 24 h
 *   - simChange:       +10 when a sim_change event exists (strong reuse signal)
 *   - movement:        +8 when ≥2 fixes show consistent movement
 *                      (median hop < 20 km — a phone moving through
 *                      neighbourhoods, not a data error)
 *   - evidence:        +7 when webcam evidence was captured within 24 h
 *
 * Levels: 0–29 low · 30–59 moderate · 60–79 strong · 80–100 high.
 */

const MS_HOUR = 3.6e6;

/** Age in hours of an ISO timestamp, or Infinity when absent. */
function hoursSince(iso) {
  if (!iso) return Infinity;
  const ms = Date.now() - new Date(iso).getTime();
  return ms <= 0 ? 0 : ms / MS_HOUR;
}

function scoreByAge(hours, buckets) {
  for (const [maxH, pts] of buckets) {
    if (hours <= maxH) return pts;
  }
  return buckets[buckets.length - 1][1];
}

const SOURCE_QUALITY = { gps: 15, wifi_resolved: 12, wifi: 9, ip: 6, last_known: 3 };
const AGE_BUCKETS = [
  [1, 30],
  [6, 24],
  [24, 16],
  [72, 8],
  [Infinity, 3],
];
const SIGHTING_BUCKETS = [
  [6, 25],
  [24, 15],
  [72, 8],
  [Infinity, 2],
];

function fmtAge(hours) {
  if (!Number.isFinite(hours)) return "never";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minute${Math.round(hours * 60) === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? "" : "s"} ago`;
}

/**
 * Deterministic recovery-confidence estimate. Returns
 * { score, level, factors: [{ name, impact, value }] } — every factor maps
 * to a real stored signal; nothing is invented.
 */
function recoveryConfidence(dev) {
  const factors = [];
  let score = 0;

  // 1. Signal recency — how fresh is the last known position.
  const fix = dev.lastFix || null;
  const fixH = fix ? hoursSince(fix.timestamp) : Infinity;
  const recencyPts = Number.isFinite(fixH) ? scoreByAge(fixH, AGE_BUCKETS) : 0;
  if (fix && Number.isFinite(fixH)) {
    score += recencyPts;
    factors.push({
      name: "Recent location",
      impact: recencyPts >= 16 ? "positive" : "negative",
      value: fixH < 0.02 ? "just now" : fmtAge(fixH),
    });
  }

  // 2. Source quality — how trustworthy is that position.
  if (fix && fix.source && SOURCE_QUALITY[fix.source] != null) {
    score += SOURCE_QUALITY[fix.source];
    factors.push({
      name: "Location source",
      impact: SOURCE_QUALITY[fix.source] >= 9 ? "positive" : "negative",
      value:
        fix.source === "gps"
          ? "GPS"
          : fix.source === "wifi_resolved"
            ? "Wi-Fi positioning (resolved)"
            : fix.source === "wifi"
              ? "Wi-Fi fingerprint"
              : fix.source === "ip"
                ? "IP geolocation"
                : "Last known",
    });
  }

  // 3. Community sightings — another Dravex device heard its beacon.
  const sightings = dev.sightings || [];
  const latestSighting = sightings[sightings.length - 1] || sightings[0] || null;
  const sightH = latestSighting ? hoursSince(latestSighting.at || latestSighting.receivedAt) : Infinity;
  if (latestSighting && Number.isFinite(sightH)) {
    const pts = scoreByAge(sightH, SIGHTING_BUCKETS);
    score += pts;
    factors.push({
      name: "Community sighting",
      impact: pts >= 15 ? "positive" : "negative",
      value: fmtAge(sightH),
    });
  }

  // 4. Reconnect — the device surfaced online after going quiet.
  const reconnectedH = hoursSince(dev.reconnectedAt);
  if (Number.isFinite(reconnectedH) && reconnectedH <= 24) {
    score += 10;
    factors.push({ name: "Reconnected", impact: "positive", value: fmtAge(reconnectedH) });
  }

  // 5. SIM change — a swapped SIM is a strong "being reused" signal.
  const simChange = (dev.events || []).find((e) => e.type === "sim_change");
  if (simChange) {
    score += 10;
    factors.push({
      name: "SIM changed",
      impact: "positive",
      value: fmtAge(hoursSince(simChange.at)),
    });
  }

  // 6. Movement consistency — real movement, not a single stale fix.
  const fixes = (dev.fixes || []).filter((f) => f && f.lat != null && f.lng != null);
  if (fixes.length >= 2) {
    const ordered = [...fixes].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const hops = [];
    for (let i = 1; i < ordered.length; i++) {
      hops.push(haversineKm(ordered[i - 1], ordered[i]));
    }
    hops.sort((a, b) => a - b);
    const median = hops[Math.floor(hops.length / 2)];
    if (median < 20) {
      score += 8;
      factors.push({
        name: "Movement consistent",
        impact: "positive",
        value: `${ordered.length} fixes · median hop ${median < 1 ? Math.round(median * 1000) + " m" : median.toFixed(1) + " km"}`,
      });
    } else {
      factors.push({
        name: "Movement inconsistent",
        impact: "negative",
        value: `median hop ${median.toFixed(1)} km — possible data error`,
      });
    }
  }

  // 7. Recent webcam evidence.
  const evidence = dev.evidence || [];
  const latestEvidence = evidence[evidence.length - 1] || null;
  if (latestEvidence) {
    const evH = hoursSince(latestEvidence.capturedAt || latestEvidence.receivedAt);
    if (Number.isFinite(evH) && evH <= 24) {
      score += 7;
      factors.push({ name: "Recent evidence", impact: "positive", value: fmtAge(evH) });
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 80 ? "high" : score >= 60 ? "strong" : score >= 30 ? "moderate" : "low";
  return { score, level, factors };
}

/** Great-circle distance in km (Haversine) — used by movement consistency. */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Lifecycle state — ONE model, derived in order of "furthest along":
 * Recovered > Sighted > Detected > Stolen > Lost > Protected.
 */
function lifecycleState(dev) {
  const events = dev.events || [];
  const recovered = dev.verifiedAt || events.some((e) => e.type === "recovered");
  if (recovered) return "recovered";
  if (!dev.lost) return "protected";
  if ((dev.sightings || []).length > 0) return "sighted";
  // "Detected" = a signal after the loss was reported (fix or reconnect).
  const fixH = dev.lastFix ? hoursSince(dev.lastFix.timestamp) : Infinity;
  const reconnectedH = hoursSince(dev.reconnectedAt);
  if (Number.isFinite(fixH) && fixH <= 24) return "detected";
  if (Number.isFinite(reconnectedH) && reconnectedH <= 24) return "detected";
  if (events.some((e) => e.type === "sim_change")) return "stolen";
  return "lost";
}

/**
 * Owner-facing case status: OPEN (never lost) · ACTIVE RECOVERY (lost) ·
 * RECOVERED (verified) · CLOSED (ownership transferred away).
 */
function caseStatus(dev) {
  if (dev.transferredAt) return "CLOSED";
  if (dev.verifiedAt) return "RECOVERED";
  if (dev.lost) return "ACTIVE RECOVERY";
  return "OPEN";
}

/**
 * Recovery Case projection — references the device's own arrays, never
 * duplicates them. caseId is stable: the deviceId (a UUID) IS the case id,
 * so a case link is just /dashboard/recovery/<deviceId>.
 */
function deriveCase(dev) {
  const events = dev.events || [];
  const lostEvent = [...events].reverse().find((e) => e.type === "lost");
  const openedAt = (lostEvent && lostEvent.at) || dev.pairedAt || null;
  const updatedAt = dev.lastSeenAt || (events.length ? events[events.length - 1].at : openedAt);
  const state = lifecycleState(dev);

  const timeline = buildTimeline(dev);

  return {
    caseId: dev.deviceId,
    deviceId: dev.deviceId,
    ownerId: dev.ownerId || null,
    label: dev.hostname || "Unnamed device",
    lifecycleState: state,
    caseStatus: caseStatus(dev),
    openedAt,
    updatedAt,
    lost: !!dev.lost,
    recoveryCodeArmed: !!dev.recoveryCode,
    report: {
      reportedAt: lostEvent ? lostEvent.at : null,
      reportedBy: dev.ownerId ? "account owner" : "shared owner",
      simChanged: events.some((e) => e.type === "sim_change"),
      reconnected: !!dev.reconnectedAt,
    },
    timeline,
    signal: {
      lastFix: dev.lastFix || null,
      fixCount: (dev.fixes || []).length,
      lastSeenAt: dev.lastSeenAt || null,
      reconnectedAt: dev.reconnectedAt || null,
      online: !!(dev.lastSeenAt && hoursSince(dev.lastSeenAt) <= 6),
    },
    community: {
      sightingCount: (dev.sightings || []).length,
      latestSighting:
        (dev.sightings || [])[(dev.sightings || []).length - 1] ||
        (dev.sightings || [])[0] ||
        null,
    },
    evidenceCount: (dev.evidence || []).length,
    commandCount: (dev.commands || []).length,
    finderMessages: (dev.contactMessages || []).length,
    confidence: recoveryConfidence(dev),
    outcome: dev.transferredAt
      ? { type: "transferred", at: dev.transferredAt }
      : dev.verifiedAt
        ? { type: "recovered", at: dev.verifiedAt }
        : null,
  };
}

/**
 * One chronological timeline merging device events, fixes, sightings,
 * commands, evidence and finder messages — newest first. Each entry carries
 * its timestamp, type, a human title and useful metadata.
 */
function buildTimeline(dev) {
  const entries = [];
  const events = dev.events || [];
  for (const e of events) {
    entries.push({
      at: e.at,
      type: e.type,
      title: eventTitle(e),
      detail: e.detail || null,
    });
  }
  for (const f of dev.fixes || []) {
    entries.push({
      at: f.timestamp || f.receivedAt,
      type: "fix",
      title: "Location fix",
      detail: { lat: f.lat, lng: f.lng, source: f.source, accuracy: f.accuracy ?? null },
    });
  }
  for (const s of dev.sightings || []) {
    entries.push({
      at: s.at || s.receivedAt,
      type: "sighting",
      title: "Community sighting",
      detail: { lat: s.lat, lng: s.lng, accuracy: s.accuracy ?? null },
    });
  }
  for (const c of dev.commands || []) {
    if (c.createdAt) {
      entries.push({
        at: c.createdAt,
        type: "command",
        title: `Command queued: ${c.type}`,
        detail: { commandId: c.id, acked: !!c.executedAt },
      });
    }
    if (c.executedAt) {
      entries.push({
        at: c.executedAt,
        type: "command_ack",
        title: `Command executed: ${c.type}`,
        detail: { commandId: c.id },
      });
    }
  }
  for (const ev of dev.evidence || []) {
    entries.push({
      at: ev.capturedAt || ev.receivedAt,
      type: "evidence",
      title: "Evidence captured",
      detail: { evidenceId: ev.id },
    });
  }
  for (const m of dev.contactMessages || []) {
    entries.push({
      at: m.at,
      type: "finder_message",
      title: "Finder message received",
      detail: { messageId: m.id },
    });
  }
  entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return entries;
}

function eventTitle(e) {
  switch (e.type) {
    case "lost":
      return "Reported lost — beacon armed";
    case "found":
      return "Marked found";
    case "reconnected":
      return "Back online";
    case "sim_change":
      return "SIM card changed";
    case "recovered":
      return "Verified recovered";
    case "transfer":
      return "Ownership transferred";
    case "pair":
      return "Device paired";
    default:
      return e.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

module.exports = { recoveryConfidence, deriveCase, lifecycleState, caseStatus, buildTimeline, haversineKm };
