"use client";

import { useLocalStorage } from "@/lib/storage";
import { SEED_DEVICES, SEED_INCIDENTS } from "@/lib/data";
import type { Device, Incident } from "@/lib/types";
import { BatteryIcon, LeafIcon, RecycleIcon, ShieldCheckIcon, TreeIcon } from "@/components/icons";
import { Card, ProgressBar, SectionTitle, StatCard } from "@/components/ui";

const CO2_PER_LAPTOP = 300; // kg CO₂e avoided per laptop recovered (vs manufacturing a new one)

export default function ImpactPage() {
  const [devices] = useLocalStorage<Device[]>("devices", SEED_DEVICES);
  const [incidents] = useLocalStorage<Incident[]>("incidents", SEED_INCIDENTS);

  const recovered = devices.filter((d) => d.status === "recovered").length;
  const co2Saved = recovered * CO2_PER_LAPTOP;
  const treesEquivalent = Math.round(co2Saved / 21); // ~21 kg CO₂ absorbed per tree per year
  const eWasteKg = recovered * 1.6; // ~1.6 kg of e-waste avoided per laptop

  const milestones = [
    { label: "500 kg CO₂e", current: Math.min(100, Math.round((co2Saved / 500) * 100)) },
    { label: "50 devices recovered", current: Math.min(100, Math.round((recovered / 50) * 100)) },
    { label: "1,000 serial checks", current: Math.min(100, Math.round(incidents.length * 5)) },
  ];

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Sustainability"
        title="Your impact"
        action={
          <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            Recovery over replacement
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="CO₂e saved" value={`${co2Saved} kg`} sub="vs manufacturing new laptops" icon={<LeafIcon className="h-5 w-5" />} tone="success" />
        <StatCard label="Equivalent to" value={`${treesEquivalent} trees`} sub="absorbing CO₂ for a year" icon={<TreeIcon className="h-5 w-5" />} tone="primary" />
        <StatCard label="E-waste avoided" value={`${eWasteKg} kg`} sub="kept out of landfill" icon={<RecycleIcon className="h-5 w-5" />} tone="neutral" />
        <StatCard label="Devices recovered" value={String(recovered)} sub="second life earned" icon={<ShieldCheckIcon className="h-5 w-5" />} tone="accent" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-1 text-base font-semibold text-ink">Community milestones</h2>
          <p className="mb-5 text-sm text-ink-muted">TrackNaija users together, heading to these goals.</p>
          <div className="space-y-6">
            {milestones.map((m) => (
              <div key={m.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium text-ink">{m.label}</span>
                  <span className="font-mono text-xs text-ink-faint">{m.current}%</span>
                </div>
                <ProgressBar value={m.current} />
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="bg-gradient-to-br from-emerald-600 to-emerald-700 p-5 text-white">
            <LeafIcon className="h-6 w-6 text-emerald-200" />
            <h3 className="mt-3 text-sm font-semibold">Why recovery is climate action</h3>
            <p className="mt-1.5 text-sm text-emerald-100">
              Manufacturing one laptop emits roughly <span className="font-bold">300 kg of CO₂e</span>.
              Every device recovered — or repaired instead of replaced — is a laptop that doesn{"'"}t
              need to be mined, shipped and manufactured again.
            </p>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent">
                <BatteryIcon className="h-5 w-5" />
              </span>
              <h3 className="text-sm font-semibold text-ink">Repair first, replace last</h3>
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              Coming in Phase 3: a network of verified Nigerian repair shops and a second-life
              marketplace for serial-cleared refurbished laptops.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
