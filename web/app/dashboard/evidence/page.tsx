"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { checkServerHealth, getEvidence, getEvidencePack, listDevices, sendCommand } from "@/lib/api";
import type { EvidenceItem, PairedDevice } from "@/lib/api";
import { CameraIcon, DocumentTextIcon, EyeIcon } from "@/components/icons";
import { Card, EmptyState, SectionTitle } from "@/components/ui";

/** Demo evidence placeholders so the gallery is alive before any real capture. */
function demoEvidence(): EvidenceItem[] {
  const t = Date.now();
  const colors = ["#2563EB", "#F97316", "#059669"];
  return colors.map((color, i) => {
    const time = new Date(t - i * 86400000);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
      <rect width="640" height="360" fill="${color}22"/>
      <rect x="0" y="0" width="640" height="8" fill="${color}"/>
      <circle cx="320" cy="140" r="64" fill="${color}44" stroke="${color}" stroke-width="4"/>
      <path d="M200 300 q120 -60 240 0" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
      <text x="320" y="330" font-family="Fira Code, monospace" font-size="20" fill="${color}" text-anchor="middle">DEMO — webcam evidence</text>
    </svg>`;
    return {
      id: `demo-${i}`,
      dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      capturedAt: time.toISOString(),
      receivedAt: time.toISOString(),
      source: "webcam",
    };
  });
}

interface EvidenceWithLabel extends EvidenceItem {
  deviceLabel?: string;
}

export default function EvidencePage() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [evidenceByDevice, setEvidenceByDevice] = useState<Record<string, EvidenceItem[]>>({});
  const [serverOk, setServerOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const health = await checkServerHealth();
    setServerOk(health.ok);
    const list = await listDevices();
    setDevices(list);
    const map: Record<string, EvidenceItem[]> = {};
    await Promise.all(
      list.map(async (d) => {
        map[d.deviceId] = await getEvidence(d.deviceId);
      }),
    );
    setEvidenceByDevice(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function capture(deviceId: string) {
    const ok = await sendCommand(deviceId, "webcam");
    setToast(
      ok
        ? "Webcam capture command sent — the agent will snap and upload evidence shortly."
        : "Command failed — is the agent linked and the server running?",
    );
    setTimeout(() => setToast(""), 5000);
  }

  async function exportPack(deviceId: string, hostname?: string | null) {
    const pack = await getEvidencePack(deviceId);
    if (!pack) {
      setToast("Could not build the evidence pack — check the server (owner auth required).");
      setTimeout(() => setToast(""), 5000);
      return;
    }
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dravex-evidence-pack-${(hostname ?? deviceId).slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("Evidence pack exported — retention policy respected (expired evidence excluded).");
    setTimeout(() => setToast(""), 5000);
  }

  const allEvidence: EvidenceWithLabel[] = devices.flatMap((d) =>
    (evidenceByDevice[d.deviceId] ?? []).map((e) => ({
      ...e,
      deviceLabel: `${d.hostname ?? "Unknown host"} · ${d.serialNumber ?? "—"}`,
    })),
  );
  const demo: EvidenceWithLabel[] = useMemo(
    () => demoEvidence().map((e) => ({ ...e, deviceLabel: undefined })),
    [],
  );
  const gallery = allEvidence.length > 0 ? allEvidence : serverOk ? [] : demo;

  return (
    <div className="animate-fade-up">
      <SectionTitle
        eyebrow="Thief catcher"
        title="Evidence Center"
        action={
          !serverOk ? (
            <span className="chip bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20">
              Demo mode — start the sync server for live evidence
            </span>
          ) : (
            <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              Live from agents
            </span>
          )
        }
      />

      {toast ? (
        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
          {toast}
        </div>
      ) : null}

      {!loading && gallery.length === 0 ? (
        <EmptyState
          icon={<CameraIcon className="h-7 w-7" />}
          title="No evidence captures yet"
          body="When an agent is in lost mode or you trigger a capture, webcam photos land here as evidence."
        />
      ) : (
        <>
          {!serverOk ? (
            <p className="mb-4 text-xs text-ink-muted">
              Showing demo captures. Start the sync server (<span className="font-mono">cd server && npm start</span>)
              and link an agent to see real evidence.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map((item) => (
              <Card key={item.id} hover className="overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.dataUrl}
                  alt={`Webcam evidence captured ${new Date(item.capturedAt).toLocaleString("en-NG")}`}
                  className="h-44 w-full bg-slate-100 object-cover"
                  loading="lazy"
                />
                <div className="p-4">
                  <p className="truncate text-sm font-semibold text-ink">
                    {item.deviceLabel ?? "Demo capture"}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {new Date(item.capturedAt).toLocaleString("en-NG")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="chip bg-slate-100 text-slate-600">
                      {item.source ?? "webcam"}
                    </span>
                    <span className={`chip ${item.retained === false ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {item.retained === false
                        ? `expired ${item.expiresAt ? new Date(item.expiresAt).toLocaleDateString("en-NG") : ""}`
                        : item.expiresAt
                          ? `retained until ${new Date(item.expiresAt).toLocaleDateString("en-NG")}`
                          : "retained"}
                    </span>
                    {item.sha256 ? (
                      <span className="chip bg-slate-100 font-mono text-slate-600" title={`SHA-256 ${item.sha256}`}>
                        {item.sha256.slice(0, 10)}…
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-ink-faint">id {item.id.slice(0, 12)}</p>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {devices.length > 0 ? (
        <Card className="mt-8 p-5">
          <h3 className="text-sm font-semibold text-ink">Capture &amp; export</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Send a webcam command to a linked agent, or export a device&apos;s full Recovery Evidence
            Pack (device identity, timeline, location history, sightings, commands, evidence index —
            expired evidence excluded per the retention policy, and no finder identity).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {devices.map((d) => (
              <div key={d.deviceId} className="flex items-center gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => capture(d.deviceId)}
                >
                  <EyeIcon className="h-4 w-4 text-accent" />
                  Capture on {d.hostname ?? d.deviceId.slice(0, 8)}
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => exportPack(d.deviceId, d.hostname)}
                >
                  <DocumentTextIcon className="h-4 w-4 text-primary" />
                  Export pack
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
