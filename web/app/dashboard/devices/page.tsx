"use client";

import Link from "next/link";
import { useLocalStorage } from "@/lib/storage";
import { SEED_DEVICES, formatDate } from "@/lib/data";
import type { Device } from "@/lib/types";
import { DeviceMobileIcon, PlusIcon, SignalIcon } from "@/components/icons";
import { Card, DeviceStatusBadge, EmptyState, SectionTitle } from "@/components/ui";

const SOURCE_LABEL: Record<string, string> = {
  wifi: "Wi-Fi positioning",
  ip: "IP geolocation",
  last_known: "Last known",
};

export default function DevicesPage() {
  const [devices] = useLocalStorage<Device[]>("devices", SEED_DEVICES);

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Vault"
        title="My Devices"
        action={
          <Link href="/dashboard/devices/new" className="btn-primary">
            <PlusIcon className="h-4 w-4" />
            Register device
          </Link>
        }
      />

      {devices.length === 0 ? (
        <EmptyState
          icon={<DeviceMobileIcon className="h-7 w-7" />}
          title="No devices yet"
          body="Register your phone or laptop now so we can help find it if it ever goes missing. It takes 30 seconds."
          action={
            <Link href="/dashboard/devices/new" className="btn-secondary">
              Register your first device
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {devices.map((d) => {
            const isPhone = d.type === "phone";
            return (
            <Card key={d.id} hover className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`grid h-11 w-11 place-items-center rounded-xl ${
                      isPhone ? "bg-primary/10 text-primary" : "bg-violet-50 text-violet-600"
                    }`}
                  >
                    {isPhone ? (
                      <DeviceMobileIcon className="h-6 w-6" />
                    ) : (
                      <SignalIcon className="h-6 w-6" />
                    )}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink">
                        {d.brand} {d.model}
                      </p>
                      <span
                        className={`chip ${isPhone ? "bg-primary/10 text-primary" : "bg-violet-50 text-violet-600"}`}
                      >
                        {isPhone ? "Phone" : "Laptop"}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted">{d.color ?? "—"}</p>
                  </div>
                </div>
                <DeviceStatusBadge status={d.status} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
                <div>
                  <dt className="text-xs text-ink-faint">{isPhone ? "IMEI" : "Serial number"}</dt>
                  <dd className="mt-0.5 font-mono text-xs text-ink">
                    {isPhone ? d.imei ?? "—" : d.serialNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">Registered</dt>
                  <dd className="mt-0.5 text-xs text-ink">{formatDate(d.registeredAt)}</dd>
                </div>
              </dl>

              {d.lastKnown ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-3.5">
                  <p className="text-xs font-medium text-ink">Last known location</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-muted">
                    {d.lastKnown.lat.toFixed(4)}°, {d.lastKnown.lng.toFixed(4)}°
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="chip bg-primary/10 text-primary">
                      {SOURCE_LABEL[d.lastKnown.source]} · ±{d.lastKnown.accuracy} m
                    </span>
                    <span className="chip bg-emerald-50 text-emerald-700">
                      confidence {d.lastKnown.confidence}%
                    </span>
                    {d.lastKnown.ipAddress ? (
                      <span className="chip bg-slate-100 text-slate-600">IP {d.lastKnown.ipAddress}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] text-ink-faint">
                    Updated {formatDate(d.lastKnown.timestamp)}
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-xs text-ink-faint">
                  No location fix yet — install the Dravex agent on this {isPhone ? "phone" : "laptop"}{" "}
                  and grant it network access.
                </p>
              )}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
