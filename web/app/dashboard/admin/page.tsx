"use client";

import { useCallback, useEffect, useState } from "react";
import { getAdminHealth, retryDelivery } from "@/lib/api";
import type { AdminHealth } from "@/lib/api";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  DeviceMobileIcon,
  LockClosedIcon,
  RefreshIcon,
  ServerIcon,
  SignalIcon,
} from "@/components/icons";
import { Card, SectionTitle } from "@/components/ui";

function Stat({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn" | "bad";
  hint?: string;
}) {
  const tones: Record<string, string> = {
    default: "text-ink",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  };
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export default function AdminPage() {
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(id: string) {
    setRetrying(id);
    await retryDelivery(id);
    setRetrying(null);
    load();
  }

  const load = useCallback(async () => {
    setLoading(true);
    const h = await getAdminHealth();
    setHealth(h);
    setLoading(false);
    if (!h) setNote("Owner key or account session required — the service-health view is owner-only.");
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live operational view
    return () => clearInterval(t);
  }, [load]);

  const issues: string[] = [];
  if (health) {
    if (health.sms.failed > 0) issues.push(`${health.sms.failed} SMS attempt(s) failed`);
    if (health.webhooks.failed > 0) issues.push(`${health.webhooks.failed} webhook delivery(ies) failed`);
    if (health.errors.route > 0) issues.push(`${health.errors.route} unhandled route error(s)`);
    if (health.geolocate.unresolved > 0) issues.push(`${health.geolocate.unresolved} unresolved geolocation(s)`);
    if (health.geolocate.limited > 0) issues.push(`${health.geolocate.limited} geolocation request(s) rate-limited (paid-API quota guard)`);
    if (health.security.rateLimited > 0) issues.push(`${health.security.rateLimited} request(s) rate-limited`);
    if (health.security.denied401 > 0) issues.push(`${health.security.denied401} rejected auth attempt(s)`);
    if (health.devices.offline > 0) issues.push(`${health.devices.offline} device(s) offline`);
  }

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Observability · Phase 2.5"
        title="Service health"
        action={
          <button className="btn-ghost" onClick={load} disabled={loading}>
            <RefreshIcon className="h-4 w-4" />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {note ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {note}
        </div>
      ) : null}

      {!health ? (
        <Card className="p-10 text-center text-sm text-ink-muted">
          {loading ? "Reading service health…" : "No health data — start the sync server and authenticate (owner key or account session)."}
        </Card>
      ) : (
        <>
          {/* Issue banner */}
          {issues.length > 0 ? (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
                <AlertTriangleIcon className="h-4 w-4" />
                Needs attention
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-red-700/90">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
              <CheckCircleIcon className="h-4 w-4" />
              All systems nominal — no failed deliveries, no auth anomalies.
            </div>
          )}

          {/* Top strip */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="flex items-center gap-3 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <ServerIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-ink-muted">Server</p>
                <p className="font-semibold text-ink">
                  {new Date(health.time).toLocaleTimeString("en-NG")} · {Math.round(health.uptimeS / 60)}m up
                </p>
                <p className="font-mono text-[11px] text-ink-faint">
                  {health.storage.mode} — {health.storage.describe}
                </p>
              </div>
            </Card>
            <Card className="flex items-center gap-3 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <DeviceMobileIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-ink-muted">Devices</p>
                <p className="font-semibold text-ink">
                  {health.devices.connected} connected · {health.devices.offline} offline
                </p>
                <p className="text-[11px] text-ink-faint">
                  {health.devices.paired} paired · {health.devices.lost} lost
                </p>
              </div>
            </Card>
            <Card className="flex items-center gap-3 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
                <ClockIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-ink-muted">Last fix age</p>
                <p className="font-semibold text-ink">
                  {health.lastFixAgeMin ? `${health.lastFixAgeMin.newest} min (newest)` : "no fixes yet"}
                </p>
                <p className="text-[11px] text-ink-faint">
                  {health.lastFixAgeMin ? `oldest ${health.lastFixAgeMin.oldest} min` : "agents are quiet"}
                </p>
              </div>
            </Card>
            <Card className="flex items-center gap-3 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent">
                <SignalIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-ink-muted">Alert delivery</p>
                <p className="font-semibold text-ink">{health.commands.deliveryRate} command ack rate</p>
                <p className="text-[11px] text-ink-faint">
                  {health.alerts.raised} alerts raised since boot
                </p>
              </div>
            </Card>
          </div>

          {/* Detail grids */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Location engine</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Fixes received" value={health.geolocate.requests} tone="good" />
              <Stat label="Wi-Fi resolved" value={health.geolocate.resolved} tone="good" hint="real BSSID → coordinate" />
              <Stat label="Unresolved" value={health.geolocate.unresolved} tone={health.geolocate.unresolved ? "warn" : "default"} hint="no key / provider miss" />
              <Stat label="Rate-limited" value={health.geolocate.limited} tone={health.geolocate.limited ? "warn" : "default"} hint="paid-API quota guard" />
            </div>
          </div>

          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Community network</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Sightings received" value={health.sightings.received} />
              <Stat label="Stored" value={health.sightings.stored} tone="good" />
              <Stat label="Deduped" value={health.sightings.deduped} />
              <Stat label="Ghost beacons" value={health.sightings.ghosts} hint="unknown → swallowed" />
              <Stat label="Rate-limited" value={health.sightings.limited} tone={health.sightings.limited ? "warn" : "default"} />
            </div>
          </div>

          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Commands & alerts</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Queued" value={health.commands.queued} />
              <Stat label="Delivered" value={health.commands.delivered} />
              <Stat label="Acked by agent" value={health.commands.acked} tone="good" />
              <Stat label="Alerts raised" value={health.alerts.raised} />
            </div>
          </div>

          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Alert channels</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="SMS attempts" value={health.sms.attempts} />
              <Stat
                label="SMS ok / failed"
                value={`${health.sms.ok} / ${health.sms.failed}`}
                tone={health.sms.failed ? "bad" : "good"}
                hint={`provider: ${health.sms.provider}`}
              />
              <Stat
                label="Webhooks sent / failed"
                value={`${health.webhooks.sent} / ${health.webhooks.failed}`}
                tone={health.webhooks.failed ? "bad" : "good"}
              />
              <Stat
                label="Push / SMS / webhook"
                value="3 channels"
                hint="log mode until providers are set"
              />
            </div>
          </div>

          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Alert delivery log</h3>
            {health.deliveryLog.length === 0 ? (
              <Card className="p-4 text-xs text-ink-muted">
                No delivery attempts recorded yet — SMS and webhook deliveries appear here (failures and
                successes), and failed ones can be retried from this page.
              </Card>
            ) : (
              <Card className="p-0">
                <ul className="divide-y divide-slate-100">
                  {health.deliveryLog.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <span
                        className={`chip ${
                          e.ok
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                            : "bg-red-50 text-red-700 ring-red-600/20"
                        }`}
                      >
                        {e.ok ? "delivered" : "failed"}
                      </span>
                      <span className="font-mono text-xs font-medium text-ink">{e.channel}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                        {e.alert ? `${e.alert.type} · ${e.alert.hostname}` : "—"}
                        {e.error ? ` · ${e.error}` : ""}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-faint">
                        {new Date(e.at).toLocaleString("en-NG")}
                      </span>
                      {!e.ok && e.alert ? (
                        <button
                          className="btn-ghost !px-2 !py-1 text-[11px]"
                          onClick={() => retry(e.id)}
                          disabled={retrying === e.id}
                        >
                          {retrying === e.id ? "Retrying…" : "Retry"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">Security posture</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Rejected auth"
                value={health.security.denied401}
                tone={health.security.denied401 ? "warn" : "good"}
                hint="bad owner keys / sessions"
              />
              <Stat
                label="Rate-limited"
                value={health.security.rateLimited}
                tone={health.security.rateLimited ? "warn" : "default"}
              />
              <Stat label="Registry checks" value={health.security.registryChecks} hint="public /api/check" />
              <Stat
                label="Registry hits"
                value={health.security.registryHits}
                tone={health.security.registryHits ? "warn" : "default"}
                hint="stolen devices queried"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Unhandled route errors"
                value={health.errors.route}
                tone={health.errors.route ? "bad" : "good"}
              />
              <Stat label="Ghosts probed" value={health.sightings.ghosts} hint="anti-probe answered 201" />
            </div>
          </div>

          <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-faint">
            <LockClosedIcon className="h-3.5 w-3.5" />
            Metrics are per-process (since boot) and never expose device locations or owner data.
          </p>
        </>
      )}
    </div>
  );
}
