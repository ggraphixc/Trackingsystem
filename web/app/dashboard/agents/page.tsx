"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_SERVER_URL,
  checkServerHealth,
  forgotPassword,
  getMe,
  getOwnerKey,
  getSessionToken,
  getSettings,
  listDevices,
  loginAccount,
  logoutAccount,
  registerAccount,
  resetPassword,
  registerPair,
  saveSettings,
  sendCommand,
  sendTestSms,
  setDeviceLost,
  setOwnerKey,
} from "@/lib/api";
import type { PairedDevice, ServerSettings, SessionUser } from "@/lib/api";
import DeviceAlerts from "@/components/device-alerts";
import {
  AlarmIcon,
  AlertTriangleIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  EyeIcon,
  LockClosedIcon,
  MapPinIcon,
  PhoneIcon,
  RefreshIcon,
  ServerIcon,
  SignalIcon,
  UserIcon,
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
  const [pendingLost, setPendingLost] = useState<string | null>(null);
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [smsPhone, setSmsPhone] = useState("");
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsNote, setSmsNote] = useState("");
  const [ownerKey, setOwnerKeyInput] = useState(getOwnerKey());
  const [ownerKeyBusy, setOwnerKeyBusy] = useState(false);
  const [ownerKeyNote, setOwnerKeyNote] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountNote, setAccountNote] = useState("");
  const [resetStep, setResetStep] = useState<"idle" | "sent">("idle");
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPw, setResetPw] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNote, setResetNote] = useState("");

  const load = useCallback(async () => {
    setServer(await checkServerHealth());
    setDevices(await listDevices());
    const next = await getSettings();
    if (next) setSettings(next);
    // Only probe the session when one is actually stored — otherwise the 8s
    // poll fires a 401 every 8s and inflates the server's auth-anomaly count.
    if (getSessionToken()) setUser(await getMe());
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
    const result = await registerPair("device");
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

  async function toggleLost(device: PairedDevice) {
    setPendingLost(device.deviceId);
    const res = await setDeviceLost(device.deviceId, !device.lost);
    setPendingLost(null);
    if (res?.ok) {
      setToast(
        !device.lost
          ? `${device.hostname ?? "Device"} marked lost — community beacon active${
              res.recoveryCode
                ? ` · recovery code ${res.recoveryCode} (unlocks the app if the phone comes back)`
                : ""
            }.`
          : `${device.hostname ?? "Device"} marked found.`,
      );
      setTimeout(() => setToast(""), 5000);
      load();
    } else {
      setToast("Could not update lost status — server offline?");
      setTimeout(() => setToast(""), 4000);
    }
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
          <p className="text-xs text-ink-muted">linked devices</p>
        </div>
      </Card>

      {/* Owner account — Phase 2.5 per-owner model */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
              <UserIcon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">Owner account</h3>
              <p className="mt-1 max-w-lg text-sm text-ink-muted">
                {user
                  ? `Signed in as ${user.email} — you see only your own devices, and pairing codes you generate are claimed by you.`
                  : "Create or log into an account so this dashboard is scoped to you. Without one, the dashboard behaves as the shared owner (legacy mode)."}
              </p>
            </div>
          </div>
          {user ? (
            <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              {user.deviceCount} device{user.deviceCount === 1 ? "" : "s"} · {user.role}
            </span>
          ) : (
            <span className="chip bg-slate-100 text-slate-600">not signed in</span>
          )}
        </div>
        {user ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <p className="flex-1 font-mono text-xs text-ink-faint">
              account id {user.userId?.slice(0, 12)} · joined{" "}
              {user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-NG") : "—"}
            </p>
            <button
              className="btn-ghost"
              disabled={accountBusy}
              onClick={async () => {
                setAccountBusy(true);
                await logoutAccount();
                setUser(null);
                setAccountBusy(false);
                setAccountNote("Signed out — this browser no longer sends an account session.");
                load();
              }}
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              className="input min-w-48 flex-1"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Account email"
            />
            <input
              className="input min-w-48 flex-1"
              type="password"
              placeholder="Password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Account password"
            />
            <button
              className="btn-secondary"
              disabled={accountBusy || !email || !password}
              onClick={async () => {
                setAccountBusy(true);
                const res = await registerAccount(email.trim(), password);
                setAccountBusy(false);
                if (res.ok) {
                  setAccountNote(`Account created — signed in as ${email.trim()}.`);
                  setEmail("");
                  setPassword("");
                  load();
                } else {
                  setAccountNote(res.error ?? "Could not create account.");
                }
              }}
            >
              Create account
            </button>
            <button
              className="btn-ghost"
              disabled={accountBusy || !email || !password}
              onClick={async () => {
                setAccountBusy(true);
                const res = await loginAccount(email.trim(), password);
                setAccountBusy(false);
                if (res.ok) {
                  setAccountNote(`Signed in as ${email.trim()}.`);
                  setEmail("");
                  setPassword("");
                  load();
                } else {
                  setAccountNote(res.error ?? "Could not log in.");
                }
              }}
            >
              Log in
            </button>
          </div>
        )}
        {accountNote ? <p className="mt-2 text-xs text-ink-faint">{accountNote}</p> : null}

        {!user ? (
          <div className="mt-3 border-t border-slate-100 pt-3">
            {resetStep === "idle" ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input min-w-48 flex-1"
                  type="email"
                  placeholder="Forgot password — enter your account email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  aria-label="Reset-password email"
                />
                <button
                  className="btn-ghost text-xs"
                  disabled={resetBusy || !resetEmail}
                  onClick={async () => {
                    setResetBusy(true);
                    const res = await forgotPassword(resetEmail.trim());
                    setResetBusy(false);
                    if (res.ok) {
                      setResetStep("sent");
                      setResetNote(
                        res.deliveredVia === "webhook"
                          ? "If that account exists, a reset link was sent via the alert webhook (webhook-to-email)."
                          : "If that account exists, a reset code was written to the server console (log mode) — paste it below.",
                      );
                    } else {
                      setResetNote(res.error ?? "Could not request a reset.");
                    }
                  }}
                >
                  {resetBusy ? "Requesting…" : "Request reset"}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input min-w-40 flex-1 font-mono"
                  placeholder="Reset code"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  aria-label="Reset code"
                />
                <input
                  className="input min-w-40 flex-1"
                  type="password"
                  placeholder="New password (8+ characters)"
                  value={resetPw}
                  onChange={(e) => setResetPw(e.target.value)}
                  aria-label="New password"
                />
                <button
                  className="btn-secondary text-xs"
                  disabled={resetBusy || !resetToken || resetPw.length < 8}
                  onClick={async () => {
                    setResetBusy(true);
                    const res = await resetPassword(resetToken.trim(), resetPw);
                    setResetBusy(false);
                    if (res.ok) {
                      setResetStep("idle");
                      setResetToken("");
                      setResetPw("");
                      setResetNote("Password reset — you're signed in with the new password.");
                      load();
                    } else {
                      setResetNote(res.error ?? "Could not reset the password.");
                    }
                  }}
                >
                  {resetBusy ? "Resetting…" : "Set new password"}
                </button>
                <button className="btn-ghost text-xs" onClick={() => { setResetStep("idle"); setResetNote(""); }}>
                  Cancel
                </button>
              </div>
            )}
            {resetNote ? <p className="mt-2 text-xs text-ink-faint">{resetNote}</p> : null}
          </div>
        ) : null}
      </Card>

      {/* Server security — optional owner key for DRAVEX_OWNER_KEY auth */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
              <LockClosedIcon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">Server security — owner key</h3>
              <p className="mt-1 max-w-lg text-sm text-ink-muted">
                If your sync server runs with <span className="font-mono text-xs">DRAVEX_OWNER_KEY</span> set,
                enter it here so this dashboard can read devices, mark lost, and view alerts. Stored in this
                browser only. Without a key (Phase-1 default) the dashboard works as before.
              </p>
            </div>
          </div>
          <span className="chip bg-slate-100 text-slate-600">
            {ownerKey ? "key set on this browser" : "no key set"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            className="input min-w-56 flex-1 font-mono"
            type="password"
            placeholder="Owner key (leave empty to clear)"
            value={ownerKey}
            onChange={(e) => setOwnerKeyInput(e.target.value)}
            aria-label="Owner key"
          />
          <button
            className="btn-secondary"
            disabled={ownerKeyBusy}
            onClick={() => {
              setOwnerKeyBusy(true);
              setOwnerKey(ownerKey.trim());
              setOwnerKeyBusy(false);
              setOwnerKeyNote(
                ownerKey.trim()
                  ? "Saved — owner-only requests now send this key."
                  : "Cleared — requests are sent without auth.",
              );
              load();
            }}
          >
            Save owner key
          </button>
        </div>
        {ownerKeyNote ? <p className="mt-2 text-xs text-ink-faint">{ownerKeyNote}</p> : null}
        <p className="mt-3 text-xs text-ink-faint">
          Devices list empty while the server shows online? Your server may require the owner key — set it above
          and refresh.
        </p>
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
            <h3 className="text-sm font-semibold text-ink">Link a new device</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Generate a pairing code, then enter it in the agent{"'"}s <em>Link to dashboard</em>{" "}
              card — on the Android app or the desktop agent. The device streams fixes and evidence
              here automatically.
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
          No devices linked yet. Install the Dravex agent on your <strong>phone</strong> (Android
          app — catches SIM swaps and works with data off) or <strong>laptop</strong> (desktop agent),
          generate a code above, and enter it in the app.
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
            const isPhone = d.type === "phone";
            const sightings = (d.sightings ?? []).slice(0, 3);
            return (
              <Card
                key={d.deviceId}
                className={`p-5 ${d.lost ? "ring-1 ring-inset ring-red-400/40" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                          isPhone ? "bg-primary/10 text-primary" : "bg-violet-50 text-violet-600"
                        }`}
                      >
                        {isPhone ? (
                          <DeviceMobileIcon className="h-5 w-5" />
                        ) : (
                          <SignalIcon className="h-5 w-5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{d.hostname ?? "Unknown device"}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                          {isPhone ? "Phone" : "Laptop"} · {PLATFORM_LABEL[d.platform ?? ""] ?? d.platform ?? "—"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-ink-faint">
                      {isPhone ? "IMEI" : "Serial"} {isPhone ? d.imei ?? "—" : d.serialNumber ?? "—"}
                      {isPhone && d.operator ? ` · ${d.operator}` : ""}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                      ID {d.deviceId.slice(0, 12)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {d.lost ? (
                      <span className="chip bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
                        lost · beacon active
                      </span>
                    ) : offline ? (
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
                    {isPhone && fix?.battery != null ? (
                      <span className="chip bg-slate-100 text-slate-600">🔋 {fix.battery}%</span>
                    ) : null}
                  </div>
                </div>

                {offline ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 text-xs text-amber-800">
                    <p className="font-medium">
                      No signal for {offlineH < 24 ? `${Math.round(offlineH)} hours` : `${Math.round(offlineH / 24)} days`}.
                    </p>
                    <p className="mt-1 text-amber-700">
                      Data off doesn't stop the community beacon — a nearby Dravex phone can still
                      hear it. And the carrier + police can still trace the IMEI.
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
                    {Array.isArray(fix.networks) && fix.networks.length > 0 ? (
                      <p className="mt-1.5 truncate text-[11px] text-ink-faint">
                        Wi-Fi fingerprint:{" "}
                        {fix.networks
                          .slice(0, 3)
                          .map((n) => n.ssid ?? n.bssid)
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-ink-faint">Waiting for the first location fix…</p>
                )}

                {/* Community sightings — a Dravex phone heard its beacon */}
                {sightings.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/60 p-3.5">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-violet-700">
                      <MapPinIcon className="h-3.5 w-3.5" />
                      Seen by the community ({d.sightingCount} total)
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {sightings.map((s, i) => (
                        <li key={`${s.receivedAt}-${i}`} className="flex items-center justify-between gap-2 text-[11px] text-violet-800">
                          <span className="truncate font-mono">
                            {s.lat.toFixed(4)}°, {s.lng.toFixed(4)}°
                          </span>
                          <span className="shrink-0 text-violet-500">
                            {new Date(s.at).toLocaleString("en-NG")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-100 pt-4">
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
                  <button
                    className={`btn-ghost !px-2 text-xs ${d.lost ? "!border-red-300 !bg-red-50 !text-red-700" : ""}`}
                    disabled={pendingLost === d.deviceId}
                    onClick={() => toggleLost(d)}
                  >
                    <CrosshairIcon className={`h-4 w-4 ${d.lost ? "text-red-600" : "text-ink-faint"}`} />
                    {d.lost ? "Found" : "Lost"}
                  </button>
                </div>
                {d.lost ? (
                  <Link
                    href={`/dashboard/recovery/${d.deviceId}`}
                    className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition-colors duration-200 hover:bg-red-100"
                  >
                    <AlertTriangleIcon className="h-3.5 w-3.5" />
                    Open recovery view
                  </Link>
                ) : null}
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
