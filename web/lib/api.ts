/**
 * TrackNaija sync-server client (dashboard side).
 *
 * Points at the local sync server (server/) by default; set
 * NEXT_PUBLIC_SYNC_SERVER_URL at build time to point at the deployed server
 * (see docs/DEPLOY.md). In production this becomes the Appwrite Cloud SDK —
 * same shape, different transport.
 */

const SERVER_URL_ENV =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SYNC_SERVER_URL) ||
  "http://localhost:4173";
// Trailing slash would produce "//api/…" paths that the sync server's URL
// parser misreads as a network-path reference — strip it once here.
export const DEFAULT_SERVER_URL = SERVER_URL_ENV.replace(/\/+$/, "");

export interface DeviceEvent {
  type: string; // sim_change | reconnected | …
  at: string;
  detail?: Record<string, unknown>;
}

export interface PairedDevice {
  deviceId: string;
  hostname: string | null;
  serialNumber: string | null;
  imei?: string | null;
  platform: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
  reconnectedAt?: string | null;
  lastFix: {
    lat: number;
    lng: number;
    accuracy: number;
    source: string;
    confidence: number;
    timestamp: string;
    networks?: number;
    ipAddress?: string;
  } | null;
  commandCount: number;
  evidenceCount: number;
  events?: DeviceEvent[];
}

export interface EvidenceItem {
  id: string;
  dataUrl: string;
  capturedAt: string;
  receivedAt: string;
}

export interface AlertItem {
  id: string;
  type: string; // reconnected | sim_change | …
  deviceId: string;
  hostname: string;
  body: string;
  at: string;
  read: boolean;
}

export interface AlertsResponse {
  alerts: AlertItem[];
  unreadCount: number;
}

export interface PairingResult {
  code: string;
  deviceId: string;
}

async function req<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(DEFAULT_SERVER_URL + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function checkServerHealth(): Promise<{ ok: boolean; devices: number }> {
  const h = await req<{ ok: boolean; devices: number }>("/api/health");
  return { ok: !!h?.ok, devices: h?.devices ?? 0 };
}

export async function registerPair(label = "laptop"): Promise<PairingResult | null> {
  return req<PairingResult>("/api/pair/register", { label });
}

export async function listDevices(): Promise<PairedDevice[]> {
  return (await req<PairedDevice[]>("/api/devices")) ?? [];
}

export async function getEvidence(deviceId: string): Promise<EvidenceItem[]> {
  return (await req<EvidenceItem[]>(`/api/devices/${deviceId}/evidence`)) ?? [];
}

export async function sendCommand(
  deviceId: string,
  type: "lock" | "alarm" | "webcam",
): Promise<boolean> {
  const res = await req<{ ok: boolean }>(`/api/devices/${deviceId}/commands`, { type });
  return !!res?.ok;
}

export async function listAlerts(since?: string): Promise<AlertsResponse> {
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  return (await req<AlertsResponse>(`/api/alerts/latest${q}`)) ?? { alerts: [], unreadCount: 0 };
}

export async function markAlertRead(id?: string): Promise<boolean> {
  const res = await req<{ ok: boolean }>("/api/alerts/read", id ? { id } : { all: true });
  return !!res?.ok;
}

export async function getVapidKey(): Promise<string | null> {
  const res = await req<{ publicKey: string }>("/api/push/vapid-key");
  return res?.publicKey ?? null;
}

/** Persist the browser's PushSubscription on the sync server (no payload pushes). */
export async function subscribePush(subscription: PushSubscription): Promise<boolean> {
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const res = await req<{ ok: boolean }>("/api/push/subscribe", { subscription: json });
  return !!res?.ok;
}

export async function sendTestPush(): Promise<boolean> {
  const res = await req<{ ok: boolean }>("/api/push/test");
  return !!res?.ok;
}

export interface SmsStatus {
  enabled: boolean;
  provider: string; // twilio | termii | log
  ownerPhone: string | null; // masked, e.g. +234****5678
  lastSentAt: string | null;
  lastResult: { ok: boolean; mode: string; messageId?: string; error?: string } | null;
}

export interface ServerSettings {
  ownerPhone: string;
  smsEnabled: boolean;
  sms: SmsStatus;
}

export async function getSettings(): Promise<ServerSettings | null> {
  return req<ServerSettings>("/api/settings");
}

export async function saveSettings(patch: {
  ownerPhone?: string;
  smsEnabled?: boolean;
}): Promise<ServerSettings | null> {
  return req<ServerSettings>("/api/settings", patch);
}

export async function sendTestSms(): Promise<{
  ok: boolean;
  mode?: string;
  messageId?: string;
  error?: string;
} | null> {
  return req("/api/sms/test", {});
}
