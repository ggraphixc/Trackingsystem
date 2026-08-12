"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDevice, getFixes, getSightings, setDeviceLost } from "@/lib/api";
import type { PairedDevice, LocationFix, CommunitySighting } from "@/lib/api";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  MapPinIcon,
  PhoneIcon,
  RefreshIcon,
  SignalIcon,
  WifiIcon,
} from "@/components/icons";
import { Card, MapPreview, ProgressBar, SectionTitle, StatCard } from "@/components/ui";

const MNC: Record<string, string> = {
  "01": "MTEL",
  "20": "MTN",
  "25": "Visafone",
  "30": "Airtel",
  "50": "Glo",
  "60": "9mobile",
  "99": "Smile",
};

const SOURCE_LABEL: Record<string, string> = {
  wifi: "Wi-Fi positioning",
  ip: "IP geolocation",
  gps: "GPS",
  last_known: "Last known",
};

function decodeSim(fp?: string): string {
  if (!fp) return "no SIM";
  const mccmnc = String(fp).split("|")[0].trim();
  const m = mccmnc.match(/^(\d{3})(\d+)$/);
  if (!m) return mccmnc || "no SIM";
  return MNC[m[2]] ?? (m[1] === "621" ? `MNC ${m[2]}` : mccmnc);
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

type TimelineEntry = {
  at: string;
  kind: "lost" | "found" | "reconnected" | "sim_change" | "sighting" | "fix" | "offline";
  title: string;
  sub?: string;
};

export default function RecoveryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [device, setDevice] = useState<PairedDevice | null>(null);
  const [fixes, setFixes] = useState<LocationFix[]>([]);
  const [sightings, setSightings] = useState<CommunitySighting[]>([]);
  const [loading, setLoading] = useState(true);
  const [notLost, setNotLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    const [dev, fx, sg] = await Promise.all([getDevice(id), getFixes(id, 50), getSightings(id)]);
    setDevice(dev);
    setFixes(fx);
    setSightings(sg);
    setNotLost(!!dev && !dev.lost);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function markFound() {
    if (
      !window.confirm(
        "Mark this device as found? The community beacon stops, and its stolen-registry listing is resolved.",
      )
    )
      return;
    setBusy(true);
    const res = await setDeviceLost(id, false);
    setBusy(false);
    if (res?.ok) {
      window.location.reload();
    } else {
      setErr("Could not reach the server — is it online?");
    }
  }

  const confidence = useMemo(() => {
    if (!device) return 0;
    let score = 30;
    const lastFix = device.lastFix?.timestamp;
    if (lastFix) {
      const h = (Date.now() - new Date(lastFix).getTime()) / 3.6e6;
      if (h < 1) score += 30;
      else if (h < 12) score += 20;
      else if (h < 48) score += 10;
      else score += 5;
    }
    const lastSighting = sightings[0]?.at;
    if (lastSighting) {
      const h = (Date.now() - new Date(lastSighting).getTime()) / 3.6e6;
      if (h < 6) score += 25;
      else if (h < 24) score += 15;
      else if (h < 72) score += 8;
    }
    if ((device.evidenceCount ?? 0) > 0) score += 10;
    return Math.max(5, Math.min(98, score));
  }, [device, sightings]);

  const movementKm = useMemo(() => {
    const ordered = [...fixes].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let total = 0;
    for (let i = 1; i < ordered.length; i++) {
      total += haversineKm(ordered[i - 1], ordered[i]);
    }
    return total;
  }, [fixes]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];
    for (const e of device?.events ?? []) {
      const at = e.at;
      if (e.type === "lost") {
        entries.push({
          at,
          kind: "lost",
          title: "Reported lost",
          sub: e.detail?.recoveryCode ? "Ownership-verification code armed · community beacon ON" : "Community beacon armed",
        });
      } else if (e.type === "found") {
        entries.push({ at, kind: "found", title: "Marked found", sub: "Beacon disarmed" });
      } else if (e.type === "reconnected") {
        entries.push({
          at,
          kind: "reconnected",
          title: "Back online",
          sub: `Surfaced after ${e.detail?.gapHours ?? "?"}h offline — reconnected signal received`,
        });
      } else if (e.type === "sim_change") {
        entries.push({
          at,
          kind: "sim_change",
          title: "SIM card changed",
          sub: `${decodeSim(String(e.detail?.from ?? ""))} → ${decodeSim(String(e.detail?.to ?? ""))}`,
        });
      }
    }
    // Location fixes (ascending to detect offline gaps, then reversed for display).
    const ordered = [...fixes].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    ordered.forEach((f, i) => {
      if (i > 0) {
        const gapH = (new Date(f.timestamp).getTime() - new Date(ordered[i - 1].timestamp).getTime()) / 3.6e6;
        if (gapH > 12) {
          entries.push({
            at: f.timestamp,
            kind: "offline",
            title: "Went offline",
            sub: `No signal for ${Math.round(gapH)}h — data off or powered down`,
          });
        }
      }
      entries.push({
        at: f.timestamp,
        kind: "fix",
        title: "Location fix",
        sub: `${SOURCE_LABEL[f.source] ?? f.source} · ±${f.accuracy ?? "?"}m${f.confidence != null ? ` · ${f.confidence}% conf` : ""}`,
      });
    });
    // Community sightings are already newest-first from the server.
    for (const s of sightings) {
      entries.push({
        at: s.at,
        kind: "sighting",
        title: "Seen by the community",
        sub: `${s.lat.toFixed(4)}°, ${s.lng.toFixed(4)}° — a nearby Dravex device heard its beacon`,
      });
    }
    return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [device, fixes, sightings]);

  const kindStyle: Record<TimelineEntry["kind"], { dot: string; chip: string; label: string }> = {
    lost: { dot: "bg-red-500", chip: "bg-red-50 text-red-700", label: "Reported" },
    found: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", label: "Resolved" },
    reconnected: { dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700", label: "Online" },
    sim_change: { dot: "bg-red-500", chip: "bg-red-50 text-red-700", label: "SIM" },
    sighting: { dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700", label: "Sighting" },
    fix: { dot: "bg-primary", chip: "bg-primary/10 text-primary", label: "Fix" },
    offline: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600", label: "Offline" },
  };

  if (loading) {
    return (
      <div className="animate-fade-up">
        <SectionTitle eyebrow="Recovery operations" title="Recovery Mode" />
        <Card className="p-10 text-center text-sm text-ink-muted">Loading recovery view…</Card>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="animate-fade-up">
        <SectionTitle eyebrow="Recovery operations" title="Recovery Mode" />
        <Card className="p-10 text-center text-sm text-ink-muted">
          Device not found. It may have been unlinked from this server.
        </Card>
      </div>
    );
  }

  if (notLost) {
    return (
      <div className="animate-fade-up">
        <SectionTitle eyebrow="Recovery operations" title="Recovery Mode" />
        <Card className="p-10 text-center text-sm text-ink-muted">
          <p className="text-base font-semibold text-ink">{device.hostname ?? "This device"} is not in recovery mode.</p>
          <p className="mt-1">
            Mark it lost to arm the community beacon and open this recovery view. When you do, it is also listed in the
            public stolen-device registry (IMEI/serial check).
          </p>
          <Link href="/dashboard/agents" className="btn-primary mt-5 inline-flex">
            Go to Agents
          </Link>
        </Card>
      </div>
    );
  }

  const fix = device.lastFix;
  const isPhone = device.type === "phone";
  const simChanged = (device.events ?? []).some((e) => e.type === "sim_change");

  return (
    <div className="animate-fade-up">
      {/* STOLEN banner */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-red-200 bg-gradient-to-r from-red-600 to-rose-600 p-6 text-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 backdrop-blur">
              <AlertTriangleIcon className="h-6 w-6" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-red-100">
                Stolen — recovery active
              </p>
              <h1 className="mt-0.5 text-xl font-bold tracking-tight">
                {device.hostname ?? "Unknown device"}
              </h1>
              <p className="mt-0.5 font-mono text-[11px] text-red-100/90">
                {isPhone ? `IMEI ${device.imei ?? "—"}` : `Serial ${device.serialNumber ?? "—"}`}
                {isPhone && device.operator ? ` · SIM ${device.operator}` : ""}
              </p>
            </div>
          </div>
          <button className="btn-secondary !border-white/30 !bg-white/10 !text-white hover:!bg-white/20" onClick={markFound} disabled={busy}>
            {busy ? "Updating…" : "Mark found"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-red-50/90">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {device.lost ? "Community beacon ON — nearby Dravex devices can hear it" : "Beacon off"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
            <MapPinIcon className="h-3.5 w-3.5" />
            {fix ? `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}°` : "No fix yet"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
            <PhoneIcon className="h-3.5 w-3.5" />
            Last online {timeAgo(device.lastSeenAt)}
          </span>
        </div>
      </div>

      {err ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
          {err}
        </div>
      ) : null}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Recovery confidence"
          value={`${confidence}%`}
          sub={confidence >= 70 ? "Strong signals — act now" : confidence >= 40 ? "Weak signals — check community" : "No fresh signals yet"}
          icon={<SignalIcon className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label="Last known location"
          value={fix ? `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}°` : "—"}
          sub={fix ? `${SOURCE_LABEL[fix.source] ?? fix.source} · ±${fix.accuracy ?? "?"}m · ${timeAgo(fix.timestamp)}` : "No fix recorded"}
          icon={<MapPinIcon className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard
          label="Movement"
          value={movementKm > 0 ? `${movementKm < 1 ? Math.round(movementKm * 1000) + " m" : movementKm.toFixed(1) + " km"}` : "—"}
          sub={`${fixes.length} location fix${fixes.length === 1 ? "" : "es"} on record`}
          icon={<CrosshairIcon className="h-5 w-5" />}
          tone="neutral"
        />
        <StatCard
          label="Community detections"
          value={`${sightings.length}`}
          sub={sightings[0] ? `Last seen ${timeAgo(sightings[0].at)} by a nearby device` : "None yet — keep the beacon on"}
          icon={<WifiIcon className="h-5 w-5" />}
          tone={sightings.length > 0 ? "success" : "neutral"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Timeline + confidence */}
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Recovery timeline</h3>
              <span className="font-mono text-[11px] text-ink-faint">{timeline.length} events</span>
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm text-ink-muted">No timeline events yet — fixes and sightings will appear here.</p>
            ) : (
              <ol className="relative space-y-4 pl-1">
                {timeline.map((t, i) => {
                  const s = kindStyle[t.kind];
                  return (
                    <li key={`${t.kind}-${t.at}-${i}`} className="relative flex gap-3">
                      {i < timeline.length - 1 ? (
                        <span className="absolute left-[11px] top-7 h-[calc(100%-8px)] w-px bg-slate-200" />
                      ) : null}
                      <span className={`mt-1 h-[9px] w-[9px] shrink-0 rounded-full ${s.dot}`} />
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
                        {t.sub ? <p className="mt-0.5 text-xs text-ink-muted">{t.sub}</p> : null}
                        <span className={`chip mt-1.5 !px-2 !py-0.5 text-[10px] ${s.chip}`}>{s.label}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="mb-4 text-sm font-semibold text-ink">How confident are we?</h3>
            <ProgressBar value={confidence} />
            <div className="mt-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
              <p className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary" /> Last fix: {fix ? timeAgo(fix.timestamp) : "never"}
              </p>
              <p className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-violet-500" /> Latest sighting: {sightings[0] ? timeAgo(sightings[0].at) : "none"}
              </p>
              <p className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Webcam evidence: {device.evidenceCount ?? 0} photo{(device.evidenceCount ?? 0) === 1 ? "" : "s"}
              </p>
              <p className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> SIM changed: {simChanged ? "yes — strong signal" : "no"}
              </p>
            </div>
          </Card>

          {/* Honest limits — power-off / factory reset */}
          <Card className="border-amber-200 p-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">Honest limits — what no app can do</h3>
            <ul className="space-y-2 text-xs text-ink-muted">
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                A <strong className="text-ink">powered-off</strong> phone sends nothing — only Apple Find My / Google Find Hub (supported hardware) do powered-off finding. Dravex covers everything while the device has power and any signal.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                After a <strong className="text-ink">factory reset (flashing)</strong>, the app is gone. The device is still traceable by the IMEI the moment a new SIM is inserted (carrier + police route), and Android FRP / Apple Activation Lock already block silent reuse.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                The IMEI survives everything. Take your phone box to the NPF or SCID, or use the NPF Cybercrime portal (nccc.npf.gov.ng) to open an IMEI trace.
              </li>
            </ul>
          </Card>
        </div>

        {/* Map + actions */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <MapPreview className="h-64 w-full rounded-none border-0" label={device.hostname ?? "Last known position"} />
            <div className="border-t border-slate-100 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Last known position</p>
                <span className="chip bg-primary/10 text-primary">
                  {fix ? `±${fix.accuracy ?? "?"}m` : "no fix"}
                </span>
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-ink-muted">
                {fix ? `${fix.lat.toFixed(4)}°, ${fix.lng.toFixed(4)}°` : "—"}
                {fix?.ipAddress ? ` · ${fix.ipAddress}` : ""}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-ink-faint">Network</p>
                  <p className="mt-0.5 flex items-center gap-1.5 font-semibold text-ink">
                    <WifiIcon className={`h-3.5 w-3.5 ${fix ? "text-emerald-500" : "text-amber-500"}`} />
                    {fix ? "Online (last fix)" : "Offline"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-ink-faint">SIM status</p>
                  <p className="mt-0.5 flex items-center gap-1.5 font-semibold text-ink">
                    <DeviceMobileIcon className={`h-3.5 w-3.5 ${simChanged ? "text-red-500" : "text-emerald-500"}`} />
                    {device.operator ?? "—"}
                    {simChanged ? " · changed!" : ""}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Next steps</h3>
            <ul className="space-y-2 text-xs text-ink-muted">
              <li className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Report the IMEI/serial to the NPF Cybercrime portal or your nearest police station — keep the box with the IMEI sticker.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                Buyers already check this registry — anyone who scans the IMEI before paying will see it's stolen.
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
              <button className="btn-ghost !px-3 !py-2 text-xs" onClick={() => load()}>
                <RefreshIcon className="h-3.5 w-3.5" /> Refresh
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
