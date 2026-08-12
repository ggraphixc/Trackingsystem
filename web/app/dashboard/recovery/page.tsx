"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listDevices } from "@/lib/api";
import type { PairedDevice } from "@/lib/api";
import { AlertTriangleIcon, ChevronRightIcon, DeviceMobileIcon, MapPinIcon } from "@/components/icons";
import { Card, EmptyState, SectionTitle } from "@/components/ui";

export default function RecoveryPage() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listDevices().then((list) => {
      if (!alive) return;
      setDevices(list);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const lost = devices.filter((d) => d.lost);

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Recovery operations"
        title="Recovery Mode"
        action={
          <span className="chip bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
            {lost.length} active {lost.length === 1 ? "incident" : "incidents"}
          </span>
        }
      />

      {loading ? (
        <Card className="p-10 text-center text-sm text-ink-muted">Loading recovery incidents…</Card>
      ) : lost.length === 0 ? (
        <EmptyState
          icon={<AlertTriangleIcon className="h-7 w-7" />}
          title="No active recovery incidents"
          body="When you mark a device lost from My Devices or Agents, it appears here with its live recovery timeline, community sightings and confidence score."
          action={
            <Link href="/dashboard/agents" className="btn-primary">
              Go to Agents
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {lost.map((d) => {
            const fix = d.lastFix;
            const lastSeenMs = d.lastSeenAt ? Date.now() - new Date(d.lastSeenAt).getTime() : Infinity;
            const offlineH = Math.round(lastSeenMs / 3.6e6);
            const isPhone = d.type === "phone";
            return (
              <Link key={d.deviceId} href={`/dashboard/recovery/${d.deviceId}`}>
                <Card hover className="p-5 ring-1 ring-inset ring-red-400/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{d.hostname ?? "Unknown device"}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                        {isPhone ? `IMEI ${d.imei ?? "—"}` : `Serial ${d.serialNumber ?? "—"}`}
                      </p>
                    </div>
                    <span className="chip shrink-0 bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
                      ● STOLEN
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-50 p-2.5">
                      <p className="text-[11px] text-ink-faint">Last seen</p>
                      <p className="mt-0.5 text-sm font-semibold text-ink">
                        {offlineH < 24 ? `${offlineH}h` : `${Math.round(offlineH / 24)}d`} ago
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2.5">
                      <p className="text-[11px] text-ink-faint">Sightings</p>
                      <p className="mt-0.5 text-sm font-semibold text-ink">{d.sightingCount ?? 0}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2.5">
                      <p className="text-[11px] text-ink-faint">SIM</p>
                      <p className="mt-0.5 truncate text-sm font-semibold text-ink">
                        {d.operator ?? "—"}
                      </p>
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
          })}
        </div>
      )}

      <Card className="mt-6 flex items-start gap-3 p-5 text-sm text-ink-muted">
        <DeviceMobileIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
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
