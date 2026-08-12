"use client";

import { useState } from "react";
import { useLocalStorage } from "@/lib/storage";
import { SEED_DEVICES, formatDate } from "@/lib/data";
import type { Device } from "@/lib/types";
import {
  AlertTriangleIcon,
  CrosshairIcon,
  EyeIcon,
  LockClosedIcon,
  MapPinIcon,
  SignalIcon,
  WifiIcon,
} from "@/components/icons";
import { Card, DeviceStatusBadge, MapPreview, SectionTitle } from "@/components/ui";

const SOURCE_META: Record<string, { label: string; icon: typeof WifiIcon; cls: string }> = {
  wifi: { label: "Wi-Fi positioning", icon: WifiIcon, cls: "text-blue-600 bg-blue-50" },
  ip: { label: "IP geolocation", icon: SignalIcon, cls: "text-amber-600 bg-amber-50" },
  last_known: { label: "Last known fix", icon: MapPinIcon, cls: "text-slate-600 bg-slate-100" },
};

export default function TrackPage() {
  const [devices] = useLocalStorage<Device[]>("devices", SEED_DEVICES);
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const device = devices.find((d) => d.id === deviceId);
  const fix = device?.lastKnown;
  const meta = fix ? SOURCE_META[fix.source] : null;

  return (
    <div className="animate-fade-up">
      <SectionTitle eyebrow="Live tracking" title="Track a device" />

      <div className="mb-5 flex flex-wrap gap-2">
        {devices.map((d) => (
          <button
            key={d.id}
            onClick={() => setDeviceId(d.id)}
            className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors duration-200 cursor-pointer ${
              d.id === deviceId
                ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/20"
                : "border-slate-200 bg-white text-ink-muted hover:border-slate-300 hover:text-ink"
            }`}
          >
            {d.brand} {d.model}
          </button>
        ))}
      </div>

      {device ? (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Card className="overflow-hidden">
              <MapPreview className="h-[420px] w-full rounded-none border-0" label={device.brand + " " + device.model} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4">
                <div>
                  <p className="text-sm font-semibold text-ink">{device.brand} {device.model}</p>
                  <p className="font-mono text-[11px] text-ink-faint">Serial {device.serialNumber}</p>
                </div>
                <div className="flex items-center gap-2">
                  <DeviceStatusBadge status={device.status} />
                  {device.status === "lost" ? (
                    <span className="chip bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
                      <AlertTriangleIcon className="h-3 w-3" />
                      Lost mode ON
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-2">
            {fix && meta ? (
              <Card className="p-5">
                <h3 className="mb-3 text-sm font-semibold text-ink">Signal ladder</h3>
                <div className="space-y-2.5">
                  {(["wifi", "ip", "last_known"] as const).map((src, i) => {
                    const m = SOURCE_META[src];
                    const Icon = m.icon;
                    const isCurrent = src === fix.source;
                    return (
                      <div
                        key={src}
                        className={`flex items-center gap-3 rounded-xl border p-3 transition-colors duration-200 ${
                          isCurrent ? "border-primary bg-primary/5" : "border-slate-100 opacity-55"
                        }`}
                      >
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${m.cls}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink">{m.label}</p>
                          <p className="font-mono text-[11px] text-ink-faint">
                            ±{fix.accuracy} m accuracy · confidence {fix.confidence}%
                            {fix.ipAddress ? ` · IP ${fix.ipAddress}` : ""}
                          </p>
                        </div>
                        {isCurrent ? (
                          <span className="h-2 w-2 shrink-0 animate-pulse-soft rounded-full bg-primary" />
                        ) : (
                          <span className="font-mono text-xs text-ink-faint">{i + 1}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <span className="chip bg-slate-100 text-slate-600">updated {formatDate(fix.timestamp)}</span>
                </div>
              </Card>
            ) : (
              <Card className="p-5 text-sm text-ink-muted">
                No location fix recorded for this device yet. Install the Dravex agent on the
                laptop — it reports Wi-Fi and IP positions while running.
              </Card>
            )}

            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-ink">Anti-theft commands</h3>
              <div className="grid gap-2">
                <button className="btn-secondary w-full justify-between">
                  <span className="flex items-center gap-2">
                    <EyeIcon className="h-4 w-4" /> Capture webcam photo
                  </span>
                  <span className="text-xs opacity-70">demo</span>
                </button>
                <button className="btn-ghost w-full justify-between">
                  <span className="flex items-center gap-2">
                    <AlertTriangleIcon className="h-4 w-4" /> Play loud alarm
                  </span>
                  <span className="text-xs opacity-70">demo</span>
                </button>
                <button className="btn-ghost w-full justify-between">
                  <span className="flex items-center gap-2">
                    <LockClosedIcon className="h-4 w-4" /> Lock screen with message
                  </span>
                  <span className="text-xs opacity-70">demo</span>
                </button>
              </div>
              <p className="mt-3 text-xs text-ink-faint">
                Commands are pushed to the agent app installed on the laptop. These controls are demo
                buttons until the backend is wired.
              </p>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="p-6 text-sm text-ink-muted">
          Register a device first — then you can track it here.
        </Card>
      )}
    </div>
  );
}
