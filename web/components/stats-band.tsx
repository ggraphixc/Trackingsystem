"use client";

import { useEffect, useState } from "react";
import { getStats } from "@/lib/api";
import type { PublicStats } from "@/lib/api";
import { CrosshairIcon, DeviceMobileIcon, MapPinIcon, ShieldCheckIcon } from "@/components/icons";

/**
 * Public Dravex network counters (N5). Fetches GET /api/stats — counts only,
 * never owner or device data. Renders nothing if the registry is unreachable
 * (the landing page must stay beautiful even before the API is deployed).
 */
export default function StatsBand() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let alive = true;
    getStats().then((s) => {
      if (alive && s) setStats(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!stats) return null;

  const rows = [
    {
      icon: ShieldCheckIcon,
      value: stats.protected ?? 0,
      label: "devices protected",
    },
    {
      icon: CrosshairIcon,
      value: stats.recovered ?? 0,
      label: "devices recovered",
    },
    {
      icon: MapPinIcon,
      value: stats.sighted ?? 0,
      label: "community sightings",
    },
    {
      icon: DeviceMobileIcon,
      value: stats.listings ?? 0,
      label: "verified resale listings",
    },
  ];

  return (
    <section className="border-y border-slate-200 bg-white py-10">
      <div className="mx-auto max-w-6xl px-4 lg:px-8">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-accent">
          The Dravex network — live
        </p>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {rows.map(({ icon: Icon, value, label }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-surface p-5 text-center">
              <Icon className="mx-auto h-5 w-5 text-primary" />
              <p className="mt-2 font-mono text-3xl font-bold text-ink">
                {Number(value).toLocaleString("en-NG")}
              </p>
              <p className="mt-1 text-xs text-ink-muted">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
