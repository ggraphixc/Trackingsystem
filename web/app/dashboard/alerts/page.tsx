"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listAlerts, markAlertRead } from "@/lib/api";
import type { AlertItem } from "@/lib/api";
import { AlertTriangleIcon, BellIcon, CheckIcon, RefreshIcon, WifiIcon } from "@/components/icons";
import { Card, EmptyState, SectionTitle } from "@/components/ui";

const TYPE_META: Record<string, { label: string; cls: string; icon: "alert" | "wifi" }> = {
  sim_change: { label: "SIM changed", cls: "bg-red-50 text-red-700", icon: "alert" },
  stolen: { label: "Reported lost", cls: "bg-red-50 text-red-700", icon: "alert" },
  offline: { label: "Quiet", cls: "bg-amber-50 text-amber-700", icon: "alert" },
  reconnected: { label: "Back online", cls: "bg-sky-50 text-sky-700", icon: "wifi" },
  fix: { label: "New location", cls: "bg-sky-50 text-sky-700", icon: "wifi" },
  sighting: { label: "Community sighting", cls: "bg-violet-50 text-violet-700", icon: "wifi" },
  command_ack: { label: "Command executed", cls: "bg-amber-50 text-amber-700", icon: "wifi" },
  evidence: { label: "Evidence captured", cls: "bg-accent/10 text-accent", icon: "wifi" },
  contact: { label: "Finder message", cls: "bg-primary/10 text-primary", icon: "wifi" },
  recovered: { label: "Recovered", cls: "bg-emerald-50 text-emerald-700", icon: "wifi" },
  found: { label: "Marked found", cls: "bg-emerald-50 text-emerald-700", icon: "wifi" },
  transfer: { label: "Transferred", cls: "bg-slate-100 text-slate-600", icon: "wifi" },
  interest: { label: "Resale interest", cls: "bg-slate-100 text-slate-600", icon: "wifi" },
  listing: { label: "Listed for resale", cls: "bg-slate-100 text-slate-600", icon: "wifi" },
  ops: { label: "Service health", cls: "bg-slate-100 text-slate-600", icon: "wifi" },
};

function caseHref(alert: AlertItem): string | null {
  // ops alerts aren't tied to a device recovery case.
  if (!alert.deviceId || alert.deviceId === "ops") return null;
  return `/dashboard/recovery/${alert.deviceId}`;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await listAlerts();
    setAlerts(data.alerts);
    setUnread(data.unreadCount);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function read(id?: string) {
    await markAlertRead(id);
    load();
  }

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Recovery notifications"
        title="Alerts"
        action={
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={load}>
              <RefreshIcon className="h-4 w-4" /> Refresh
            </button>
            <button className="btn-secondary" onClick={() => read()} disabled={unread === 0}>
              <CheckIcon className="h-4 w-4" /> Mark all read
            </button>
          </div>
        }
      />

      {loading ? (
        <Card className="p-10 text-center text-sm text-ink-muted">Loading alerts…</Card>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<BellIcon className="h-7 w-7" />}
          title="No alerts yet"
          body="Reconnects, SIM changes, sightings, command acknowledgements and finder messages will appear here — each links to its recovery case."
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {alerts.map((a) => {
              const meta = TYPE_META[a.type] ?? {
                label: a.type,
                cls: "bg-slate-100 text-slate-600",
                icon: "wifi" as const,
              };
              const href = caseHref(a);
              return (
                <li key={a.id} className={`px-5 py-3.5 ${a.read ? "" : "bg-primary/[0.03]"}`}>
                  <div className="flex items-start gap-3">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${meta.cls}`}>
                      {meta.icon === "alert" ? (
                        <AlertTriangleIcon className="h-4 w-4" />
                      ) : (
                        <WifiIcon className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`truncate text-sm ${a.read ? "text-ink-muted" : "font-semibold text-ink"}`}>
                          {a.hostname}
                        </p>
                        <span className={`chip !px-2 !py-0.5 text-[10px] ${meta.cls}`}>{meta.label}</span>
                        {!a.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{a.body}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        <span className="font-mono text-[10px] text-ink-faint">
                          {new Date(a.at).toLocaleString("en-NG")}
                        </span>
                        {href ? (
                          <Link href={href} className="text-[11px] font-medium text-primary hover:text-primary-dark">
                            Open recovery case →
                          </Link>
                        ) : null}
                        {!a.read ? (
                          <button className="text-[11px] font-medium text-ink-muted hover:text-ink" onClick={() => read(a.id)}>
                            Mark read
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
