"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PairedDevice } from "@/lib/api";
import { AlertTriangleIcon, BellIcon, MapPinIcon, WifiIcon, XMarkIcon } from "@/components/icons";
import { Card } from "@/components/ui";

interface AlertBanner {
  deviceId: string;
  hostname: string;
  at: string;
  gapHours?: number;
  lat?: number;
  lng?: number;
}

const FRESH_WINDOW_MIN = 30; // only alert on events within this window

/**
 * Device alerts — the "a stolen phone surfaced" signal.
 *
 * - Sky banner: a device that had gone quiet reconnected (fixes synced).
 * - Red banner: a device's SIM was swapped — strong evidence of reuse.
 * - Violet banner: a Dravex phone heard a LOST device's Bluetooth beacon
 *   (community relay) — a location for the owner with no data/Wi-Fi needed.
 * - An activity feed lists the most recent events + sightings.
 *
 * Renders nothing when there is nothing to alert, so quiet dashboards stay
 * clean. Shared by the Overview and Agents pages.
 */
export default function DeviceAlerts({ devices }: { devices: PairedDevice[] }) {
  const [reconnectAlert, setReconnectAlert] = useState<AlertBanner | null>(null);
  const [simAlert, setSimAlert] = useState<AlertBanner | null>(null);
  const [sightingAlert, setSightingAlert] = useState<AlertBanner | null>(null);
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
      // Community sightings — a lost device heard by another Dravex phone.
      const sightings = d.sightings ?? [];
      for (const s of sightings.slice(0, 3)) {
        const key = `${d.deviceId}:sighting:${s.receivedAt ?? s.at}`;
        if (seen.current[key] === s.receivedAt) continue;
        const ageMin = (Date.now() - new Date(s.receivedAt ?? s.at).getTime()) / 60000;
        if (ageMin < FRESH_WINDOW_MIN) {
          setSightingAlert({
            deviceId: d.deviceId,
            hostname: d.hostname ?? "a device",
            at: s.at,
            lat: s.lat,
            lng: s.lng,
          });
        }
        seen.current[key] = s.receivedAt;
      }
    }
  }, [devices]);

  // Union of event + sighting rows, flattened into one timeline.
  type ActivityRow = {
    type: string;
    at: string;
    deviceId: string;
    hostname: string;
    detail?: Record<string, unknown>;
  };
  const activity: ActivityRow[] = devices
    .flatMap((d) => {
      const eventRows: ActivityRow[] = (d.events ?? [])
        .filter((e) => e.type === "reconnected" || e.type === "sim_change")
        .map((e) => ({
          type: e.type,
          at: e.at,
          deviceId: d.deviceId,
          hostname: d.hostname ?? d.deviceId.slice(0, 8),
          detail: e.detail,
        }));
      const sightingRows: ActivityRow[] = (d.sightings ?? []).map((s) => ({
        type: "sighting",
        at: s.at,
        deviceId: d.deviceId,
        hostname: d.hostname ?? d.deviceId.slice(0, 8),
        detail: { lat: s.lat, lng: s.lng },
      }));
      return [...eventRows, ...sightingRows];
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return (
    <>
      {/* Community sighting — a lost phone heard by another Dravex phone */}
      {sightingAlert ? (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-600">
              <MapPinIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-violet-900">
                {sightingAlert.hostname} was just seen by a Dravex phone nearby
              </p>
              <p className="mt-0.5 text-xs text-violet-700">
                Another user{`'`}s phone heard its Bluetooth beacon at{" "}
                {sightingAlert.lat?.toFixed(4)}°, {sightingAlert.lng?.toFixed(4)}° ({new Date(sightingAlert.at).toLocaleTimeString()})
                — even with the SIM out and data off, the beacon keeps broadcasting. Go there now, and
                have the police meet you if possible.
              </p>
            </div>
          </div>
          <button
            className="rounded-lg p-1.5 text-violet-500 hover:bg-violet-100"
            onClick={() => setSightingAlert(null)}
            aria-label="Dismiss alert"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}

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
              const isSighting = a.type === "sighting";
              return (
                <li key={`${a.deviceId}-${a.at}-${i}`} className="flex items-center gap-2.5 py-2">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                      isSim
                        ? "bg-red-50 text-red-500"
                        : isSighting
                          ? "bg-violet-50 text-violet-500"
                          : "bg-sky-50 text-sky-500"
                    }`}
                  >
                    {isSim ? (
                      <AlertTriangleIcon className="h-3.5 w-3.5" />
                    ) : isSighting ? (
                      <MapPinIcon className="h-3.5 w-3.5" />
                    ) : (
                      <WifiIcon className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span
                    className={`min-w-0 truncate text-sm ${
                      isSim
                        ? "font-medium text-red-700"
                        : isSighting
                          ? "font-medium text-violet-700"
                          : "text-ink"
                    }`}
                  >
                    {isSim
                      ? `${a.hostname} — SIM changed`
                      : isSighting
                        ? `${a.hostname} — seen by community at ${typeof a.detail?.lat === "number" ? a.detail.lat.toFixed(4) : "?"}°, ${typeof a.detail?.lng === "number" ? a.detail.lng.toFixed(4) : "?"}°`
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
