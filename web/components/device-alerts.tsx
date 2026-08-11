"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PairedDevice } from "@/lib/api";
import { AlertTriangleIcon, BellIcon, WifiIcon, XMarkIcon } from "@/components/icons";
import { Card } from "@/components/ui";

interface AlertBanner {
  deviceId: string;
  hostname: string;
  at: string;
  gapHours?: number;
}

const FRESH_WINDOW_MIN = 15; // only alert on events within this window

/**
 * Device alerts — the "a stolen phone surfaced online" signal.
 *
 * - A sky banner fires when a device that had gone quiet reconnects.
 * - A red, high-priority banner fires when a device's SIM card is swapped —
 *   strong evidence the phone is being reused by someone else.
 * - An activity feed lists the most recent reconnected / SIM-change events.
 *
 * Renders nothing when there is nothing to alert, so quiet dashboards stay
 * clean. Shared by the Overview and Agents pages.
 */
export default function DeviceAlerts({ devices }: { devices: PairedDevice[] }) {
  const [reconnectAlert, setReconnectAlert] = useState<AlertBanner | null>(null);
  const [simAlert, setSimAlert] = useState<AlertBanner | null>(null);
  // Remember the last timestamp seen per device so each *new* event triggers
  // its banner exactly once.
  const seen = useRef<Record<string, string>>({});

  useEffect(() => {
    for (const d of devices) {
      const events = d.events ?? [];
      for (const e of events) {
        if (e.type !== "reconnected" && e.type !== "sim_change") continue;
        const key = `${d.deviceId}:${e.type}`;
        if (seen.current[key] === e.at) continue;
        const ageMin = (Date.now() - new Date(e.at).getTime()) / 60000;
        if (ageMin < FRESH_WINDOW_MIN) {
          const banner: AlertBanner = {
            deviceId: d.deviceId,
            hostname: d.hostname ?? "a device",
            at: e.at,
            gapHours: e.detail && typeof e.detail.gapHours === "number" ? e.detail.gapHours : undefined,
          };
          if (e.type === "sim_change") setSimAlert(banner);
          else setReconnectAlert(banner);
        }
        seen.current[key] = e.at;
      }
    }
  }, [devices]);

  const activity = devices
    .flatMap((d) =>
      (d.events ?? []).map((e) => ({
        ...e,
        deviceId: d.deviceId,
        hostname: d.hostname ?? d.deviceId.slice(0, 8),
      })),
    )
    .filter((e) => e.type === "reconnected" || e.type === "sim_change")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);

  return (
    <>
      {/* SIM swap — the phone is being reused. Red, top of the pile. */}
      {simAlert ? (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-100 text-red-600">
              <AlertTriangleIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-red-900">SIM card changed in {simAlert.hostname}</p>
              <p className="mt-0.5 text-xs text-red-700">
                The SIM was swapped at {new Date(simAlert.at).toLocaleTimeString()} — a stolen phone being
                reused looks exactly like this. Open the evidence gallery and start the recovery kit
                (blacklist the IMEI) now.
              </p>
            </div>
          </div>
          <button
            className="rounded-lg p-1.5 text-red-500 hover:bg-red-100"
            onClick={() => setSimAlert(null)}
            aria-label="Dismiss alert"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* A stolen phone surfaced online — the whole point of the offline vault */}
      {reconnectAlert ? (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-600">
              <BellIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-sky-900">{reconnectAlert.hostname} is back online</p>
              <p className="mt-0.5 text-xs text-sky-700">
                A device that had gone quiet reconnected at{" "}
                {new Date(reconnectAlert.at).toLocaleTimeString()}
                {reconnectAlert.gapHours ? ` after ${reconnectAlert.gapHours}h offline` : ""} — fixes and
                evidence captured while it was &quot;dead&quot; have synced. Check the Evidence gallery or
                open the offline recovery kit.
              </p>
            </div>
          </div>
          <button
            className="rounded-lg p-1.5 text-sky-500 hover:bg-sky-100"
            onClick={() => setReconnectAlert(null)}
            aria-label="Dismiss alert"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Recent device activity */}
      {activity.length > 0 ? (
        <Card className="mb-6 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Device activity</h3>
            <Link href="/dashboard/agents" className="text-xs font-medium text-primary hover:text-primary-dark">
              View all agents →
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {activity.map((a, i) => {
              const isSim = a.type === "sim_change";
              return (
                <li key={`${a.deviceId}-${a.at}-${i}`} className="flex items-center gap-2.5 py-2">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                      isSim ? "bg-red-50 text-red-500" : "bg-sky-50 text-sky-500"
                    }`}
                  >
                    {isSim ? (
                      <AlertTriangleIcon className="h-3.5 w-3.5" />
                    ) : (
                      <WifiIcon className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span
                    className={`min-w-0 truncate text-sm ${
                      isSim ? "font-medium text-red-700" : "text-ink"
                    }`}
                  >
                    {isSim
                      ? `${a.hostname} — SIM changed`
                      : `${a.hostname} reconnected after ${
                          a.detail && typeof a.detail.gapHours === "number"
                            ? `${a.detail.gapHours}h`
                            : "an outage"
                        } offline`}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-faint">
                    {new Date(a.at).toLocaleString("en-NG")}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
