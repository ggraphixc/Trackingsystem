"use client";

import Link from "next/link";
import { useLocalStorage } from "@/lib/storage";
import { SEED_INCIDENTS, formatDate } from "@/lib/data";
import type { Incident } from "@/lib/types";
import { CheckIcon, DocumentTextIcon, PlusIcon } from "@/components/icons";
import { Card, EmptyState, IncidentStatusBadge, ProgressBar, SectionTitle } from "@/components/ui";

export default function IncidentsPage() {
  const [incidents] = useLocalStorage<Incident[]>("incidents", SEED_INCIDENTS);

  const sorted = [...incidents].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Recovery hub"
        title="Incidents"
        action={
          <Link href="/dashboard/incidents/new" className="btn-primary">
            <PlusIcon className="h-4 w-4" />
            Report lost phone
          </Link>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon={<DocumentTextIcon className="h-7 w-7" />}
          title="No incidents reported"
          body="If your phone goes missing, start here. We'll generate your police report, carrier blacklist kit and recovery checklist."
          action={
            <Link href="/dashboard/incidents/new" className="btn-secondary">
              Report a lost phone
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {sorted.map((inc) => {
            const done = inc.steps.filter((s) => s.done).length;
            const pct = Math.round((done / inc.steps.length) * 100);
            return (
              <Card key={inc.id} hover className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-ink">{inc.deviceLabel}</h3>
                      <IncidentStatusBadge status={inc.status} />
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">
                      Lost {formatDate(inc.dateLost)} · {inc.locationLost}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">{inc.story}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                      {inc.registryRef ? (
                        <span>
                          Registry ref: <span className="font-mono font-semibold text-ink">{inc.registryRef}</span>
                        </span>
                      ) : null}
                      {inc.policeRef ? (
                        <span>
                          Police ref: <span className="font-mono text-ink">{inc.policeRef}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="w-full sm:w-56">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">Recovery checklist</span>
                      <span className="font-mono text-ink-faint">
                        {done}/{inc.steps.length}
                      </span>
                    </div>
                    <ProgressBar value={pct} />
                  </div>
                </div>

                <ul className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2">
                  {inc.steps.map((step, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                          step.done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {step.done ? <CheckIcon style={{ width: 12, height: 12 }} /> : null}
                      </span>
                      <span className={step.done ? "text-ink-muted line-through decoration-slate-300" : "text-ink"}>
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
