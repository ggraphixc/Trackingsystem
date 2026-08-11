import type { ReactNode } from "react";
import { CheckIcon, ChevronRightIcon, MapPinIcon, ShieldCheckIcon } from "./icons";
import type { DeviceStatus, IncidentStatus } from "@/lib/types";

/* ---------- Brand ---------- */

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="grid place-items-center rounded-xl bg-gradient-to-br from-primary to-primary-dark text-white shadow-card"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <ShieldCheckIcon style={{ width: size * 0.58, height: size * 0.58 }} />
      </span>
      <span className="text-lg font-bold tracking-tight text-ink">
        Track<span className="text-accent">Naija</span>
      </span>
    </span>
  );
}

/* ---------- Surfaces ---------- */

export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return <div className={`card ${hover ? "card-hover cursor-pointer" : ""} ${className}`}>{children}</div>;
}

export function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
      </div>
      {action}
    </div>
  );
}

/* ---------- Stats ---------- */

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  tone?: "primary" | "accent" | "success" | "neutral";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent",
    success: "bg-emerald-500/10 text-emerald-600",
    neutral: "bg-slate-100 text-slate-600",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-muted">{label}</p>
          <p className="mt-1.5 truncate text-2xl font-bold tracking-tight text-ink">{value}</p>
          {sub ? <p className="mt-1 text-xs text-ink-faint">{sub}</p> : null}
        </div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>{icon}</span>
      </div>
    </Card>
  );
}

/* ---------- Status ---------- */

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const map: Record<DeviceStatus, { label: string; cls: string }> = {
    protected: { label: "Protected", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
    lost: { label: "Lost", cls: "bg-red-50 text-red-700 ring-red-600/20" },
    recovered: { label: "Recovered", cls: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  };
  const m = map[status];
  return <span className={`chip ring-1 ring-inset ${m.cls}`}>{m.label}</span>;
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const map: Record<IncidentStatus, { label: string; cls: string }> = {
    reported: { label: "Reported", cls: "bg-red-50 text-red-700 ring-red-600/20" },
    sighted: { label: "Sighted", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
    recovered: { label: "Recovered", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
    closed: { label: "Closed", cls: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  };
  const m = map[status];
  return <span className={`chip ring-1 ring-inset ${m.cls}`}>{m.label}</span>;
}

/* ---------- Progress ---------- */

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light transition-all duration-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/* ---------- Wizard stepper ---------- */

export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-2">
              <span
                className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition-colors duration-200 ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-primary text-white"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {done ? <CheckIcon style={{ width: 14, height: 14 }} /> : i + 1}
              </span>
              <span className={`text-xs font-medium ${active ? "text-ink" : "text-ink-faint"}`}>{label}</span>
            </span>
            {i < steps.length - 1 ? (
              <ChevronRightIcon className="h-3.5 w-3.5 text-slate-300" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icon}</span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body ? <p className="mt-1 max-w-sm text-sm text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </Card>
  );
}

/* ---------- Map placeholder (visual, no API key needed in MVP) ---------- */

export function MapPreview({
  label = "Map view",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 via-blue-50/40 to-emerald-50/40 ${className}`}
    >
      {/* stylized grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #cbd5e1 1px, transparent 1px), linear-gradient(to bottom, #cbd5e1 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="relative inline-flex">
          <span className="absolute inline-flex h-10 w-10 animate-ping rounded-full bg-accent/30" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-accent ring-4 ring-white" />
        </span>
      </div>
      <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-medium text-ink shadow-card backdrop-blur">
        <span className="inline-flex items-center gap-1.5">
          <MapPinIcon className="h-3.5 w-3.5 text-accent" />
          {label}
        </span>
      </div>
      <div className="absolute bottom-3 right-3 rounded-lg bg-white/90 px-2.5 py-1.5 font-mono text-[11px] text-ink-muted shadow-card">
        6.5244° N · 3.3792° E
      </div>
    </div>
  );
}
