"use client";

import { useCallback, useEffect, useState } from "react";
import { listDevices } from "@/lib/api";
import type { PairedDevice } from "@/lib/api";
import { DocumentTextIcon, PrinterIcon } from "@/components/icons";

const MNOS = ["MTN Nigeria", "Airtel Nigeria", "Globacom (Glo)", "9mobile"];

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
const labelCls = "mb-1 block text-xs font-medium text-ink-muted";

function Step({ n, title, detail }: { n: number; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 border-slate-400 bg-white">
        <span className="text-[11px] font-bold text-slate-500">{n}</span>
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{detail}</p>
      </div>
    </li>
  );
}

export default function RecoveryActionCard() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [imei, setImei] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [mno, setMno] = useState(MNOS[0]);
  const [policeRef, setPoliceRef] = useState("");

  const load = useCallback(async () => {
    setDevices(await listDevices());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function pickDevice(id: string) {
    setDeviceId(id);
    const d = devices.find((x) => x.deviceId === id);
    if (d) {
      if (d.imei) setImei(d.imei);
      setDeviceLabel((d.serialNumber ?? d.hostname ?? "Device").split(" ").slice(0, 3).join(" "));
    }
  }

  function generateCard() {
    if (!policeRef) {
      setPoliceRef(`NCCC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`);
    }
  }

  return (
    <div className="animate-fade-up">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary">Recovery action card</p>
          <h1 className="mt-1 text-2xl font-bold text-ink">
            One page to carry to the police station
          </h1>
        </div>
        <button className="btn-primary" onClick={() => window.print()}>
          <PrinterIcon className="h-4 w-4" />
          Print card
        </button>
      </div>

      {/* Card setup (hidden when printing) */}
      <div className="no-print mb-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-3">
        <div>
          <label className={labelCls}>Device</label>
          <select className={inputCls} value={deviceId} onChange={(e) => pickDevice(e.target.value)}>
            <option value="">— No device / manual entry —</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.hostname ?? d.serialNumber ?? d.deviceId.slice(0, 8)}
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
            placeholder="dial *#06# on the box/receipt"
          />
        </div>
        <div>
          <label className={labelCls}>Your full name</label>
          <input
            className={inputCls}
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Network operator</label>
          <select className={inputCls} value={mno} onChange={(e) => setMno(e.target.value)}>
            {MNOS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end md:col-span-2">
          <button className="btn-secondary" onClick={generateCard}>
            <DocumentTextIcon className="h-4 w-4" />
            Generate police reference
          </button>
        </div>
      </div>

      {/* THE CARD — prints on one page */}
      <div className="rounded-2xl border-2 border-ink bg-white p-6 print:border-ink">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <p className="text-lg font-bold tracking-wide text-ink">
            TRACKNAIJA · RECOVERY ACTION CARD
          </p>
          <p className="text-xs font-semibold text-ink-muted">
            {new Date().toLocaleDateString("en-NG", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-xs text-ink">
          <p>
            <span className="text-ink-muted">DEVICE:</span> {deviceLabel || "—"}
          </p>
          <p>
            <span className="text-ink-muted">NETWORK:</span> {mno}
          </p>
          <p>
            <span className="text-ink-muted">IMEI:</span> {imei || "—"}
          </p>
          <p>
            <span className="text-ink-muted">OWNER:</span> {ownerName || "—"}
          </p>
          <p className="col-span-2">
            <span className="text-ink-muted">POLICE REF:</span> {policeRef || "________"}
          </p>
        </div>

        <ol className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
          <Step
            n={1}
            title="File the complaint"
            detail="NPF-NCCC nccc.npf.gov.ng or CRP crp.ng / *121# — get the police report reference. Keep it: every other step needs it."
          />
          <Step
            n={2}
            title="Carrier cell-location request"
            detail={`Send the letter to ${mno} legal desk (Section 147, Nigerian Communications Act 2003). The SIM keeps the phone registered to towers even with data off — the carrier can still locate it.`}
          />
          <Step
            n={3}
            title="Blacklist the IMEI (NCC-DMS/CEIR)"
            detail="Ask the operator's EIR desk to blacklist the IMEI nationally. Police report + proof of purchase + government ID required. A blacklisted phone is a brick — worthless to resell."
          />
          <Step
            n={4}
            title="Keep Find My Device armed"
            detail="Offline finding enabled + Bluetooth on? Nearby Android devices relay the beacon using their own internet — the phone's data being off is irrelevant."
          />
        </ol>

        <p className="mt-4 border-t border-slate-200 pt-3 text-[11px] text-ink-muted">
          A phone with an active SIM that is powered on must keep registering with cell towers — even
          with mobile data and Wi-Fi off. Offline ≠ untrackable.
        </p>
      </div>
    </div>
  );
}
