"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { expressInterest, getListings } from "@/lib/api";
import type { ResaleListing } from "@/lib/api";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  DeviceMobileIcon,
  MapPinIcon,
  RecycleIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import { Card, EmptyState, Logo, SectionTitle } from "@/components/ui";

interface ListingCard {
  deviceId: string;
  type: string | null;
  label: string | null;
  price: number;
  condition: string;
  listedAt: string;
  interestCount: number;
}

type LoadState = "loading" | "ready" | "empty" | "error";

/** Per-card interest form state: idle → typing → sending → sent | failed. */
type InterestState = "idle" | "sending" | "sent" | "failed" | "rate-limited";

const CONDITION_TONES: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  fair: "bg-amber-50 text-amber-700 ring-amber-600/20",
  refurbished: "bg-sky-50 text-sky-700 ring-sky-600/20",
};

function conditionTone(condition: string): string {
  return CONDITION_TONES[condition.trim().toLowerCase()] ?? "bg-slate-100 text-ink-muted";
}

function formatNaira(price: number): string {
  return "₦" + (Number.isFinite(price) ? price : 0).toLocaleString("en-NG");
}

function CardFooter({ card }: { card: ListingCard }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<InterestState>("idle");
  const [note, setNote] = useState("");

  async function submit() {
    if (state === "sending" || state === "sent") return;
    setState("sending");
    setNote("");
    const ok = await expressInterest(card.deviceId, message.trim() || undefined);
    if (ok) {
      setState("sent");
      setOpen(false);
    } else {
      // The sync server rate-limits interest submissions (429) — surface a
      // distinct message so buyers don't spam the button and hit the limiter.
      setState("rate-limited");
      setNote(
        "We couldn't send that right now — interest messages are rate-limited to prevent spam. Please try again in a minute.",
      );
    }
  }

  if (state === "sent") {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
        <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div>
          <p className="font-semibold">Your interest has been sent to the owner.</p>
          <p className="mt-0.5 text-emerald-700">
            They{"'"}ll be notified privately — your identity is never shared.
          </p>
        </div>
      </div>
    );
  }

  if (open) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-2"
      >
        <textarea
          className="input min-h-[72px] resize-none text-sm"
          placeholder="Optional message to the owner (e.g. where you are, when you can meet). Never share your full address or bank details."
          value={message}
          maxLength={280}
          onChange={(e) => {
            setMessage(e.target.value);
            setNote("");
          }}
          aria-label="Message to the owner (optional)"
        />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary flex-1" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Send interest"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setOpen(false);
              setNote("");
            }}
          >
            Cancel
          </button>
        </div>
        {note ? <p className="text-xs text-amber-700">{note}</p> : null}
      </form>
    );
  }

  return (
    <button
      type="button"
      className="btn-secondary w-full"
      onClick={() => setOpen(true)}
      disabled={state === "rate-limited"}
    >
      <ArrowRightIcon className="h-4 w-4" />
      I{"'"}m interested
    </button>
  );
}

export default function MarketplacePage() {
  const [state, setState] = useState<LoadState>("loading");
  const [cards, setCards] = useState<ListingCard[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getListings().then((listings) => {
      if (!alive) return;
      // Defensive: only render well-formed public cards. A malformed listing
      // (missing price/condition) is skipped rather than crashing the page.
      const valid = (listings ?? []).filter(
        (l): l is ResaleListing =>
          !!l && Number.isFinite(Number(l.price)) && typeof l.condition === "string",
      );
      setCards(valid);
      setState(valid.length === 0 ? "empty" : "ready");
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    // Fetch again when the page regains focus so new listings appear without
    // a hard refresh — but never while a buyer is mid-flow (state is per-card).
    const onFocus = () => {
      getListings().then((listings) => {
        if (!alive) return;
        const valid = (listings ?? []).filter(
          (l): l is ResaleListing =>
            !!l && Number.isFinite(Number(l.price)) && typeof l.condition === "string",
        );
        setCards(valid);
        setState((s) => (s === "error" ? (valid.length ? "ready" : "empty") : s));
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* ---------- Nav ---------- */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 lg:px-8">
        <Link href="/" aria-label="Dravex home">
          <Logo />
        </Link>
        <nav
          className="hidden items-center gap-6 text-sm font-medium text-ink-muted md:flex"
          aria-label="Main"
        >
          <Link href="/" className="transition-colors hover:text-ink">
            Home
          </Link>
          <Link href="/dashboard/serial-check" className="transition-colors hover:text-ink">
            Device Check
          </Link>
          <Link
            href="/marketplace"
            className="font-semibold text-primary transition-colors hover:text-primary/80"
          >
            Marketplace
          </Link>
        </nav>
        <Link href="/dashboard" className="btn-secondary hidden sm:inline-flex">
          Owner dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 lg:px-8">
        <SectionTitle
          eyebrow="Second-life market"
          title="Verified resale marketplace"
          action={
            <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              Registry-cleared only
            </span>
          }
        />

        <div className="mb-8 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-ink-muted">
          <RecycleIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>
            Every device here completed the Dravex <strong className="text-ink">ownership transfer</strong> — its
            stolen-registry record is clear, the previous owner{"'"}s data was purged, and it passed a{" "}
            <Link href="/dashboard/serial-check" className="font-semibold text-primary hover:underline">
              Device Check
            </Link>
            . No seller profiles, no checkout — just a private, verified handoff.{" "}
            <strong className="text-ink">Bought or sold here with confidence.</strong>
          </p>
        </div>

        {state === "loading" ? (
          <Card className="p-10 text-center text-sm text-ink-muted">Loading verified listings…</Card>
        ) : null}

        {state === "error" ? (
          <Card className="border-amber-200 p-10 text-center">
            <p className="text-sm font-semibold text-amber-700">The marketplace is unreachable right now.</p>
            <p className="mt-1 text-sm text-ink-muted">
              Listings are served by the live Dravex API. Refresh the page to try again.
            </p>
          </Card>
        ) : null}

        {state === "empty" ? (
          <EmptyState
            icon={<SearchIcon />}
            title="No verified listings yet"
            body="When an owner completes the ownership transfer and lists a device, it appears here — registry-cleared and ready for a safe second life. Check back soon."
          />
        ) : null}

        {state === "ready" ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <Card key={card.deviceId} className="flex flex-col p-6">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                    {card.type === "phone" ? (
                      <DeviceMobileIcon className="h-5 w-5" />
                    ) : (
                      <RecycleIcon className="h-5 w-5" />
                    )}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${conditionTone(
                      card.condition,
                    )}`}
                  >
                    {card.condition}
                  </span>
                </div>

                <h3 className="mt-4 text-lg font-bold text-ink">
                  {card.label ?? (card.type === "phone" ? "A phone" : "A laptop")}
                </h3>
                <p className="mt-0.5 text-xs uppercase tracking-widest text-ink-muted">
                  {card.type === "phone" ? "Phone" : "Laptop"} · verified resale
                </p>

                <p className="mt-4 text-2xl font-bold text-ink">{formatNaira(card.price)}</p>

                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  <span className="inline-flex items-center gap-1">
                    <ClockIcon className="h-3.5 w-3.5" />
                    Listed{" "}
                    {card.listedAt
                      ? new Date(card.listedAt).toLocaleDateString("en-NG", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "recently"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheckIcon className="h-3.5 w-3.5 text-emerald-600" />
                    Registry clean
                  </span>
                </div>

                <div className="mt-auto pt-5">
                  <CardFooter card={card} />
                </div>
              </Card>
            ))}
          </div>
        ) : null}

        <div className="mt-10 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs text-ink-muted">
          <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            <strong className="text-ink">Never send money in advance.</strong> Meet the seller in a
            public place, re-run the Device Check on the IMEI/serial at the point of sale, and
            complete the Dravex transfer together before handing over any payment. Dravex only
            connects buyers and verified sellers — it never handles payments.
          </p>
        </div>
      </main>
    </div>
  );
}
