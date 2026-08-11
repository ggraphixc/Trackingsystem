"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_SERVER_URL,
  checkServerHealth,
  getSettings,
  listDevices,
  registerPair,
  saveSettings,
  sendCommand,
  sendTestSms,
} from "@/lib/api";
import type { PairedDevice, ServerSettings } from "@/lib/api";
import DeviceAlerts from "@/components/device-alerts";
import {
  AlarmIcon,
  CrosshairIcon,
  EyeIcon,
  LockClosedIcon,
  PhoneIcon,
  RefreshIcon,
  ServerIcon,
  WifiIcon,
} from "@/components/icons";
import { Card, SectionTitle } from "@/components/ui";

const SOURCE_LABEL: Record<string, string> = {
  wifi: "Wi-Fi positioning",
  ip: "IP geolocation",
  last_known: "Last known",
};

const PLATFORM_LABEL: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
};

export default function AgentsPage() {
  const [server, setServer] = useState<{ ok: boolean; devices: number } | null>(null);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [pendingCmd, setPendingCmd] = useState<string | null>(null);
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [smsPhone, setSmsPhone] = useState("");
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsNote, setSmsNote] = useState("");

  const load = useCallback(async () => {
    setServer(await checkServerHealth());
    setDevices(await listDevices());
    const next = await getSettings();
    if (next) setSettings(next);
  }, []);

  const flash = (msg: string) => {
    setSmsNote(msg);
    setTimeout(() => setSmsNote(""), 6000);
  };

  async function saveSms() {
    setSmsBusy(true);
    const res = await saveSettings({ ownerPhone: smsPhone.trim(), smsEnabled: true });
    setSmsBusy(false);
    if (res) {
      setSettings(res);
      setSmsPhone(res.ownerPhone);
      flash("Saved — the server will text this number when a device reconnects or its SIM changes.");
    } else {
      flash("Could not save — is the sync server running?");
    }
  }

  async function toggleSms() {
    const enabled = !settings?.smsEnabled;
    const res = await saveSettings({ smsEnabled: enabled });
    if (res) setSettings(res);
  }

  async function testSms() {
    setSmsBusy(true);
    const res = await sendTestSms();
    setSmsBusy(false);
    if (res?.ok) {
      flash(
        res.mode === "log"
          ? "Test queued in log mode — add Twilio or Termii credentials to the server env to send for real."
          : `Test SMS sent via ${res.mode}.`,
      );
    } else {
      flash("Test failed — server unreachable, or set a phone number first.");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // live-ish refresh
    return () => clearInterval(t);
  }, [load]);

  async function makeCode() {
    setBusy(true);
    const result = await registerPair("laptop");
    setBusy(false);
    if (result) {
      setCode(result.code);
    } else {
      setToast("Server unreachable — start it with: cd server && npm start");
      setCode("");
    }
  }

  async function command(deviceId: string, type: "lock" | "alarm" | "webcam", label: string) {
    setPendingCmd(deviceId);
    const ok = await sendCommand(deviceId, type);
    setPendingCmd(null);
    setToast(ok ? `${label} command sent to ${deviceId.slice(0, 8)}` : "Command failed — server offline?");
    setTimeout(() => setToast(""), 4000);
  }

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Agent sync"
        title="Agents & live sync"
        action={
          <button className="btn-ghost" onClick={load}>
            <RefreshIcon className="h-4 w-4" />
            Refresh
          </button>
        }
      />

      {toast ? (
        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
          {toast}
        </div>
      ) : null}

      {/* Reconnect banner + device activity — shared with the Overview page */}
      <DeviceAlerts devices={devices} />

      {/* Server status */}
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          <span
            className={`grid h-10 w-10 place-items-center rounded-xl ${
              server?.ok ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
            }`}
          >
            <ServerIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold text-ink">
              {server?.ok ? "Sync server online" : "Sync server unreachable"}
            </p>
            <p className="font-mono text-xs text-ink-muted">{DEFAULT_SERVER_URL}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-ink">{devices.length}</p>
          <p className="text-xs text-ink-muted">linked agents</p>
        </div>
      </Card>

      {/* SMS fallback alerts */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <PhoneIcon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">SMS fallback alerts</h3>
              <p className="mt-1 max-w-md text-sm text-ink-muted">
                Text the owner when a device surfaces online or its SIM changes — for when push
                can{"'"}t reach them (browser closed, no data). Provider:{" "}
                <span className="font-mono text-xs">{settings?.sms.provider ?? "—"}</span>
                {settings?.sms.lastSentAt
                  ? ` · last ${new Date(settings.sms.lastSentAt).toLocaleString("en-NG")}`
                  : ""}
              </p>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
              checked={settings?.smsEnabled ?? true}
              onChange={toggleSms}
            />
            SMS alerts {settings?.smsEnabled ? "on" : "off"}
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            className="input min-w-56 flex-1"
            placeholder={settings?.sms.ownerPhone ?? "+2348012345678"}
            inputMode="tel"
            value={smsPhone}
            onChange={(e) => setSmsPhone(e.target.value)}
            aria-label="Owner phone number for SMS alerts"
          />
          <button className="btn-secondary" onClick={saveSms} disabled={smsBusy}>
            {smsBusy ? "Saving…" : "Save & enable"}
          </button>
          <button
            className="btn-ghost"
            onClick={testSms}
            disabled={smsBusy || !settings?.ownerPhone}
          >
            Send test SMS
          </button>
        </div>
        {smsNote ? <p className="mt-2 text-xs text-ink-faint">{smsNote}</p> : null}
        <p className="mt-3 text-xs text-ink-faint">
          No provider configured? The server logs the message locally (log mode). Add{" "}
          <span className="font-mono">TWILIO_ACCOUNT_SID / AUTH_TOKEN / PHONE_NUMBER</span> or{" "}
          <span className="font-mono">TERMII_API_KEY / FROM</span> to the server env to send for real.
        </p>
      </Card>

      {/* Pairing */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-md">
            <h3 className="text-sm font-semibold text-ink">Link a new agent</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Generate a pairing code, then enter it in the agent{"'"}s <em>Link to dashboard</em>{" "}
              card. The agent streams fixes and evidence here automatically.
            </p>
          </div>
          <button className="btn-secondary" onClick={makeCode} disabled={busy}>
            <CrosshairIcon className="h-4 w-4" />
            {busy ? "Generating…" : "Generate pairing code"}
          </button>
        </div>
        {code ? (
          <div className="mt-4 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-center">
            <p className="text-xs uppercase tracking-widest text-ink-muted">Enter this code in the agent</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-primary">{code}</p>
            <button
              className="btn-ghost mt-2 text-xs"
              onClick={() => navigator.clipboard.writeText(code).catch(() => {})}
            >
              Copy code
            </button>
          </div>
        ) : null}
      </Card>

      {/* Paired devices */}
      {devices.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-muted">
          No agents linked yet. Install the TrackNaija agent on a laptop, start the sync server
          (<span className="font-mono">cd server && npm start</span>), generate a code above, and
          enter it in the agent.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {devices.map((d) => {
            const fix = d.lastFix;
            const src = fix ? SOURCE_LABEL[fix.source] : "No fix yet";
            const lastSeenMs = d.lastSeenAt ? Date.now() - new Date(d.lastSeenAt).getTime() : Infinity;
            const offlineH = lastSeenMs / 3.6e6;
            const offline = lastSeenMs > 6 * 3.6e6;
            const reconnectedRecently =
              d.reconnectedAt != null && Date.now() - new Date(d.reconnectedAt).getTime() < 3.6e6;
            return (
              <Card key={d.deviceId} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{d.hostname ?? "Unknown host"}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                      Serial {d.serialNumber ?? "—"} · {PLATFORM_LABEL[d.platform ?? ""] ?? d.platform ?? "—"}
                      {d.imei ? ` · IMEI ${d.imei}` : ""}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                      ID {d.deviceId.slice(0, 12)}
                    </p>
                  </div>
                  {offline ? (
                    <span className="chip bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20">
                      offline · data off?
                    </span>
                  ) : reconnectedRecently ? (
                    <span className="chip bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20">
                      reconnected
                    </span>
                  ) : (
                    <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      linked
                    </span>
                  )}
                </div>

                {offline ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 text-xs text-amber-800">
                    <p className="font-medium">
                      No signal for {offlineH < 24 ? `${Math.round(offlineH)} hours` : `${Math.round(offlineH / 24)} days`}.
                    </p>
                    <p className="mt-1 text-amber-700">
                      Data off doesn't stop the carrier or Find My Device. Generate the police report,
                      carrier cell-location request and IMEI blacklist letters.
                    </p>
                    <Link href="/dashboard/offline-recovery" className="mt-2 inline-flex items-center gap-1.5 font-semibold text-primary">
                      <WifiIcon className="h-3.5 w-3.5" />
                      Open offline recovery kit
                    </Link>
                  </div>
                ) : null}

                {fix ? (
                  <div className="mt-4 rounded-xl bg-slate-50 p-3.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-ink">{src}</p>
                      <span className="chip bg-primary/10 text-primary">
                        ±{fix.accuracy} m · {fix.confidence}% conf
                      </span>
                    </div>
                    <p className="mt-1.5 font-mono text-[11px] text-ink-muted">
                      {fix.lat.toFixed(4)}°, {fix.lng.toFixed(4)}°
                      {fix.ipAddress ? ` · ${fix.ipAddress}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {fix.timestamp ? new Date(fix.timestamp).toLocaleString("en-NG") : "—"}
                      {d.lastSeenAt ? ` · last seen ${new Date(d.lastSeenAt).toLocaleTimeString()}` : ""}
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-ink-faint">Waiting for the first location fix…</p>
                )}

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
                  <button
                    className="btn-ghost !px-2 text-xs"
                    disabled={pendingCmd === d.deviceId}
                    onClick={() => command(d.deviceId, "webcam", "Webcam capture")}
                  >
                    <EyeIcon className="h-4 w-4 text-accent" /> Webcam
                  </button>
                  <button
                    className="btn-ghost !px-2 text-xs"
                    disabled={pendingCmd === d.deviceId}
                    onClick={() => command(d.deviceId, "alarm", "Alarm")}
                  >
                    <AlarmIcon className="h-4 w-4 text-accent" /> Alarm
                  </button>
                  <button
                    className="btn-ghost !px-2 text-xs"
                    disabled={pendingCmd === d.deviceId}
                    onClick={() => command(d.deviceId, "lock", "Lock")}
                  >
                    <LockClosedIcon className="h-4 w-4 text-primary" /> Lock
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-ink-faint">
                  {d.commandCount} command{d.commandCount === 1 ? "" : "s"} queued · {d.evidenceCount}{" "}
                  evidence photo{d.evidenceCount === 1 ? "" : "s"}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
