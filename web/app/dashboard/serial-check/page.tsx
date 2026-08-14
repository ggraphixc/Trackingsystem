"use client";

import Link from "next/link";
import { useState } from "react";
import { checkStolenRegistry } from "@/lib/api";
import type { RegistryVerdict } from "@/lib/api";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  RefreshIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import { Card, SectionTitle } from "@/components/ui";

const INPUT_KINDS = [
  {
    key: "imei",
    label: "Phone IMEI",
    hint: "15 digits — dial *#06# on the phone, or check the box / SIM tray",
    placeholder: "e.g. 354988071234567",
  },
  {
    key: "serial",
    label: "Laptop serial",
    hint: "Sticker under the laptop, or wmic bios get serialnumber (Windows)",
    placeholder: "e.g. XPS9530-B7F2K1",
  },
] as const;

type Kind = (typeof INPUT_KINDS)[number]["key"];

export default function SerialCheckPage() {
  const [kind, setKind] = useState<Kind>("imei");
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<RegistryVerdict | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 6) return;
    setState("loading");
    const res = await checkStolenRegistry(q);
    if (res) {
      setVerdict(res);
      setState("done");
    } else {
      setState("error");
      setError("The registry is unreachable right now — is the Dravex server online?");
    }
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <SectionTitle
        eyebrow="Buyer protection"
        title="Device Check"
        action={
          <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            Free forever
          </span>
        }
      />

      <Card className="p-6">
        <p className="mb-4 text-sm text-ink-muted">
          Buying a used phone or laptop? Run its <strong className="text-ink">IMEI</strong> or{" "}
          <strong className="text-ink">serial number</strong> against the Dravex stolen-device
          registry before you pay.{" "}
          <span className="font-semibold text-ink">Computer Village, be safe out there.</span>
        </p>

        <div className="mb-3 flex gap-2">
          {INPUT_KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => {
                setKind(k.key);
                setState("idle");
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                kind === k.key
                  ? "bg-primary text-white"
                  : "bg-slate-100 text-ink-muted hover:bg-slate-200"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <form onSubmit={lookup} className="flex gap-2">
          <input
            className="input font-mono uppercase"
            placeholder={INPUT_KINDS.find((k) => k.key === kind)?.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`${kind === "imei" ? "IMEI" : "Serial number"} to check`}
          />
          <button
            type="submit"
            className="btn-secondary shrink-0"
            disabled={query.trim().length < 6 || state === "loading"}
          >
            {state === "loading" ? (
              <RefreshIcon className="h-4 w-4 animate-spin" />
            ) : (
              <SearchIcon className="h-4 w-4" />
            )}
            Check
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-muted">
          {INPUT_KINDS.find((k) => k.key === kind)?.hint} — a real seller has nothing to hide.
        </p>
      </Card>

      {state === "error" ? (
        <Card className="mt-4 border-amber-200 p-6">
          <p className="text-sm font-semibold text-amber-700">{error}</p>
          <p className="mt-1 text-sm text-ink-muted">
            The check is served by the live registry. Try again shortly.
          </p>
        </Card>
      ) : null}

      {state === "done" && verdict ? (
        <Card
          className={`mt-4 p-6 ${
            verdict.status === "reported_stolen"
              ? "border-red-200 ring-2 ring-red-500/20"
              : "border-emerald-200 ring-2 ring-emerald-500/20"
          }`}
        >
          <div className="flex items-start gap-4">
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${
                verdict.status === "reported_stolen"
                  ? "bg-red-50 text-red-600"
                  : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {verdict.status === "reported_stolen" ? (
                <AlertTriangleIcon className="h-6 w-6" />
              ) : (
                <CheckCircleIcon className="h-6 w-6" />
              )}
            </span>
            <div>
              <h3
                className={`text-base font-bold ${
                  verdict.status === "reported_stolen" ? "text-red-700" : "text-emerald-700"
                }`}
              >
                {verdict.status === "reported_stolen" ? "STOLEN — do not buy" : "Looks clean"}
              </h3>
              {verdict.label ? (
                <p className="mt-1 text-sm text-ink">
                  {verdict.label}
                  {verdict.type ? (
                    <span className="text-ink-muted">
                      {" "}
                      · {verdict.type === "phone" ? "phone" : "laptop"}
                    </span>
                  ) : null}
                  {verdict.reportedAt ? (
                    <span className="text-ink-muted">
                      {" "}
                      · reported stolen{" "}
                      {new Date(verdict.reportedAt).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <p className="mt-1.5 text-sm text-ink-muted">{verdict.message}</p>
              {verdict.status === "reported_stolen" ? (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">
                  Report it to the nearest police station or the NPF Cybercrime e-portal
                  (nccc.npf.gov.ng) — the IMEI can be traced by carriers once a new SIM is
                  inserted.
                </p>
              ) : null}

              {/* N5: verified resale listing — the legitimate second-life market */}
              {verdict.resaleReady && verdict.listing ? (
                <Link
                  href="/marketplace"
                  className="mt-4 block rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 transition-colors duration-200 hover:bg-emerald-50"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                    <ShieldCheckIcon className="h-4 w-4" />
                    Verified resale-ready
                  </p>
                  <p className="mt-1 text-xs text-emerald-700">
                    This device went through the Dravex ownership transfer — registry clean, previous
                    owner{"'"}s data purged. It is listed by its current owner for{" "}
                    <strong>₦{verdict.listing.price.toLocaleString("en-NG")}</strong>{" "}
                    (condition: {verdict.listing.condition}). Legitimate sellers have nothing to hide.
                  </p>
                  <p className="mt-2 text-xs font-semibold text-primary">View it in the marketplace →</p>
                </Link>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {state === "idle" || state === "loading" ? (
        <Card className="mt-4 flex items-start gap-3 p-5 text-sm text-ink-muted">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>
            <span className="font-semibold text-ink">How this helps:</span> sellers can{"'"}t fence
            stolen devices if every buyer checks first. When an owner marks a device lost in their
            dashboard, it is listed here automatically — no extra steps. It{"'"}s the market{"'"}s way
            of cutting the black market at Computer Village and beyond.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
