"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getPublicRecovery, sendFinderMessage } from "@/lib/api";
import type { PublicRecovery } from "@/lib/api";
import { CheckCircleIcon, DeviceMobileIcon, ShieldCheckIcon } from "@/components/icons";
import { Logo } from "@/components/ui";

export default function PublicRecoveryPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<PublicRecovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    getPublicRecovery(id).then((d) => {
      if (!alive) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  async function submit() {
    if (message.trim().length < 5) {
      setNote("Please write a short message (at least 5 characters).");
      return;
    }
    setBusy(true);
    const ok = await sendFinderMessage(id, message.trim());
    setBusy(false);
    if (ok) {
      setSent(true);
      setNote("");
    } else {
      setNote("Could not send — please try again in a minute (messages are rate-limited).");
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="text-center text-sm text-ink-muted">Loading…</div>
      </main>
    );
  }

  if (!data || !data.lost) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
          <Logo />
          <p className="mt-6 text-sm text-ink-muted">
            This recovery link is not active. If you found a device, you can still check whether it
            was reported stolen before buying or keeping it.
          </p>
          <Link href="/dashboard/serial-check" className="btn-primary mt-5 inline-flex">
            Check a device (IMEI / serial)
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-card">
        <div className="flex items-center justify-between">
          <Logo />
          <span className="chip bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">Reported lost</span>
        </div>

        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-600">
              <DeviceMobileIcon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-base font-bold text-red-900">This device has been reported lost</h1>
              <p className="mt-1 text-sm text-red-700">
                {data.label ?? "A device"} registered with Dravex. If you found it, the owner is
                trying to recover it — your message below reaches them privately, without exposing
                your identity or theirs.
              </p>
            </div>
          </div>
        </div>

        {data.recoveryMessage ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Message from the owner</p>
            <p className="mt-2 text-sm text-ink">“{data.recoveryMessage.message}”</p>
            {data.recoveryMessage.contactPreference ? (
              <p className="mt-2 text-xs text-ink-muted">{data.recoveryMessage.contactPreference}</p>
            ) : null}
          </div>
        ) : null}

        {sent ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <CheckCircleIcon className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-2 text-sm font-semibold text-emerald-800">Message sent</p>
            <p className="mt-1 text-xs text-emerald-700">
              The owner has been notified privately. Neither your identity nor contact details were
              shared — thank you for helping return this device.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5">
              <label htmlFor="finder-message" className="mb-1 block text-xs font-medium text-ink-muted">
                I found this device — tell the owner
              </label>
              <textarea
                id="finder-message"
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                rows={3}
                maxLength={280}
                placeholder="e.g. I found this phone at Computer Village, Ikeja. How can I return it to you?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              {note ? <p className="mt-1 text-xs text-amber-700">{note}</p> : null}
              <button className="btn-primary mt-3 w-full justify-center" onClick={submit} disabled={busy}>
                {busy ? "Sending…" : "Send message to the owner"}
              </button>
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
              <ShieldCheckIcon className="h-3.5 w-3.5" />
              Privacy-first relay — the owner never sees your identity, and you never see theirs.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
