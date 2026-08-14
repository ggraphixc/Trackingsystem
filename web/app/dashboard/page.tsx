"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocalStorage } from "@/lib/storage";
import { SEED_DEVICES, SEED_INCIDENTS } from "@/lib/data";
import { listDevices } from "@/lib/api";
import type { PairedDevice } from "@/lib/api";
import type { Device, Incident } from "@/lib/types";
import DeviceAlerts from "@/components/device-alerts";

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

import {
  ArrowRightIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  DocumentTextIcon,
  LeafIcon,
  MapPinIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import {
  Card,
  DeviceStatusBadge,
  IncidentStatusBadge,
  SectionTitle,
  StatCard,
} from "@/components/ui";

export default function OverviewPage() {
  const [devices] = useLocalStorage<Device[]>("devices", SEED_DEVICES);
  const [incidents] = useLocalStorage<Incident[]>("incidents", SEED_INCIDENTS);

  // Live agent data from the sync server — powers the reconnect/activity
  // alerts on the home screen. Silent when the server is unreachable.
  const [paired, setPaired] = useState<PairedDevice[]>([]);

  const loadAgents = useCallback(async () => {
    setPaired(await listDevices());
  }, []);

  useEffect(() => {
    loadAgents();
    const t = setInterval(loadAgents, 15000);
    return () => clearInterval(t);
  }, [loadAgents]);

  const protectedCount = devices.filter((d) => d.status === "protected").length;
  const lostCount = devices.filter((d) => d.status === "lost").length;
  const recoveredCount = devices.filter((d) => d.status === "recovered").length;
  const co2Saved = recoveredCount * 300; // ~300 kg CO₂e per laptop avoided

  const recent = [...incidents]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 3);

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Overview"
        title="Welcome back, Ada"
        action={
          <Link href="/dashboard/incidents/new" className="btn-primary">
            <DocumentTextIcon className="h-4 w-4" />
            Report lost phone
          </Link>
        }
      />

      {/* Reconnect banner + device activity (shared with the Agents page) */}
      <DeviceAlerts devices={paired} />

      {/* Active recovery cases — lost devices need eyes on them (P6) */}
      {paired.filter((d) => d.lost).length > 0 ? (
        <div className="mb-6">
          <Link
            href="/dashboard/recovery"
            className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm transition-colors duration-200 hover:border-red-300 hover:bg-red-100/70"
          >
            <span className="flex items-center gap-2.5 font-semibold text-red-700">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
              </span>
              {paired.filter((d) => d.lost).length} device{paired.filter((d) => d.lost).length === 1 ? "" : "s"} in
              recovery mode
            </span>
            <span className="font-medium text-red-700">Open recovery view →</span>
          </Link>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paired
              .filter((d) => d.lost)
              .slice(0, 6)
              .map((d) => (
                <Link key={d.deviceId} href={`/dashboard/recovery/${d.deviceId}`}>
                  <Card hover className="p-4 ring-1 ring-inset ring-red-400/40">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-semibold text-ink">{d.hostname ?? "Unknown device"}</p>
                      <span className="chip shrink-0 bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">LOST</span>
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-ink-faint">
                      {d.type === "phone" ? `IMEI ${d.imei ?? "—"}` : `Serial ${d.serialNumber ?? "—"}`}
                    </p>
                    <p className="mt-2 text-[11px] text-ink-muted">
                      {d.sightingCount ?? 0} sighting{(d.sightingCount ?? 0) === 1 ? "" : "s"} · last seen{" "}
                      {d.lastSeenAt
                        ? timeAgo(d.lastSeenAt)
                        : "never"}
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      Open recovery case →
                    </span>
                  </Card>
                </Link>
              ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Devices protected"
          value={String(protectedCount)}
          sub="In your vault"
          icon={<ShieldCheckIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Active incidents"
          value={String(lostCount)}
          sub="Being tracked"
          icon={<MapPinIcon className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard
          label="Devices recovered"
          value={String(recoveredCount)}
          sub="Back in your hands"
          icon={<DeviceMobileIcon className="h-5 w-5" />}
          tone="success"
        />
        <StatCard
          label="CO₂e saved"
          value={`${co2Saved} kg`}
          sub="By recovery, not replacement"
          icon={<LeafIcon className="h-5 w-5" />}
          tone="neutral"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Recent incidents */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-base font-semibold text-ink">Recent incidents</h2>
          <div className="flex flex-col gap-3">
            {recent.length === 0 ? (
              <Card className="p-6 text-sm text-ink-muted">No incidents yet — knock on wood.</Card>
            ) : (
              recent.map((inc) => (
                <Card key={inc.id} hover className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{inc.deviceLabel}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {inc.locationLost} · {new Date(inc.dateLost).toLocaleDateString("en-NG")}
                      </p>
                      {inc.policeRef ? (
                        <p className="mt-1 font-mono text-[11px] text-ink-faint">Ref: {inc.policeRef}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <IncidentStatusBadge status={inc.status} />
                      <Link
                        href="/dashboard/incidents"
                        className="text-xs font-medium text-primary hover:text-primary-dark"
                      >
                        View →
                      </Link>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>

        {/* Recovery ladder */}
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent">
                <CrosshairIcon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">Recovery ladder</h3>
                <p className="text-xs text-ink-muted">We work with whatever you know</p>
              </div>
            </div>
            <ul className="space-y-2.5 text-sm text-ink-muted">
              <li className="flex gap-2">
                <span className="mt-0.5 font-mono text-[11px] font-bold text-emerald-600">1</span>
                Agent installed + permissions → Wi-Fi/IP tracking engine
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 font-mono text-[11px] font-bold text-blue-600">2</span>
                Only the serial number → stolen registry + police report
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 font-mono text-[11px] font-bold text-amber-600">3</span>
                Laptop in lost mode → webcam capture + remote lock/alarm
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 font-mono text-[11px] font-bold text-slate-500">4</span>
                Only receipt / box → claim pack + second-life market
              </li>
            </ul>
          </Card>

          <Card className="bg-gradient-to-br from-primary to-primary-dark p-5 text-white">
            <h3 className="text-sm font-semibold">Did you know?</h3>
            <p className="mt-1.5 text-sm text-blue-100">
              Laptops are prime targets in Nigerian offices, schools and markets — and Windows and
              Linux have no built-in "Find My" equivalent. Every recovered laptop keeps ~300 kg of
              CO₂e out of the atmosphere.
            </p>
            <Link
              href="/dashboard/impact"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:text-blue-100"
            >
              See your impact <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </Card>
        </div>
      </div>

      {/* Your devices strip */}
      <h2 className="mb-3 mt-8 text-base font-semibold text-ink">Your devices</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {devices.map((d) => (
          <Card key={d.id} hover className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">
                  {d.brand} {d.model}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-faint">Serial {d.serialNumber}</p>
              </div>
              <DeviceStatusBadge status={d.status} />
            </div>
            <Link
              href="/dashboard/devices"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-dark"
            >
              Manage <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </Card>
        ))}
        <Link href="/dashboard/devices/new">
          <Card hover className="flex h-full min-h-[96px] items-center justify-center border-dashed p-4 text-sm font-medium text-ink-muted hover:text-primary">
            + Register a device
          </Card>
        </Link>
      </div>
    </div>
  );
}
