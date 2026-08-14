"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDevice,
  getEventPage,
  getEvidencePack,
  getFixPage,
  getRecoveryCase,
  getSightingPage,
  sendCommand,
  setDeviceLost,
  setRecoveryMessage,
  transferDevice,
  verifyDevice,
} from "@/lib/api";
import type {
  CommunitySighting,
  DeviceEvent,
  LocationFix,
  PairedDevice,
  RecoveryCase,
} from "@/lib/api";
import {
  AlertTriangleIcon,
  AlarmIcon,
  CheckCircleIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  DocumentTextIcon,
  EyeIcon,
  LinkIcon,
  LockClosedIcon,
  MapPinIcon,
  RefreshIcon,
  WifiIcon,
} from "@/components/icons";
import { Card, MapPreview, ProgressBar, SectionTitle } from "@/components/ui";

const LIFECYCLE = ["protected", "lost", "stolen", "detected", "sighted", "verified", "recovered"] as const;

const LIFECYCLE_LABEL: Record<string, string> = {
  protected: "Protected",
  lost: "Lost",
  stolen: "Stolen",
  detected: "Detected",
  sighted: "Sighted",
  verified: "Verified",
  recovered: "Recovered",
};

const SOURCE_LABEL: Record<string, string> = {
  wifi: "Wi-Fi positioning",
  wifi_resolved: "Wi-Fi (resolved)",
  ip: "IP geolocation",
  gps: "GPS",
  ble: "Bluetooth sighting",
  last_known: "Last known",
};

/** Mirrors the server's eventTitle() so the paged events feed renders nicely. */
function eventTitle(e: DeviceEvent): string {
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

/** Append a newer-fetched page to an accumulated newest-first array, deduped. */
function appendUnique<T>(prev: T[], next: T[], key: (item: T) => string): T[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map(key));
  const fresh = next.filter((item) => !seen.has(key(item)));
  return [...prev, ...fresh];
}

/**
 * Timeline entry types covered by the paginated feeds. The case's merged
 * timeline still supplies the non-bulk entries (commands, evidence, finder
 * messages) so nothing is lost — those are few and fetched once.
 */
const BULK_TIMELINE_TYPES = new Set([
  "fix",
  "sighting",
  "lost",
  "stolen",
  "found",
  "recovered",
  "reconnected",
  "sim_change",
  "verification",
  "transfer",
]);

const LEVEL_STYLE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  strong: "bg-primary/10 text-primary ring-primary/20",
  moderate: "bg-amber-50 text-amber-700 ring-amber-600/20",
  low: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* ------------------------------------------------------------------ */
/* Schematic recovery map: last fix + recent fixes + sightings + path.  */
/* Honest by construction — it plots only real stored coordinates and   */
/* never claims street-level precision (no tile service in the MVP).    */
/* ------------------------------------------------------------------ */

function RecoveryMap({
  fixes,
  sightings,
  lastFix,
  label,
}: {
  fixes: LocationFix[];
  sightings: CommunitySighting[];
  lastFix: LocationFix | null;
  label: string;
}) {
  const points = useMemo(() => {
    const pts: { lat: number; lng: number; kind: "fix" | "sighting" | "last" }[] = [];
    for (const f of fixes) pts.push({ lat: f.lat, lng: f.lng, kind: "fix" });
    for (const s of sightings) pts.push({ lat: s.lat, lng: s.lng, kind: "sighting" });
    if (lastFix) pts.push({ lat: lastFix.lat, lng: lastFix.lng, kind: "last" });
    return pts;
  }, [fixes, sightings, lastFix]);

  const W = 640;
  const H = 320;
  const PAD = 40;

  if (points.length === 0) {
    return <MapPreview className="h-64 w-full rounded-none border-0" label={label} />;
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = Math.max(maxLat - minLat, 0.004);
  const spanLng = Math.max(maxLng - minLng, 0.004);
  const scale = Math.min((W - 2 * PAD) / spanLng, (H - 2 * PAD) / spanLat);
  const ox = (W - spanLng * scale) / 2;
  const oy = (H - spanLat * scale) / 2;
  const px = (lng: number) => ox + (lng - minLng) * scale;
  const py = (lat: number) => oy + (maxLat - lat) * scale;

  const ordered = [...fixes].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const path = ordered.map((f, i) => `${i === 0 ? "M" : "L"}${px(f.lng).toFixed(1)},${py(f.lat).toFixed(1)}`).join(" ");
  const lastFixPx = lastFix ? { x: px(lastFix.lng), y: py(lastFix.lat) } : null;
  const accR = lastFix && lastFix.accuracy ? Math.max(4, (lastFix.accuracy / 111000) * scale) : null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 via-blue-50/40 to-emerald-50/40">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-64 w-full" role="img" aria-label={`Recovery map for ${label}`}>
        {/* stylized grid */}
        <defs>
          <pattern id="recovery-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="#cbd5e1" strokeOpacity="0.5" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#recovery-grid)" />
        {/* movement path */}
        {ordered.length > 1 ? (
          <path d={path} fill="none" stroke="#2563EB" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" opacity="0.7" />
        ) : null}
        {/* accuracy area around the last fix */}
        {accR ? (
          <circle cx={lastFixPx!.x} cy={lastFixPx!.y} r={accR} fill="#2563EB" fillOpacity="0.08" stroke="#2563EB" strokeOpacity="0.25" strokeDasharray="4 3" />
        ) : null}
        {/* fixes */}
        {fixes.map((f, i) => (
          <circle key={`f${i}`} cx={px(f.lng)} cy={py(f.lat)} r="4.5" fill="#2563EB" fillOpacity="0.55" stroke="#fff" strokeWidth="1.5" />
        ))}
        {/* sightings */}
        {sightings.map((s, i) => (
          <circle key={`s${i}`} cx={px(s.lng)} cy={py(s.lat)} r="5" fill="#8B5CF6" fillOpacity="0.65" stroke="#fff" strokeWidth="1.5" />
        ))}
        {/* last fix — the star of the show */}
        {lastFixPx ? (
          <>
            <circle cx={lastFixPx.x} cy={lastFixPx.y} r="14" fill="#F97316" fillOpacity="0.15" />
            <circle cx={lastFixPx.x} cy={lastFixPx.y} r="6.5" fill="#F97316" stroke="#fff" strokeWidth="2" />
          </>
        ) : null}
      </svg>
      <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-medium text-ink shadow-card backdrop-blur">
        <span className="inline-flex items-center gap-1.5">
          <MapPinIcon className="h-3.5 w-3.5 text-accent" />
          {label}
        </span>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 font-mono text-[10px] text-ink-muted shadow-card backdrop-blur">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-600" /> fix
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-violet-500" /> sighting
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent" /> last
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function RecoveryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [device, setDevice] = useState<PairedDevice | null>(null);
  const [kase, setKase] = useState<RecoveryCase | null>(null);
  // Scale Core (P4/P5): history is fetched page-by-page, newest first. The
  // arrays accumulate as the user loads older history; the map and timeline
  // render only what has been fetched so far.
  const [fixes, setFixes] = useState<LocationFix[]>([]);
  const [sightings, setSightings] = useState<CommunitySighting[]>([]);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [fixCursor, setFixCursor] = useState<string | null>(null);
  const [sightCursor, setSightCursor] = useState<string | null>(null);
  const [evCursor, setEvCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEnded, setHistoryEnded] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    setHistoryEnded(false);
    const [dev, k, fPage, sPage, ePage] = await Promise.all([
      getDevice(id),
      getRecoveryCase(id),
      getFixPage(id, { limit: 50 }),
      getSightingPage(id, { limit: 50 }),
      getEventPage(id, { limit: 50 }),
    ]);
    setDevice(dev);
    setKase(k);
    setFixes(fPage?.items ?? []);
    setSightings(sPage?.items ?? []);
    setEvents(ePage?.items ?? []);
    setFixCursor(fPage?.nextCursor ?? null);
    setSightCursor(sPage?.nextCursor ?? null);
    setEvCursor(ePage?.nextCursor ?? null);
    setHistoryEnded(
      !(fPage?.hasMore || sPage?.hasMore || ePage?.hasMore),
    );
    setLoading(false);
  }, [id]);

  /** Fetch the next page of each feed and append — never reloads the case. */
  const loadOlder = useCallback(async () => {
    if (historyLoading || historyEnded) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const [fPage, sPage, ePage] = await Promise.all([
        fixCursor ? getFixPage(id, { limit: 50, cursor: fixCursor }) : Promise.resolve(null),
        sightCursor ? getSightingPage(id, { limit: 50, cursor: sightCursor }) : Promise.resolve(null),
        evCursor ? getEventPage(id, { limit: 50, cursor: evCursor }) : Promise.resolve(null),
      ]);
      setFixes((prev) => appendUnique(prev, fPage?.items ?? [], (f) => f.id ?? `${f.timestamp}`));
      setSightings((prev) => appendUnique(prev, sPage?.items ?? [], (s) => s.id ?? `${s.at}`));
      setEvents((prev) => appendUnique(prev, ePage?.items ?? [], (e) => e.id ?? `${e.type}${e.at}`));
      setFixCursor(fPage?.nextCursor ?? null);
      setSightCursor(sPage?.nextCursor ?? null);
      setEvCursor(ePage?.nextCursor ?? null);
      if (!(fPage?.hasMore || sPage?.hasMore || ePage?.hasMore)) setHistoryEnded(true);
    } catch {
      setHistoryError("Could not load older history — the server may be offline. Try again.");
    } finally {
      setHistoryLoading(false);
    }
  }, [id, fixCursor, sightCursor, evCursor, historyLoading, historyEnded]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
  };

  /**
   * One newest-first merged timeline: the paginated bulk feeds (fixes,
   * sightings, events) plus the case's non-bulk entries (commands, evidence,
   * finder messages) that the feeds don't carry. Deduped so a feed boundary
   * can never render the same event twice.
   */
  const timeline = useMemo(() => {
    interface Entry {
      at: string;
      type: string;
      title: string;
      detail?: Record<string, unknown> | null;
      key: string;
    }
    const entries: Entry[] = [];
    const seen = new Set<string>();
    const push = (e: Entry) => {
      if (seen.has(e.key)) return;
      seen.add(e.key);
      entries.push(e);
    };
    for (const f of fixes) {
      push({
        at: f.timestamp || f.receivedAt || "",
        type: "fix",
        title: "Location fix",
        detail: { lat: f.lat, lng: f.lng, source: f.source, accuracy: f.accuracy ?? null },
        key: `fix::${f.id ?? f.timestamp}`,
      });
    }
    for (const s of sightings) {
      push({
        at: s.at || s.receivedAt || "",
        type: "sighting",
        title: "Community sighting",
        detail: { lat: s.lat, lng: s.lng, accuracy: s.accuracy ?? null },
        key: `sighting::${s.id ?? s.at}`,
      });
    }
    for (const e of events) {
      push({
        at: e.at || "",
        type: e.type,
        title: eventTitle(e),
        detail: e.detail || null,
        key: `event::${e.id ?? `${e.type}${e.at}`}`,
      });
    }
    if (kase) {
      for (const t of kase.timeline) {
        if (BULK_TIMELINE_TYPES.has(t.type)) continue; // already from the feeds
        push({
          at: t.at,
          type: t.type,
          title: t.title,
          detail: t.detail ?? null,
          key: `extra::${t.type}::${t.at}`,
        });
      }
    }
    return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [fixes, sightings, events, kase]);

  async function confirmAction(title: string, detail: string, fn: () => Promise<void>) {
    if (!window.confirm(`${title}\n\n${detail}`)) return;
    setBusy(true);
    try {
      await fn();
    } catch {
      setErr("Could not reach the server — is it online?");
    } finally {
      setBusy(false);
    }
  }

  async function markFound() {
    await confirmAction(
      "Mark this device as found?",
      "The community beacon stops, and its stolen-registry listing is resolved.",
      async () => {
        const res = await setDeviceLost(id, false);
        if (res?.ok) {
          flash("Device marked found — beacon disarmed.");
          load();
        } else setErr("Could not reach the server — is it online?");
      },
    );
  }

  async function verifyRecovered() {
    await confirmAction(
      "Confirm this device is back?",
      "It is marked verified-recovered, the beacon disarms and the registry listing resolves.",
      async () => {
        const res = await verifyDevice(id);
        if (res?.ok) {
          flash("Device verified recovered.");
          load();
        } else setErr("Could not reach the server — is it online?");
      },
    );
  }

  async function transferOwnership() {
    await confirmAction(
      "Transfer this device to a new owner?",
      "Its registry listing is cleared, the old agent is disconnected, and a fresh pairing code is issued for the new owner's agent. Previous owner data is purged.",
      async () => {
        const res = await transferDevice(id);
        if (res?.ok) {
          window.alert(
            `Device transferred. Give this pairing code to the new owner (it expires on first use):\n\n${res.code ?? ""}\n\nThey enter it in the Dravex agent to link the device.`,
          );
          load();
        } else setErr("Could not reach the server — is it online?");
      },
    );
  }

  async function command(type: "lock" | "alarm" | "webcam", label: string) {
    const ok = await sendCommand(id, type);
    flash(ok ? `${label} command sent to the agent.` : "Command failed — server offline?");
  }

  async function locateNow() {
    setBusy(true);
    await load();
    setBusy(false);
    flash("Recovery view refreshed with the latest signals.");
  }

  async function exportEvidencePack() {
    const pack = await getEvidencePack(id);
    if (!pack) {
      setErr("Could not build the evidence pack — check the server.");
      return;
    }
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dravex-evidence-pack-${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash("Evidence pack exported — retention policy respected (expired evidence excluded).");
  }

  function copyRecoveryLink() {
    const url = `${window.location.origin}/recover/${id}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      },
      () => setErr("Could not copy — copy the link manually."),
    );
  }

  const [msgDraft, setMsgDraft] = useState("");
  const [msgPref, setMsgPref] = useState("");
  const [msgBusy, setMsgBusy] = useState(false);

  async function saveMessage() {
    if (msgDraft.trim().length < 10) {
      setErr("Write a short message first (at least 10 characters).");
      return;
    }
    setMsgBusy(true);
    const ok = await setRecoveryMessage(id, msgDraft.trim(), msgPref.trim() || undefined);
    setMsgBusy(false);
    if (ok) {
      setErr("");
      flash("Recovery message saved — a finder will see it on the public link.");
      load();
    } else setErr("Could not save the message — is the server online?");
  }

  const movementKm = useMemo(() => {
    const ordered = [...fixes].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let total = 0;
    for (let i = 1; i < ordered.length; i++) total += haversineKm(ordered[i - 1], ordered[i]);
    return total;
  }, [fixes]);

  if (loading) {
    return (
      <div className="animate-fade-up">
        <SectionTitle eyebrow="Recovery operations" title="Recovery Command Center" />
        <Card className="p-10 text-center text-sm text-ink-muted">Loading recovery case…</Card>
      </div>
    );
  }

  if (!device || !kase) {
    return (
      <div className="animate-fade-up">
        <SectionTitle eyebrow="Recovery operations" title="Recovery Command Center" />
        <Card className="p-10 text-center text-sm text-ink-muted">
          Device not found. It may have been unlinked from this server.
        </Card>
      </div>
    );
  }

  const fix = device.lastFix;
  const isPhone = device.type === "phone";
  const state = kase.lifecycleState;
  const stateIdx = Math.max(0, LIFECYCLE.indexOf(state as (typeof LIFECYCLE)[number]));
  const inRecovery = kase.caseStatus === "ACTIVE RECOVERY";
  const conf = kase.confidence;

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div
        className={`mb-6 overflow-hidden rounded-2xl border p-6 shadow-card ${
          inRecovery
            ? "border-red-200 bg-gradient-to-r from-red-600 to-rose-600 text-white"
            : state === "recovered"
              ? "border-emerald-200 bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
              : "border-slate-200 bg-white"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
                inRecovery ? "bg-white/15" : state === "recovered" ? "bg-white/15" : "bg-primary/10 text-primary"
              }`}
            >
              {inRecovery ? (
                <AlertTriangleIcon className="h-6 w-6" />
              ) : state === "recovered" ? (
                <CheckCircleIcon className="h-6 w-6" />
              ) : (
                <ShieldIcon />
              )}
            </span>
            <div>
              <p className={`text-xs font-bold uppercase tracking-widest ${inRecovery || state === "recovered" ? "text-white/80" : "text-ink-muted"}`}>
                {kase.caseStatus === "CLOSED"
                  ? "Closed case — transferred"
                  : kase.caseStatus === "RECOVERED"
                    ? "Recovered"
                    : inRecovery
                      ? "Active recovery"
                      : "Recovery case"}
              </p>
              <h1 className={`mt-0.5 text-xl font-bold tracking-tight ${inRecovery || state === "recovered" ? "text-white" : "text-ink"}`}>
                {device.hostname ?? "Unknown device"}
              </h1>
              <p className={`mt-0.5 font-mono text-[11px] ${inRecovery || state === "recovered" ? "text-white/80" : "text-ink-faint"}`}>
                {isPhone ? `IMEI ${device.imei ?? "—"}` : `Serial ${device.serialNumber ?? "—"}`}
                {isPhone && device.operator ? ` · SIM ${device.operator}` : ""} · case {kase.caseId.slice(0, 8)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {inRecovery ? (
              <>
                <button className="btn-secondary !border-white/30 !bg-white/10 !text-white hover:!bg-white/20" onClick={markFound} disabled={busy}>
                  Mark found
                </button>
                <button className="btn-secondary !border-white/30 !bg-white/10 !text-white hover:!bg-white/20" onClick={verifyRecovered} disabled={busy}>
                  Verify &amp; recover
                </button>
                <button className="btn-ghost !border-white/30 !bg-transparent !text-white/80 hover:!bg-white/10" onClick={transferOwnership} disabled={busy}>
                  Transfer ownership
                </button>
              </>
            ) : (
              <>
                <Link href="/dashboard/agents" className="btn-secondary !py-2 text-xs">
                  Go to Agents
                </Link>
                <button className="btn-ghost !py-2 text-xs" onClick={locateNow} disabled={busy}>
                  <RefreshIcon className="h-3.5 w-3.5" /> Refresh
                </button>
              </>
            )}
          </div>
        </div>

        {/* Lifecycle stepper */}
        <ol className={`mt-5 flex flex-wrap items-center gap-1.5 ${inRecovery || state === "recovered" ? "text-white/85" : ""}`}>
          {LIFECYCLE.map((step, i) => {
            const done = i < stateIdx;
            const active = i === stateIdx;
            return (
              <li key={step} className="flex items-center gap-1.5">
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    active
                      ? inRecovery || state === "recovered"
                        ? "bg-white text-red-700"
                        : "bg-primary text-white"
                      : done
                        ? inRecovery || state === "recovered"
                          ? "bg-white/20 text-white"
                          : "bg-primary/10 text-primary"
                        : inRecovery || state === "recovered"
                          ? "bg-white/10 text-white/70"
                          : "bg-slate-100 text-ink-faint"
                  }`}
                >
                  {done ? <CheckCircleIcon className="h-3 w-3" /> : null}
                  {LIFECYCLE_LABEL[step]}
                </span>
                {i < LIFECYCLE.length - 1 ? <span className="text-[10px] opacity-50">→</span> : null}
              </li>
            );
          })}
        </ol>
      </div>

      {err ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">{err}</div>
      ) : null}
      {toast ? (
        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">{toast}</div>
      ) : null}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-muted">Recovery confidence</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink">{conf.score}%</p>
              <p className="mt-1 text-xs text-ink-faint">estimate · not a probability</p>
            </div>
            <span className={`chip ring-1 ring-inset ${LEVEL_STYLE[conf.level]}`}>{conf.level}</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-muted">Last known location</p>
              <p className="mt-1.5 truncate text-2xl font-bold tracking-tight text-ink">
                {fix ? `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}°` : "—"}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                {fix ? `${SOURCE_LABEL[fix.source] ?? fix.source} · ±${fix.accuracy ?? "?"}m · ${timeAgo(fix.timestamp)}` : "No fix recorded"}
              </p>
            </div>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <MapPinIcon className="h-5 w-5" />
            </span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-muted">Community detections</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink">{kase.community.sightingCount}</p>
              <p className="mt-1 text-xs text-ink-faint">
                {kase.community.latestSighting
                  ? `Last seen ${timeAgo(kase.community.latestSighting.at)} by a nearby device`
                  : "None yet — keep the beacon on"}
              </p>
            </div>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
              <WifiIcon className="h-5 w-5" />
            </span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-muted">Movement</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink">
                {movementKm > 0 ? (movementKm < 1 ? `${Math.round(movementKm * 1000)} m` : `${movementKm.toFixed(1)} km`) : "—"}
              </p>
              <p className="mt-1 text-xs text-ink-faint">{kase.signal.fixCount} location fixes on record</p>
            </div>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
              <CrosshairIcon className="h-5 w-5" />
            </span>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Left: state + confidence + timeline */}
        <div className="flex flex-col gap-6 lg:col-span-3">
          {/* Current recovery state */}
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Current recovery state</h3>
            <dl className="grid gap-x-6 gap-y-2.5 text-xs sm:grid-cols-2">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-ink-faint">Status</dt>
                <dd className={`chip ring-1 ring-inset ${inRecovery ? "bg-red-50 text-red-700 ring-red-600/20" : state === "recovered" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}`}>
                  {LIFECYCLE_LABEL[state]} · {kase.caseStatus}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-ink-faint">Last seen</dt>
                <dd className="font-mono text-ink">{timeAgo(kase.signal.lastSeenAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-ink-faint">Network</dt>
                <dd className="flex items-center gap-1.5 font-medium text-ink">
                  <span className={`h-2 w-2 rounded-full ${kase.signal.online ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {kase.signal.online ? "Online (recent signal)" : "Offline"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-ink-faint">SIM status</dt>
                <dd className={`font-medium ${kase.report.simChanged ? "text-red-700" : "text-ink"}`}>
                  {device.operator ?? "—"}
                  {kase.report.simChanged ? " · changed!" : ""}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-ink-faint">Reconnect</dt>
                <dd className="font-medium text-ink">
                  {kase.signal.reconnectedAt ? `reconnected ${timeAgo(kase.signal.reconnectedAt)}` : "no reconnect event"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <dt className="text-ink-faint">Most recent sighting</dt>
                <dd className="font-medium text-ink">
                  {kase.community.latestSighting
                    ? `${timeAgo(kase.community.latestSighting.at)} · ${kase.community.latestSighting.lat.toFixed(4)}°, ${kase.community.latestSighting.lng.toFixed(4)}°`
                    : "none"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-faint">Evidence</dt>
                <dd className="font-medium text-ink">{kase.evidenceCount} capture{kase.evidenceCount === 1 ? "" : "s"} on record</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink-faint">Finder messages</dt>
                <dd className="font-medium text-ink">{kase.finderMessages} message{kase.finderMessages === 1 ? "" : "s"} · {kase.commandCount} command{kase.commandCount === 1 ? "" : "s"}</dd>
              </div>
            </dl>
          </Card>

          {/* Recovery confidence — explainable */}
          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Recovery confidence</h3>
              <span className="font-mono text-[11px] text-ink-faint">estimate</span>
            </div>
            <p className="mb-3 text-xs text-ink-muted">
              Based on freshness and strength of available signals — not a probability of recovery.
            </p>
            <ProgressBar value={conf.score} />
            <p className="mt-2 text-xs text-ink-muted">
              Score <strong className="text-ink">{conf.score}/100</strong> · {LIFECYCLE_LABEL[state]} case
            </p>
            {conf.factors.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {conf.factors.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                    <span className="flex items-center gap-2 text-ink">
                      {f.impact === "positive" ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      )}
                      {f.name}
                    </span>
                    <span className={`font-mono ${f.impact === "positive" ? "text-emerald-700" : "text-amber-700"}`}>{f.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-ink-muted">
                No signals on record yet — confidence will rise as fixes, sightings or evidence arrive.
              </p>
            )}
          </Card>

          {/* Timeline — Scale Core: newest page first, older history appended */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Recovery timeline</h3>
              <span className="font-mono text-[11px] text-ink-faint">
                {timeline.length} loaded{historyEnded && timeline.length > 0 ? " · complete" : ""}
              </span>
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm text-ink-muted">No timeline events yet — fixes and sightings will appear here.</p>
            ) : (
              <ol className="relative space-y-4 pl-1">
                {timeline.map((t, i) => (
                  <li key={`${t.type}-${t.at}-${i}`} className="relative flex gap-3">
                    {i < timeline.length - 1 ? (
                      <span className="absolute left-[11px] top-7 h-[calc(100%-8px)] w-px bg-slate-200" />
                    ) : null}
                    <span className={`mt-1 h-[9px] w-[9px] shrink-0 rounded-full ${kindDot(t.type)}`} />
                    <div className="min-w-0 flex-1 pb-0.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">{t.title}</p>
                        <span className="font-mono text-[11px] text-ink-faint">
                          {new Date(t.at).toLocaleString("en-NG", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {t.detail && (t.detail.lat != null || t.type === "sim_change") ? (
                        <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                          {t.detail.lat != null
                            ? `${Number(t.detail.lat).toFixed(4)}°, ${Number(t.detail.lng).toFixed(4)}°${t.detail.source ? ` · ${SOURCE_LABEL[String(t.detail.source)] ?? t.detail.source}` : ""}`
                            : JSON.stringify(t.detail).slice(0, 120)}
                        </p>
                      ) : null}
                      <span className={`chip mt-1.5 !px-2 !py-0.5 text-[10px] ${kindChip(t.type)}`}>{kindLabel(t.type)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                className="btn-ghost"
                onClick={loadOlder}
                disabled={historyLoading || historyEnded}
              >
                {historyLoading ? (
                  <RefreshIcon className="h-4 w-4 animate-spin" />
                ) : historyEnded ? (
                  <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
                ) : (
                  <RefreshIcon className="h-4 w-4" />
                )}
                {historyEnded ? "You've reached the beginning" : "Load older history"}
              </button>
              {historyError ? <p className="text-xs text-amber-700">{historyError}</p> : null}
            </div>
          </Card>

          {/* Honest limits */}
          <Card className="border-amber-200 p-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">Honest limits — when Dravex cannot give a live signal</h3>
            <ul className="space-y-2 text-xs text-ink-muted">
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                A <strong className="text-ink">powered-off</strong> phone sends nothing — only Apple Find My / Google Find Hub (supported hardware) do powered-off finding. Dravex covers everything while the device has power and any signal.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <strong className="text-ink">Battery removed</strong> or a <strong className="text-ink">Faraday bag</strong> (radio-blocking enclosure) makes the device invisible to all software.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                After a <strong className="text-ink">factory reset (flashing)</strong> the app is gone. The device is still traceable by IMEI the moment a new SIM is inserted (carrier + police route), and Android FRP / Apple Activation Lock block silent reuse.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <strong className="text-ink">iOS background tracking is not possible</strong> — the iOS companion steers you to Apple Find My instead.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                Stale data is never shown as live: “last seen” is always the true last signal time.
              </li>
            </ul>
          </Card>
        </div>

        {/* Right: map + actions + finder */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <RecoveryMap
              fixes={fixes}
              sightings={sightings}
              lastFix={fix}
              label={device.hostname ?? "Recovery map"}
            />
            <div className="border-t border-slate-100 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Last known position</p>
                <span className="chip bg-primary/10 text-primary">{fix ? `±${fix.accuracy ?? "?"}m` : "no fix"}</span>
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-ink-muted">
                {fix ? `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}°` : "—"}
                {fix?.ipAddress ? ` · ${fix.ipAddress}` : ""}
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">
                Schematic map of real stored coordinates — accuracy circles are drawn to scale where available.
              </p>
            </div>
          </Card>

          {/* Recovery actions */}
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Recovery actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost !px-3 !py-2 text-xs" onClick={locateNow} disabled={busy}>
                <RefreshIcon className="h-4 w-4 text-accent" /> Locate now
              </button>
              <button className="btn-ghost !px-3 !py-2 text-xs" onClick={() => command("webcam", "Webcam capture")}>
                <EyeIcon className="h-4 w-4 text-accent" /> Webcam
              </button>
              <button className="btn-ghost !px-3 !py-2 text-xs" onClick={() => command("alarm", "Alarm")}>
                <AlarmIcon className="h-4 w-4 text-accent" /> Alarm
              </button>
              <button className="btn-ghost !px-3 !py-2 text-xs" onClick={() => command("lock", "Lock")}>
                <LockClosedIcon className="h-4 w-4 text-primary" /> Lock
              </button>
            </div>
            {inRecovery ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-ghost !px-3 !py-2 text-xs" onClick={markFound} disabled={busy}>
                  Mark found
                </button>
                <button className="btn-secondary !px-3 !py-2 text-xs" onClick={verifyRecovered} disabled={busy}>
                  Verify &amp; recover
                </button>
              </div>
            ) : null}
            <div className="mt-3 border-t border-slate-100 pt-3">
              <button className="btn-ghost w-full !px-3 !py-2 text-xs" onClick={exportEvidencePack}>
                <DocumentTextIcon className="h-4 w-4 text-accent" /> Export Recovery Evidence Pack (JSON)
              </button>
              <button className="btn-ghost w-full !px-3 !py-2 text-xs" onClick={transferOwnership} disabled={busy}>
                <DeviceMobileIcon className="h-4 w-4 text-ink-faint" /> Transfer ownership (resale)
              </button>
            </div>
            <p className="mt-3 text-[11px] text-ink-faint">
              Destructive actions (verify, transfer) ask for confirmation before running.
            </p>
          </Card>

          {/* Share recovery link (P4 finder experience) */}
          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold text-ink">Share this recovery link</h3>
            <p className="mb-3 text-xs text-ink-muted">
              Anyone who finds the device can open this link, see it's reported lost, and message you anonymously — no identities exposed.
            </p>
            <button className="btn-secondary w-full !py-2 text-xs" onClick={copyRecoveryLink}>
              <LinkIcon className="h-4 w-4" />
              {copied ? "Copied — send it to anyone who finds it" : "Copy public recovery link"}
            </button>
          </Card>

          {/* Recovery message + finder inbox */}
          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold text-ink">Message to whoever finds it</h3>
            <p className="mb-3 text-xs text-ink-muted">
              Set one short message shown on the public recovery link — a good samaritan can reply without ever seeing your identity.
            </p>
            <textarea
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              rows={3}
              maxLength={280}
              placeholder="e.g. This is my phone — reward offered. Please message me through Dravex."
              value={msgDraft}
              onChange={(e) => setMsgDraft(e.target.value)}
            />
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              maxLength={120}
              placeholder="Contact preference (optional) — e.g. police station drop-off, reward"
              value={msgPref}
              onChange={(e) => setMsgPref(e.target.value)}
            />
            <button className="btn-primary mt-3 w-full !py-2 text-xs" onClick={saveMessage} disabled={msgBusy}>
              {msgBusy ? "Saving…" : "Save message"}
            </button>
            {device.recoveryMessage ? (
              <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">
                <p className="font-semibold">Live message</p>
                <p className="mt-1">“{device.recoveryMessage.message}”</p>
                {device.recoveryMessage.contactPreference ? (
                  <p className="mt-1 text-emerald-700">{device.recoveryMessage.contactPreference}</p>
                ) : null}
              </div>
            ) : null}

            {(device.contactMessages ?? []).length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold text-ink">Finder messages — {device.contactMessages!.length}</p>
                <ul className="space-y-2">
                  {device.contactMessages!.map((m) => (
                    <li key={m.id} className="rounded-xl bg-slate-50 p-3 text-xs">
                      <p className="text-ink">{m.message}</p>
                      <p className="mt-1 font-mono text-[10px] text-ink-faint">{timeAgo(m.at)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {/* Next steps */}
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Next steps</h3>
            <ul className="space-y-2 text-xs text-ink-muted">
              <li className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Report the IMEI/serial to the NPF Cybercrime portal or your nearest police station — keep the box with the IMEI sticker.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Buyers check this registry — anyone who scans the IMEI before paying will see it's stolen.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Keep the beacon on. The moment another Dravex device hears it, you get a sighting here with a position.
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/dashboard/offline-recovery" className="btn-secondary !px-3 !py-2 text-xs">
                Offline recovery kit
              </Link>
              <Link href="/dashboard/track" className="btn-ghost !px-3 !py-2 text-xs">
                Live tracking
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---- timeline kind styling ---- */

function kindDot(type: string): string {
  switch (type) {
    case "lost":
    case "stolen":
    case "sim_change":
      return "bg-red-500";
    case "found":
    case "recovered":
      return "bg-emerald-500";
    case "reconnected":
    case "fix":
      return "bg-sky-500";
    case "sighting":
      return "bg-violet-500";
    case "command":
    case "command_ack":
      return "bg-amber-500";
    case "evidence":
      return "bg-accent";
    case "finder_message":
      return "bg-primary";
    default:
      return "bg-slate-400";
  }
}

function kindChip(type: string): string {
  switch (type) {
    case "lost":
    case "stolen":
      return "bg-red-50 text-red-700";
    case "sim_change":
      return "bg-red-50 text-red-700";
    case "found":
    case "recovered":
      return "bg-emerald-50 text-emerald-700";
    case "reconnected":
      return "bg-sky-50 text-sky-700";
    case "fix":
      return "bg-primary/10 text-primary";
    case "sighting":
      return "bg-violet-50 text-violet-700";
    case "command":
    case "command_ack":
      return "bg-amber-50 text-amber-700";
    case "evidence":
      return "bg-accent/10 text-accent";
    case "finder_message":
      return "bg-primary/10 text-primary";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function kindLabel(type: string): string {
  switch (type) {
    case "lost":
      return "Reported";
    case "stolen":
      return "Stolen";
    case "found":
      return "Resolved";
    case "recovered":
      return "Recovered";
    case "reconnected":
      return "Online";
    case "fix":
      return "Fix";
    case "sighting":
      return "Sighting";
    case "sim_change":
      return "SIM";
    case "command":
      return "Command";
    case "command_ack":
      return "Executed";
    case "evidence":
      return "Evidence";
    case "finder_message":
      return "Message";
    default:
      return type.replace(/_/g, " ");
  }
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
