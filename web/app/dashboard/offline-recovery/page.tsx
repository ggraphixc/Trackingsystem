"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listDevices } from "@/lib/api";
import type { PairedDevice } from "@/lib/api";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  EyeIcon,
  MapPinIcon,
  PhoneIcon,
  SearchIcon,
  ShieldCheckIcon,
  SignalIcon,
  WifiIcon,
} from "@/components/icons";
import { Card, SectionTitle } from "@/components/ui";

const MNOS = ["MTN Nigeria", "Airtel Nigeria", "Globacom (Glo)", "9mobile"];

const TIERS = [
  {
    icon: SignalIcon,
    title: "Carrier tower triangulation",
    text: "A phone with a SIM and power ON must register with cell towers for calls/SMS — mobile data off changes nothing. MTN/Airtel/Glo/9mobile can pinpoint it. This is the strongest offline channel: trigger it through the NPF-NCCC complaint + carrier request kit below.",
    accent: "bg-primary/10 text-primary",
  },
  {
    icon: WifiIcon,
    title: "Find My Device offline network",
    text: "If Bluetooth is on and offline finding is enabled, nearby Android devices relay your phone's beacon using THEIR internet — your phone's data/Wi-Fi being off is irrelevant.",
    accent: "bg-sky-50 text-sky-600",
  },
  {
    icon: EyeIcon,
    title: "Offline evidence vault (our agent)",
    text: "The Dravex agent keeps capturing webcam photos, fixes and SIM-change events locally while offline. The moment the phone touches ANY network, everything uploads in one burst and the dashboard alerts.",
    accent: "bg-amber-50 text-amber-600",
  },
  {
    icon: ShieldCheckIcon,
    title: "IMEI blacklist (NCC-DMS/CEIR)",
    text: "Blacklist the IMEI across ALL Nigerian networks with a police report + proof of purchase + ID. The phone becomes a brick — worthless to resell — killing the market that drives theft.",
    accent: "bg-emerald-50 text-emerald-600",
  },
  {
    icon: MapPinIcon,
    title: "Community BLE relay (our network)",
    text: "Your phone's agent broadcasts a Bluetooth beacon while it's on — even with the SIM out and data/Wi-Fi off. Any OTHER Dravex phone nearby hears it and reports a sighting with its own GPS. Mark the device LOST on the Agents page to activate alerts. Works while the phone is on; a fully powered-off phone emits nothing (that needs Pixel 8/9-class hardware + Google/Apple's closed networks).",
    accent: "bg-violet-50 text-violet-600",
  },
];

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3.6e6;
}

function copy(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function Kit({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {step}
        </span>
        <div>
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function DocBlock({ text, label }: { text: string; label: string }) {
  if (!text) return null;
  return (
    <div className="mt-4">
      <pre className="whitespace-pre-wrap rounded-xl bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
        {text}
      </pre>
      <button className="btn-secondary mt-2 !px-3 !py-1.5 text-xs" onClick={() => copy(text)}>
        Copy {label}
      </button>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
const labelCls = "mb-1 block text-xs font-medium text-ink-muted";

export default function OfflineRecoveryPage() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [imei, setImei] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");

  const [ownerName, setOwnerName] = useState("");
  const [idType, setIdType] = useState("NIN");
  const [idNumber, setIdNumber] = useState("");
  const [dateLost, setDateLost] = useState("");
  const [locationLost, setLocationLost] = useState("");

  const [policeRef, setPoliceRef] = useState("");
  const [complaint, setComplaint] = useState("");
  const [carrierLetter, setCarrierLetter] = useState("");
  const [mno, setMno] = useState(MNOS[0]);
  const [blacklistDoc, setBlacklistDoc] = useState("");

  const load = useCallback(async () => {
    setDevices(await listDevices());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const selected = devices.find((d) => d.deviceId === deviceId);

  function pickDevice(id: string) {
    setDeviceId(id);
    const d = devices.find((x) => x.deviceId === id);
    if (d) {
      if (d.imei) setImei(d.imei);
      setDeviceLabel((d.serialNumber ?? d.hostname ?? "Device").split(" ").slice(0, 3).join(" "));
    }
  }

  function generatePoliceRef(): string {
    const ref = `NCCC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    setPoliceRef(ref);
    return ref;
  }

  function generateComplaint() {
    const ref = policeRef || generatePoliceRef();
    setComplaint(
      [
        "STOLEN DEVICE COMPLAINT — NPF-NCCC",
        "Portal: nccc.npf.gov.ng  |  CRP: crp.ng (USSD *121#)",
        "",
        `Complainant: ${ownerName || "(name required)"}`,
        `ID: ${idType} ${idNumber || "(number required)"}`,
        `Device: ${deviceLabel || "(device)"}`,
        `IMEI: ${imei || "(IMEI — dial *#06# on the box/receipt)"}`,
        `Date of loss: ${dateLost || "(date)"}`,
        `Location of loss: ${locationLost || "(location)"}`,
        `Reference: ${ref}`,
        "",
        `I report that the above device was stolen on ${dateLost || "(date)"} at ${
          locationLost || "(location)"
        }. I request:`,
        "  1. a formal police report for insurance and the stolen-device registry;",
        "  2. activation of the carrier cell-location request via the NCC/NPF channel;",
        "  3. blacklisting of the IMEI across all Nigerian networks (NCC-DMS/CEIR).",
        "",
        "Note: a device with its SIM active is still locatable by its network",
        "operator even when mobile data is off — the request above triggers that.",
        "If the device is later flashed (factory reset), the IMEI survives and",
        "the first SIM inserted is NIN-linked — the NPF-NCCC / SCID can identify",
        "whoever registered it.",
      ].join("\n"),
    );
  }

  function generateCarrierLetter() {
    const ref = policeRef || generatePoliceRef();
    setCarrierLetter(
      [
        "LOST DEVICE CELL-LOCATION REQUEST",
        `To: ${mno} — Legal & Regulatory Compliance / Law Enforcement Desk`,
        `Re: Cell-site location of stolen device IMEI ${imei || "(IMEI)"}`,
        "",
        "Dear Sir/Madam,",
        "",
        `Reference is made to the theft of the device bearing IMEI ${
          imei || "(IMEI)"
        }, reported to the Nigeria Police Force (NPF-NCCC) under reference ${ref}.`,
        "",
        "We request cell-site location data (tower IDs, sector, timing advance) for",
        `the IMEI on your network, pursuant to Section 147 of the Nigerian`,
        "Communications Act 2003 on lawful interception, to assist the police in",
        "locating the stolen device.",
        "",
        "The stolen device may have its mobile data and Wi-Fi switched off.",
        "Cell-site registration persists while the SIM is active and the device",
        "is powered on, so it remains locatable at network level.",
        "",
        "Should the device be flashed, the IMEI (hardware) remains unchanged;",
        "the first new SIM inserted is registered to a NIN and can be traced",
        "through the NCC subscriber registry via the NPF / SCID.",
        "",
        "Please direct this request to your designated law-enforcement desk. A",
        "court order will be produced promptly where your procedures require one.",
        "",
        "Complainant: " + (ownerName || "(name required)"),
        `ID: ${idType} ${idNumber || "(number required)"}`,
      ].join("\n"),
    );
  }

  function generateBlacklist() {
    const ref = policeRef || generatePoliceRef();
    setBlacklistDoc(
      [
        "IMEI BLACKLIST REQUEST (NCC-DMS / CEIR)",
        `To: ${mno} — Equipment Identity Register (EIR) Desk`,
        `Re: Blacklist stolen IMEI ${imei || "(IMEI)"} on all Nigerian networks`,
        "",
        `We request that IMEI ${imei || "(IMEI)"} be blacklisted in the NCC Device`,
        "Management System / Central Equipment Identity Register (CEIR), blocking",
        "it on MTN, Airtel, Glo and 9mobile simultaneously.",
        "",
        "Supporting documents:",
        `  1. Police report (NPF-NCCC ref ${ref})`,
        "  2. Proof of purchase / retail receipt for the device",
        "  3. Government-issued ID (NIN / passport / driver's licence)",
        "",
        "A blacklisted IMEI cannot register on any Nigerian network, making the",
        "stolen device worthless to resell — the strongest deterrent against",
        "phone theft in Nigeria.",
        "",
        "Complainant: " + (ownerName || "(name required)"),
      ].join("\n"),
    );
  }

  const offlineH = hoursSince(selected?.lastSeenAt);
  const simChanges = (selected?.events ?? []).filter((e) => e.type === "sim_change");
  const reconnected = selected?.reconnectedAt ? hoursSince(selected.reconnectedAt) : null;

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Offline tracking"
        title="Tracking a phone with data & Wi-Fi off"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/offline-recovery/action-card" className="btn-ghost">
              <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
              Recovery action card
            </Link>
            <button className="btn-ghost" onClick={() => window.print()}>
              <DocumentTextIcon className="h-4 w-4" />
              Print kits
            </button>
          </div>
        }
      />

      {/* The honest truth */}
      <Card className="mb-6 border-amber-200 bg-gradient-to-br from-amber-50/60 to-white p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-600">
            <AlertTriangleIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-ink">
              Turning off mobile data does <em>not</em> make a phone untrackable
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              A phone with no connectivity at all can never transmit its location — but thieves almost
              never achieve that. A SIM inserted in a powered-on phone must keep talking to cell towers
              (for calls and SMS), and Google's crowdsourced offline network doesn't need the phone's own
              internet at all. Here is every channel that still works, and the exact documents to activate
              each one in Nigeria.
            </p>
          </div>
        </div>
      </Card>

      {/* The five channels */}
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        {TIERS.map((t) => (
          <Card key={t.title} className="p-5">
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 place-items-center rounded-xl ${t.accent}`}>
                <t.icon className="h-5 w-5" />
              </span>
              <h3 className="text-sm font-semibold text-ink">{t.title}</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">{t.text}</p>
          </Card>
        ))}
      </div>

      {/* After a factory reset — the wall every thief hits */}
      <Card className="mb-8 border-red-200 bg-gradient-to-br from-red-50/70 to-white p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-600">
            <ShieldCheckIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-ink">If they flash it (factory reset) — the thief hits a wall</h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              A full firmware flash erases every installed app — no tracking software survives one,
              including ours. But flashing a stolen phone in Nigeria is still a dead end for the thief:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-ink-muted">
              <li className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <span>
                  <span className="font-medium text-ink">FRP / Activation Lock freezes the setup screen.</span>{" "}
                  Android phones with Factory Reset Protection and iPhones with Activation Lock demand the
                  original Google/iCloud password after a wipe. Without it the phone is a brick — parts-only
                  value. <em>Know your Google &amp; iCloud passwords; never reset the phone yourself.</em>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <span>
                  <span className="font-medium text-ink">The IMEI survives the flash.</span> Flashing cannot
                  change hardware. Blacklist it (step 4 below) and the phone can never register on any
                  Nigerian network — even the repair engineer can&apos;t resell it.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <span>
                  <span className="font-medium text-ink">The first SIM insertion is a trap.</span> When the
                  engineer or buyer inserts a new SIM, the network flags the device, pins the cell tower,
                  and — because that SIM is NIN-linked — the police can pull the identity. Take the phone
                  box (shows the IMEI) to the NPF station or SCID and request an IMEI trace.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Device picker */}
      <Card className="mb-6 p-6">
        <h3 className="text-sm font-semibold text-ink">1 · Pick the lost device</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Choose a linked agent to pre-fill its details, or leave this empty and enter the IMEI manually
          (dial <span className="font-mono">*#06#</span> on the box or receipt).
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Device</label>
            <select className={inputCls} value={deviceId} onChange={(e) => pickDevice(e.target.value)}>
              <option value="">— No device / manual entry —</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.hostname ?? d.serialNumber ?? d.deviceId.slice(0, 8)}
                  {d.platform ? ` (${d.platform})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>IMEI (15 digits)</label>
            <input
              className={inputCls}
              value={imei}
              onChange={(e) => setImei(e.target.value)}
              placeholder="e.g. 3549 4812 3456 789"
            />
          </div>
        </div>

        {selected ? (
          <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-faint">Last seen</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                <ClockIcon className="h-4 w-4 text-ink-muted" />
                {selected.lastSeenAt ? new Date(selected.lastSeenAt).toLocaleString("en-NG") : "never"}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-faint">Offline for</p>
              <p className="mt-0.5 text-sm font-medium text-ink">
                {offlineH == null
                  ? "—"
                  : offlineH < 1
                    ? "less than an hour"
                    : offlineH < 24
                      ? `${Math.round(offlineH)} hours`
                      : `${Math.round(offlineH / 24)} days`}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-faint">SIM changes</p>
              <p className="mt-0.5 text-sm font-medium text-ink">
                {simChanges.length > 0 ? `${simChanges.length} detected` : "none detected"}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-faint">Reconnects</p>
              <p className="mt-0.5 text-sm font-medium text-ink">
                {reconnected != null
                  ? `${Math.round(reconnected * 60)} min ago`
                  : "none since pairing"}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-faint">Community sightings</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                <MapPinIcon className="h-4 w-4 text-violet-500" />
                {selected.sightingCount ? `${selected.sightingCount} heard by other phones` : "none yet"}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Your full name</label>
            <input className={inputCls} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>ID type</label>
            <select className={inputCls} value={idType} onChange={(e) => setIdType(e.target.value)}>
              <option>NIN</option>
              <option>International Passport</option>
              <option>Driver's Licence</option>
              <option>Voter's Card</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>ID number</label>
            <input className={inputCls} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Date of loss</label>
            <input
              className={inputCls}
              type="date"
              value={dateLost}
              onChange={(e) => setDateLost(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Where it was lost</label>
            <input
              className={inputCls}
              value={locationLost}
              onChange={(e) => setLocationLost(e.target.value)}
              placeholder="e.g. Commercial bus, Ojota–Ikeja route, Lagos"
            />
          </div>
        </div>
      </Card>

      <div className="space-y-6">
        <Kit
          step="2"
          title="Police report & NPF-NCCC complaint"
          description="The master document. Every carrier and the NCC-DMS need the police reference before they will act. File at nccc.npf.gov.ng or CRP crp.ng / *121#."
        >
          <button className="btn-primary" onClick={generateComplaint}>
            <DocumentTextIcon className="h-4 w-4" />
            Generate complaint
          </button>
          <DocBlock text={complaint} label="complaint" />
        </Kit>

        <Kit
          step="3"
          title="Carrier cell-location request — the real offline tracker"
          description="Send this to the network's legal desk. Their tower data locates the device even with mobile data off — the SIM alone keeps it registered. A court order is the legal route if they ask."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Network operator</label>
              <select className={inputCls} value={mno} onChange={(e) => setMno(e.target.value)}>
                {MNOS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button className="btn-secondary w-full" onClick={generateCarrierLetter}>
                <MapPinIcon className="h-4 w-4 text-accent" />
                Generate carrier letter
              </button>
            </div>
          </div>
          <DocBlock text={carrierLetter} label="carrier letter" />
        </Kit>

        <Kit
          step="4"
          title="IMEI blacklist (NCC-DMS / CEIR)"
          description="Blocks the IMEI on MTN, Airtel, Glo AND 9mobile at once via the NCC device registry. Even if you never locate the phone, it becomes a brick — worthless to resell."
        >
          <button className="btn-secondary" onClick={generateBlacklist}>
            <ShieldCheckIcon className="h-4 w-4 text-primary" />
            Generate blacklist request
          </button>
          <DocBlock text={blacklistDoc} label="blacklist request" />
        </Kit>

        <Kit
          step="5"
          title="Activate the community beacon (Dravex) — mark the device LOST"
          description="The beacon runs on the phone's own agent: it broadcasts over Bluetooth while the phone is on, needing no SIM, data or Wi-Fi. Other Dravex users' phones near it report sightings to your dashboard. Mark the device lost to start getting alert + push notifications for every sighting."
        >
          <ol className="list-inside space-y-2 text-sm text-ink-muted">
            {[
              "Open the Agents page and mark the device as LOST — beacon alerts activate.",
              "Keep the Dravex app installed on other people's phones (Android 9+): the network only works where the app is installed.",
              "Allow battery-optimization exemption in Android settings — OEM battery managers can kill background Bluetooth scans otherwise.",
              "The beacon rotates daily (pseudonymous) so it can't be used to track a phone across days.",
              "Honest limit: a powered-off phone emits no Bluetooth. Powered-off finding needs Pixel 8/9-class hardware and Google/Apple's private networks.",
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                {s}
              </li>
            ))}
          </ol>
          <Link href="/dashboard/agents" className="btn-secondary mt-3 inline-flex">
            Open Agents page <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </Kit>

        <Kit
          step="6"
          title="Enable offline finding (Google + Samsung) — do this NOW"
          description="The only offline channels that need no paperwork. If the lost phone's Bluetooth is on and offline finding was enabled, nearby devices relay its beacon — the phone's own data being off is irrelevant."
        >
          <ol className="list-inside space-y-2 text-sm text-ink-muted">
            {[
              "Android: Settings → Google → Find My Device (or google.com/android/find).",
              "Turn on 'Find your offline devices' → 'With network in all areas'.",
              "Samsung Galaxy: also enable SmartThings Find (Settings → Security & privacy → Find My Mobile).",
              "Keep Bluetooth on — the beacon needs it.",
              "Know your Google (and Samsung) account password — you'll need it to see the location.",
              "Powered-off tracking (beaconing after shutdown) needs newer hardware: Pixel 8/9, iPhone 11+, flagship Samsungs.",
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {s}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="https://www.google.com/android/find"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost text-xs"
            >
              Open Find My Device <ArrowRightIcon className="h-3.5 w-3.5" />
            </a>
            <a
              href="https://smartthingsfind.samsung.com"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost text-xs"
            >
              Open SmartThings Find <ArrowRightIcon className="h-3.5 w-3.5" />
            </a>
          </div>
        </Kit>

        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/20 bg-primary/5 p-5">
          <div className="flex items-center gap-3">
            <SearchIcon className="h-5 w-5 text-primary" />
            <p className="text-sm text-ink-muted">
              Before buying a used phone, check the serial or IMEI against the stolen registry on the{" "}
              <span className="font-medium text-ink">Serial Check</span> page — a blacklisted device is a
              trap for the buyer too.
            </p>
          </div>
          <PhoneIcon className="h-5 w-5 text-primary/50" />
        </Card>
      </div>
    </div>
  );
}
