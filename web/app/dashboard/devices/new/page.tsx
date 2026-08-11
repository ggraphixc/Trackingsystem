"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocalStorage } from "@/lib/storage";
import { SEED_DEVICES } from "@/lib/data";
import type { Device } from "@/lib/types";
import { CheckCircleIcon, DeviceMobileIcon, SearchIcon } from "@/components/icons";
import { Card, SectionTitle } from "@/components/ui";

const BRANDS = ["HP", "Dell", "Lenovo", "ASUS", "Acer", "Apple", "Microsoft", "Toshiba", "Other"];

export default function NewDevicePage() {
  const router = useRouter();
  const [devices, setDevices] = useLocalStorage<Device[]>("devices", SEED_DEVICES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    brand: "HP",
    model: "",
    color: "",
    serialNumber: "",
    ownerName: "",
    phone: "",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.model.trim()) next.model = "Model is required.";
    if (!/^[A-Za-z0-9-]{5,25}$/.test(form.serialNumber.trim()))
      next.serialNumber =
        "Serial numbers are usually 5–25 letters, digits and dashes (e.g. XPS9530-B7F2K1).";
    if (!form.ownerName.trim()) next.ownerName = "Owner name is required.";
    if (!/^0\d{10}$/.test(form.phone.replace(/[\s-]/g, "")))
      next.phone = "Enter a valid Nigerian number, e.g. 08031234567.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const device: Device = {
      id: `dev-${Date.now()}`,
      brand: form.brand,
      model: form.model.trim(),
      color: form.color.trim() || undefined,
      serialNumber: form.serialNumber.trim().toUpperCase(),
      ownerName: form.ownerName.trim(),
      phone: form.phone.trim(),
      registeredAt: new Date().toISOString(),
      status: "protected",
    };
    setDevices([device, ...devices]);
    setSaved(true);
    setTimeout(() => router.push("/dashboard/devices"), 1200);
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <SectionTitle eyebrow="Vault" title="Register a laptop or desktop" />

      {saved ? (
        <Card className="flex flex-col items-center p-10 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircleIcon className="h-9 w-9" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-ink">Device protected!</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {form.brand} {form.model} is now in your vault. Redirecting…
          </p>
        </Card>
      ) : (
        <form onSubmit={submit} noValidate>
          <Card className="space-y-5 p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="brand">Brand</label>
                <select id="brand" className="input" value={form.brand} onChange={(e) => set("brand", e.target.value)}>
                  {BRANDS.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="model">Model *</label>
                <input
                  id="model"
                  className="input"
                  placeholder="e.g. EliteBook 840 G9, XPS 15"
                  value={form.model}
                  onChange={(e) => set("model", e.target.value)}
                  aria-invalid={!!errors.model}
                />
                {errors.model ? <p className="mt-1 text-xs text-red-600">{errors.model}</p> : null}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="serialNumber">Serial number *</label>
              <input
                id="serialNumber"
                className="input font-mono uppercase"
                placeholder="e.g. XPS9530-B7F2K1"
                value={form.serialNumber}
                onChange={(e) => set("serialNumber", e.target.value)}
                aria-invalid={!!errors.serialNumber}
              />
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-muted">
                <SearchIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                Find it via <span className="font-mono font-semibold">wmic bios get serialnumber</span>{" "}
                (Windows Command Prompt), About This Mac (macOS) or{" "}
                <span className="font-mono font-semibold">dmidecode -s system-serial-number</span>{" "}
                (Linux) — or check the sticker under the laptop.
              </p>
              {errors.serialNumber ? (
                <p className="mt-1 text-xs text-red-600">{errors.serialNumber}</p>
              ) : null}
            </div>

            <div>
              <label className="label" htmlFor="color">Colour / finish</label>
              <input id="color" className="input" placeholder="e.g. Silver, Black" value={form.color} onChange={(e) => set("color", e.target.value)} />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="ownerName">Owner name *</label>
                <input id="ownerName" className="input" placeholder="Full name" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} aria-invalid={!!errors.ownerName} />
                {errors.ownerName ? <p className="mt-1 text-xs text-red-600">{errors.ownerName}</p> : null}
              </div>
              <div>
                <label className="label" htmlFor="phone">Phone number *</label>
                <input id="phone" className="input" inputMode="tel" placeholder="0803 123 4567" value={form.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={!!errors.phone} />
                {errors.phone ? <p className="mt-1 text-xs text-red-600">{errors.phone}</p> : null}
              </div>
            </div>
          </Card>

          <div className="mt-5 flex items-center justify-end gap-3">
            <button type="button" className="btn-ghost" onClick={() => router.push("/dashboard/devices")}>
              Cancel
            </button>
            <button type="submit" className="btn-secondary">
              <DeviceMobileIcon className="h-4 w-4" />
              Protect this device
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
