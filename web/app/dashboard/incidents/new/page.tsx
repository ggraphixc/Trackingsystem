"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocalStorage } from "@/lib/storage";
import { NPF_CHANNELS, SEED_DEVICES, SEED_INCIDENTS } from "@/lib/data";
import type { Device, Incident } from "@/lib/types";
import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  EyeIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import { Card, SectionTitle, StepIndicator } from "@/components/ui";

const STEPS = ["What happened", "Which device", "Police report", "Recovery kit"];

export default function NewIncidentPage() {
  const [devices, setDevices] = useLocalStorage<Device[]>("devices", SEED_DEVICES);
  const [incidents, setIncidents] = useLocalStorage<Incident[]>("incidents", SEED_INCIDENTS);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ dateLost: "", locationLost: "", story: "" });
  const [deviceId, setDeviceId] = useState<string>("");
  const [manualSerial, setManualSerial] = useState("");
  const [policeRef, setPoliceRef] = useState("");
  const [done, setDone] = useState<Incident | null>(null);
  const [error, setError] = useState("");

  const selectedDevice = devices.find((d) => d.id === deviceId);
  const serial = selectedDevice?.serialNumber ?? manualSerial.trim().toUpperCase();
  const deviceLabel = selectedDevice
    ? `${selectedDevice.brand} ${selectedDevice.model} · ${selectedDevice.color ?? "N/A"}`
    : serial
      ? `Device (Serial ${serial})`
      : "";

  function canProceed(): boolean {
    if (step === 0) return !!form.dateLost && !!form.locationLost.trim();
    if (step === 1) return !!selectedDevice || serial.length >= 5;
    return true;
  }

  function next() {
    if (step === 2 && !policeRef.trim()) {
      // auto-generate a reference like a portal would
      setPoliceRef(`CRP-2026-${Math.floor(10000 + Math.random() * 89999)}`);
    }
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  }

  function back() {
    if (step > 0) setStep((s) => s - 1);
  }

  function finish() {
    if (!serial) {
      setError("We need a serial number to list the device in the recovery kit.");
      return;
    }
    const registryRef = `SR-2026-${Math.floor(10000 + Math.random() * 89999)}`;
    const incident: Incident = {
      id: `inc-${Date.now()}`,
      deviceId: selectedDevice?.id ?? "manual",
      serialNumber: serial,
      deviceLabel,
      dateLost: form.dateLost ? new Date(form.dateLost).toISOString() : new Date().toISOString(),
      locationLost: form.locationLost,
      story: form.story || "No additional details provided.",
      status: "reported",
      registryRef,
      policeRef: policeRef || `CRP-2026-${Math.floor(10000 + Math.random() * 89999)}`,
      createdAt: new Date().toISOString(),
      steps: [
        { label: "Report to police (NPF NCCC / CRP)", done: true, doneAt: new Date().toISOString() },
        { label: "List serial in the stolen registry", done: true, doneAt: new Date().toISOString() },
        { label: "Community registry + sightings", done: false },
        { label: "Recovery or insurance claim pack", done: false },
      ],
    };
    setIncidents([incident, ...incidents]);
    if (selectedDevice) {
      setDevices(
        devices.map((d) => (d.id === selectedDevice.id ? { ...d, status: "lost" as const } : d)),
      );
    }
    setDone(incident);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* -------- completion screen -------- */
  if (done) {
    return (
      <div className="mx-auto max-w-2xl animate-fade-up">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-gradient-to-br from-primary to-primary-dark p-6 text-white">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15">
                <CheckCircleIcon className="h-7 w-7" />
              </span>
              <div>
                <h2 className="text-lg font-bold">Incident reported — stay strong</h2>
                <p className="text-sm text-blue-100">Recovery kit generated below. Keep these documents.</p>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-6">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">1 · Police report</h3>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-ink">
                <p>LOST / STOLEN DEVICE REPORT</p>
                <p>Reference: {done.policeRef}</p>
                <p>Device: {done.deviceLabel}</p>
                <p>Serial: {done.serialNumber}</p>
                <p>Lost at: {done.locationLost} on {new Date(done.dateLost).toLocaleDateString("en-NG")}</p>
                <p className="mt-2 text-ink-muted">Submit via any official channel:</p>
                {NPF_CHANNELS.map((c) => (
                  <p key={c.label}>· {c.label}: {c.value}</p>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">2 · Stolen serial registry</h3>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-ink">
                <p>
                  This device is now listed in the TrackNaija stolen registry (ref{" "}
                  <span className="font-mono">{done.registryRef}</span>) with serial{" "}
                  <span className="font-mono">{done.serialNumber}</span>. Anyone buying a used laptop
                  can check the serial first — fenced laptops become unsellable.
                </p>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">3 · Community & claim pack</h3>
              <div className="flex flex-wrap gap-2">
                <span className="chip bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20">
                  Community sightings: enabled
                </span>
                <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                  Insurance claim: pack ready
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                The claim pack contains your police report, registry ref and ownership proof from the
                vault — everything insurers ask for.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
              <button className="btn-primary" onClick={() => window.print()}>
                <DocumentTextIcon className="h-4 w-4" />
                Print / save certificate (PDF)
              </button>
              <Link href="/dashboard/incidents" className="btn-ghost">
                View all incidents
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  /* -------- wizard -------- */
  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <SectionTitle eyebrow="Recovery hub" title="Report a lost laptop" />
      <StepIndicator steps={STEPS} current={step} />

      <Card className="mt-6 p-6">
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <label className="label" htmlFor="dateLost">When did it go missing? *</label>
              <input
                id="dateLost"
                type="date"
                className="input"
                value={form.dateLost}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setForm((f) => ({ ...f, dateLost: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="locationLost">Where? *</label>
              <input
                id="locationLost"
                className="input"
                placeholder="e.g. Computer Village, Ikeja, Lagos"
                value={form.locationLost}
                onChange={(e) => setForm((f) => ({ ...f, locationLost: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="story">What happened?</label>
              <textarea
                id="story"
                className="input min-h-[110px] resize-y"
                placeholder="Stolen from an office, snatched at a cyber cafe, left in a bus, etc."
                value={form.story}
                onChange={(e) => setForm((f) => ({ ...f, story: e.target.value }))}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <label className="label">Pick the device from your vault</label>
              <div className="grid gap-2">
                {devices.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setDeviceId(d.id);
                      setManualSerial("");
                    }}
                    className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition-colors duration-200 cursor-pointer ${
                      deviceId === d.id
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-semibold text-ink">
                        {d.brand} {d.model}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-ink-faint">
                        Serial {d.serialNumber}
                      </span>
                    </span>
                    {deviceId === d.id ? (
                      <CheckCircleIcon className="h-5 w-5 text-primary" />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="h-px flex-1 bg-slate-200" />
              or enter the serial manually
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <div>
              <label className="label" htmlFor="manualSerial">Serial number</label>
              <input
                id="manualSerial"
                className="input font-mono uppercase"
                placeholder="Check the sticker under the laptop"
                value={manualSerial}
                onChange={(e) => {
                  setManualSerial(e.target.value);
                  setDeviceId("");
                }}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              A police report is required for insurance claims and the stolen registry. We{"'"}ve
              prepared yours — submit it through any official NPF channel.
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-ink">
              <p className="font-bold">LOST / STOLEN DEVICE REPORT</p>
              <p>Device: {deviceLabel || "—"}</p>
              <p>Serial: {serial || "—"}</p>
              <p>
                Lost at: {form.locationLost || "—"} on{" "}
                {form.dateLost ? new Date(form.dateLost).toLocaleDateString("en-NG") : "—"}
              </p>
              <p>Details: {form.story || "—"}</p>
              {policeRef ? <p className="mt-2">Generated ref: <span className="font-bold">{policeRef}</span></p> : null}
            </div>
            <div>
              <p className="label">Official channels</p>
              <ul className="space-y-2">
                {NPF_CHANNELS.map((c) => (
                  <li key={c.label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                    <span className="font-medium text-ink">{c.label}</span>
                    <span className="font-mono text-xs text-ink-muted">{c.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
              <p>
                Your device will be listed in the <span className="font-semibold">stolen serial
                registry</span>. Used-laptop buyers (Computer Village and beyond) can check serials
                against it — a fenced laptop becomes unsellable.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-ink">
              <p className="mb-1 flex items-center gap-1.5 font-semibold">
                <EyeIcon className="h-4 w-4 text-accent" />
                Recovery kit contents
              </p>
              <ul className="ml-1 space-y-1 text-ink-muted">
                <li>· Police report (ref {policeRef || "CRP-____"})</li>
                <li>· Registry reference SR-2026-____ with serial {serial || "____"}</li>
                <li>· Community sightings — enabled, anonymized</li>
                <li>· Insurance claim pack (police report + ownership proof)</li>
              </ul>
            </div>

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
          <button className="btn-ghost" onClick={back} disabled={step === 0}>
            <ChevronLeftIcon className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center gap-2">
            {!canProceed() && step < 3 ? (
              <span className="text-xs text-ink-faint">Fill the required fields to continue</span>
            ) : null}
            <button
              className={step === 3 ? "btn-secondary" : "btn-primary"}
              onClick={next}
              disabled={!canProceed() && step < 3}
            >
              {step === STEPS.length - 1 ? (
                <>
                  <ShieldCheckIcon className="h-4 w-4" />
                  Generate recovery kit
                </>
              ) : (
                <>
                  Continue <ChevronRightIcon className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
