"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  BellIcon,
  CheckIcon,
  RefreshIcon,
  WifiIcon,
  XMarkIcon,
} from "@/components/icons";
import {
  DEFAULT_SERVER_URL,
  getVapidKey,
  listAlerts,
  markAlertRead,
  sendTestPush,
  subscribePush,
  type AlertItem,
} from "@/lib/api";

/** base64url → Uint8Array, as PushManager.subscribe expects. */
function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type PermState =
  | NotificationPermission
  | "unsupported"
  | "checking"
  | "server-offline"
  | "error";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [perm, setPerm] = useState<PermState>("checking");
  const [busy, setBusy] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /* ---------------- service worker + IndexedDB server-URL handoff ---------------- */

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const writeSwSettings = () => {
      try {
        const open = indexedDB.open("dravex-sw", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("settings")) {
            open.result.createObjectStore("settings");
          }
        };
        open.onsuccess = () => {
          try {
            const tx = open.result.transaction("settings", "readwrite");
            tx.objectStore("settings").put(DEFAULT_SERVER_URL, "serverUrl");
          } catch {
            /* non-fatal */
          }
        };
      } catch {
        /* non-fatal */
      }
    };
    navigator.serviceWorker.register("/sw.js").then(writeSwSettings).catch(() => {});
  }, []);

  /* ---------------- push permission + silent re-subscribe ---------------- */

  const ensureSubscription = useCallback(async (): Promise<PermState> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const publicKey = await getVapidKey();
        if (!publicKey) return "server-offline";
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast needed for TS's typed-array DOM libs (Uint8Array → BufferSource).
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        });
      }
      // If the sync server didn't accept the subscription, don't claim push
      // is on — the UI will ask the user to start the server instead.
      const stored = await subscribePush(sub);
      return stored ? "granted" : "server-offline";
    } catch {
      return "error";
    }
  }, []);

  useEffect(() => {
    if (!("Notification" in window)) {
      setPerm("unsupported");
      return;
    }
    setPerm(Notification.permission);
    if (Notification.permission === "granted") {
      ensureSubscription().then(setPerm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enablePush = async () => {
    if (!("Notification" in window)) return;
    setBusy(true);
    try {
      const granted = (await Notification.requestPermission()) === "granted";
      if (granted) {
        const result = await ensureSubscription();
        setPerm(result);
      } else {
        setPerm("denied");
      }
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- alert polling ---------------- */

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const data = await listAlerts();
      if (cancelled) return;
      setAlerts(data.alerts);
      setUnread(data.unreadCount);
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  /* ---------------- dropdown behaviour ---------------- */

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const readAlert = async (id: string) => {
    await markAlertRead(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
    setUnread((u) => Math.max(0, u - 1));
  };

  const markAllRead = async () => {
    await markAlertRead();
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
    setUnread(0);
  };

  const testPush = async () => {
    setBusy(true);
    setTestNote(null);
    try {
      const ok = await sendTestPush();
      setTestNote(ok ? "Test push sent — check your notification." : "No push subscribed, or server unreachable.");
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- render ---------------- */

  return (
    <div ref={rootRef} className="relative">
      <button
        className="relative rounded-lg p-2 text-ink-muted transition-colors hover:bg-slate-100 hover:text-ink"
        onClick={() => {
          setTestNote(null);
          setOpen((o) => !o);
        }}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-slate-200" />
        )}
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lift sm:w-96">
          {/* header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <div className="flex items-center gap-1">
              {alerts.length > 0 ? (
                <button
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
                  onClick={markAllRead}
                >
                  <CheckIcon className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              ) : null}
              <button
                className="rounded-lg p-1.5 text-ink-muted hover:bg-slate-100"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* body */}
          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <BellIcon className="mx-auto h-6 w-6 text-slate-300" />
                <p className="mt-2 text-sm text-ink-muted">No alerts yet.</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Reconnects and SIM changes will show up here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {alerts.map((a) => (
                  <li key={a.id}>
                    <button
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                      onClick={() => readAlert(a.id)}
                    >
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                          a.type === "sim_change"
                            ? "bg-red-50 text-red-500"
                            : "bg-sky-50 text-sky-500"
                        }`}
                      >
                        {a.type === "sim_change" ? (
                          <AlertTriangleIcon className="h-4 w-4" />
                        ) : (
                          <WifiIcon className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span
                            className={`truncate text-sm ${
                              a.read ? "font-normal text-ink-muted" : "font-semibold text-ink"
                            }`}
                          >
                            {a.hostname}
                          </span>
                          {!a.read ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">
                          {a.body}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] text-ink-faint">
                          {new Date(a.at).toLocaleString("en-NG")}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* footer: push controls */}
          <div className="border-t border-slate-100 px-4 py-3">
            {perm === "unsupported" ? (
              <p className="text-xs text-ink-faint">
                Desktop notifications aren&apos;t supported in this browser.
              </p>
            ) : perm === "denied" ? (
              <p className="text-xs text-ink-faint">
                Notifications are blocked — allow them in your browser settings to get alerts
                when a device comes back online.
              </p>
            ) : perm === "granted" ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Push alerts on
                </span>
                <button
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-slate-50"
                  onClick={testPush}
                  disabled={busy}
                >
                  <RefreshIcon className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                  Send test
                </button>
              </div>
            ) : (
              <button
                className="btn-primary w-full justify-center"
                onClick={enablePush}
                disabled={busy}
              >
                {perm === "server-offline" ? "Start sync server to enable" : "Enable push alerts"}
              </button>
            )}
            {testNote ? <p className="mt-2 text-xs text-ink-faint">{testNote}</p> : null}
            <Link
              href="/dashboard/agents"
              className="mt-2 block text-center text-xs font-medium text-primary hover:text-primary-dark"
              onClick={() => setOpen(false)}
            >
              View all agents →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
