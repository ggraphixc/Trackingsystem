"use client";

import { useState } from "react";
import { STOLEN_SERIAL_DB } from "@/lib/data";
import type { SerialLookupResult } from "@/lib/types";
import { AlertTriangleIcon, CheckCircleIcon, SearchIcon, ShieldCheckIcon } from "@/components/icons";
import { Card, SectionTitle } from "@/components/ui";

export default function SerialCheckPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SerialLookupResult | null>(null);
  const [checked, setChecked] = useState(false);

  function lookup(e: React.FormEvent) {
    e.preventDefault();
    setChecked(true);
    const serial = query.trim().toUpperCase();
    const hit = STOLEN_SERIAL_DB[serial];
    if (hit) {
      setResult({
        found: true,
        brand: hit.brand,
        model: hit.model,
        status: "reported_stolen",
        reportedAt: hit.reportedAt,
        message:
          "This device is listed in the stolen-device registry. Do not buy it — report it to the nearest police station.",
      });
    } else {
      setResult({
        found: false,
        status: "clean",
        message:
          "No stolen-device report found for this serial. As a precaution, ask for the original receipt and check the laptop isn't BIOS/administrator-locked.",
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <SectionTitle
        eyebrow="Buyer protection"
        title="Serial Check"
        action={
          <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            Free forever
          </span>
        }
      />

      <Card className="p-6">
        <p className="mb-4 text-sm text-ink-muted">
          Buying a used laptop? Check its serial number against our stolen-device registry before
          you pay.{" "}
          <span className="font-semibold text-ink">Computer Village, be safe out there.</span>
        </p>
        <form onSubmit={lookup} className="flex gap-2">
          <input
            className="input font-mono uppercase"
            placeholder="Enter serial number, e.g. HP840G9-CN4487X"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Serial number to check"
          />
          <button type="submit" className="btn-secondary shrink-0" disabled={query.trim().length < 5}>
            <SearchIcon className="h-4 w-4" />
            Check
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-muted">
          Ask the seller to show you the sticker under the laptop, or run{" "}
          <span className="font-mono font-semibold">wmic bios get serialnumber</span> (Windows) /
          About This Mac (macOS) / <span className="font-mono font-semibold">dmidecode</span>{" "}
          (Linux). A real seller has nothing to hide.
        </p>
      </Card>

      {checked ? (
        result ? (
          <Card
            className={`mt-4 p-6 ${
              result.status === "reported_stolen"
                ? "border-red-200 ring-2 ring-red-500/20"
                : "border-emerald-200 ring-2 ring-emerald-500/20"
            }`}
          >
            <div className="flex items-start gap-4">
              <span
                className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${
                  result.status === "reported_stolen"
                    ? "bg-red-50 text-red-600"
                    : "bg-emerald-50 text-emerald-600"
                }`}
              >
                {result.status === "reported_stolen" ? (
                  <AlertTriangleIcon className="h-6 w-6" />
                ) : (
                  <CheckCircleIcon className="h-6 w-6" />
                )}
              </span>
              <div>
                <h3
                  className={`text-base font-bold ${
                    result.status === "reported_stolen" ? "text-red-700" : "text-emerald-700"
                  }`}
                >
                  {result.status === "reported_stolen" ? "STOLEN — do not buy" : "Looks clean"}
                </h3>
                {result.brand ? (
                  <p className="mt-1 text-sm text-ink">
                    {result.brand} {result.model}
                    {result.reportedAt ? (
                      <span className="text-ink-muted"> · reported stolen {result.reportedAt}</span>
                    ) : null}
                  </p>
                ) : null}
                <p className="mt-1.5 text-sm text-ink-muted">{result.message}</p>
              </div>
            </div>
          </Card>
        ) : null
      ) : (
        <Card className="mt-4 flex items-start gap-3 p-5 text-sm text-ink-muted">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>
            <span className="font-semibold text-ink">How this helps:</span> sellers can{"'"}t fence
            stolen laptops if every buyer checks first. Listing a device here is free — it{"'"}s the
            market{"'"}s way of cutting the black market at Computer Village and beyond.
          </p>
        </Card>
      )}
    </div>
  );
}
