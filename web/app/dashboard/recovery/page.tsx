"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getRecoveryCase, listDevices } from "@/lib/api";
import type { PairedDevice, RecoveryCase } from "@/lib/api";
import { AlertTriangleIcon, ChevronRightIcon, CheckCircleIcon, CrosshairIcon, MapPinIcon, WifiIcon } from "@/components/icons";
import { Card, EmptyState, SectionTitle } from "@/components/ui";

const STATE_CHIP: Record<string, string> = {
  protected: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  lost: "bg-amber-50 text-amber-700 ring-amber-600/20",
  stolen: "bg-red-50 text-red-700 ring-red-600/20",
  detected: "bg-sky-50 text-sky-700 ring-sky-600/20",
  sighted: "bg-violet-50 text-violet-700 ring-violet-600/20",
  verified: "bg-primary/10 text-primary ring-primary/20",
  recovered: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function CaseCard({ d, kase }: { d: PairedDevice; kase?: RecoveryCase | null }) {
  const fix = d.lastFix;
  const isPhone = d.type === "phone";
  const state = kase?.lifecycleState ?? (d.lost ? "lost" : "protected");
  const conf = kase?.confidence;
  return (
    <Link href={`/dashboard/recovery/${d.deviceId}`}>
      <Card hover className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{d.hostname ?? "Unknown device"}</p>
            <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
              {isPhone ? `IMEI ${d.imei ?? "—"}` : `Serial ${d.serialNumber ?? "—"}`}
            </p>
          </div>
          <span className={`chip shrink-0 ring-1 ring-inset ${STATE_CHIP[state] ?? "bg-slate-100 text-slate-600 ring-slate-500/20"}`}>
            {state.toUpperCase()}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[11px] text-ink-faint">Last seen</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{timeAgo(d.lastSeenAt)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[11px] text-ink-faint">Sightings</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{d.sightingCount ?? 0}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[11px] text-ink-faint">Confidence</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{conf ? `${conf.score}%` : "—"}</p>
          </div>
        </div>
        {fix ? (
          <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
            <MapPinIcon className="h-3.5 w-3.5 text-accent" />
            {fix.lat.toFixed(4)}°, {fix.lng.toFixed(4)}° · ±{fix.accuracy}m
          </p>
        ) : null}
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
          Open recovery view <ChevronRightIcon className="h-3.5 w-3.5" />
        </span>
      </Card>
    </Link>
  );
}

function Section({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <span className="chip bg-slate-100 text-slate-600">{count}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </div>
  );
}

export default function RecoveryPage() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [cases, setCases] = useState<Record<string, RecoveryCase | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await listDevices();
      if (!alive) return;
      setDevices(list);
      const map: Record<string, RecoveryCase | null> = {};
      await Promise.all(
        list.map(async (d) => {
          map[d.deviceId] = await getRecoveryCase(d.deviceId);
        }),
      );
      if (alive) {
        setCases(map);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const withCase = devices
    .map((d) => ({ d, kase: cases[d.deviceId] ?? null }))
    .sort((a, b) => new Date(b.d.lastSeenAt ?? 0).getTime() - new Date(a.d.lastSeenAt ?? 0).getTime());

  const active = withCase.filter((x) => x.d.lost);
  const recovered = withCase.filter((x) => !x.d.lost && (x.d.verifiedAt || x.kase?.lifecycleState === "recovered"));
  const sighted = active.filter((x) => (x.d.sightingCount ?? 0) > 0);
  const unresolved = active.filter((x) => (x.d.sightingCount ?? 0) === 0 && !x.d.lastFix);

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Recovery operations"
        title="Recovery Command Center"
        action={
          <span className="chip bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
            {active.length} active {active.length === 1 ? "case" : "cases"}
          </span>
        }
      />

      {loading ? (
        <Card className="p-10 text-center text-sm text-ink-muted">Loading recovery cases…</Card>
      ) : withCase.length === 0 ? (
        <EmptyState
          icon={<AlertTriangleIcon className="h-7 w-7" />}
          title="No recovery cases yet"
          body="Mark a device lost from My Devices or Agents and it appears here with its live timeline, community sightings and confidence score."
          action={
            <Link href="/dashboard/agents" className="btn-primary">
              Go to Agents
            </Link>
          }
        />
      ) : (
        <>
          <Section title="Active recovery" icon={<CrosshairIcon className="h-5 w-5 text-accent" />} count={active.length}>
            {active.map(({ d, kase }) => (
              <CaseCard key={d.deviceId} d={d} kase={kase} />
            ))}
          </Section>

          <Section title="Recently recovered" icon={<CheckCircleIcon className="h-5 w-5 text-emerald-600" />} count={recovered.length}>
            {recovered.map(({ d, kase }) => (
              <CaseCard key={d.deviceId} d={d} kase={kase} />
            ))}
          </Section>

          <Section title="Recent community sightings" icon={<WifiIcon className="h-5 w-5 text-violet-600" />} count={sighted.length}>
            {sighted.map(({ d, kase }) => (
              <CaseCard key={d.deviceId} d={d} kase={kase} />
            ))}
          </Section>

          <Section title="Unresolved — no signal yet" icon={<AlertTriangleIcon className="h-5 w-5 text-amber-600" />} count={unresolved.length}>
            {unresolved.map(({ d, kase }) => (
              <CaseCard key={d.deviceId} d={d} kase={kase} />
            ))}
          </Section>
        </>
      )}

      <Card className="mt-8 flex items-start gap-3 p-5 text-sm text-ink-muted">
        <MapPinIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <p>
          <span className="font-semibold text-ink">Honest limits:</span> no software can track a
          powered-off phone. Dravex works while a device has any power and signal (Wi-Fi, cellular,
          or the community BLE beacon), and it gives police + carriers the IMEI/serial and evidence
          to trace a flashed phone the moment a new SIM is inserted.
        </p>
      </Card>
    </div>
  );
}
