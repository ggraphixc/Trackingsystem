/**
 * Dravex sync-server client (dashboard side).
 *
 * Points at the local sync server (server/) by default; set
 * NEXT_PUBLIC_SYNC_SERVER_URL at build time to point at the deployed server
 * (see docs/DEPLOY.md).
 */

const SERVER_URL_ENV =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_SYNC_SERVER_URL ||
      // Production fallback: a Vercel deploy without the env var must still
      // reach the LIVE API instead of silently breaking against localhost.
      // The Dravex API lives on Render at dravex.onrender.com (the old
      // tracknaija.onrender.com service is retired — everything 404s).
      (process.env.NODE_ENV === "production" ? "https://dravex.onrender.com" : ""))) ||
  "http://localhost:4173";
// Trailing slash would produce "//api/…" paths that the sync server's URL
// parser misreads as a network-path reference — strip it once here.
export const DEFAULT_SERVER_URL = SERVER_URL_ENV.replace(/\/+$/, "");

export interface DeviceEvent {
  type: string; // sim_change | reconnected | …
  at: string;
  detail?: Record<string, unknown>;
}

export interface WifiNetwork {
  bssid: string;
  ssid?: string | null;
  rssi?: number;
}

export interface CommunitySighting {
  beacon: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  at: string;
  receivedAt: string;
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
    networks?: number | WifiNetwork[];
    ipAddress?: string;
    battery?: number;
  } | null;
  commandCount: number;
  evidenceCount: number;
  events?: DeviceEvent[];
  /** phone (Android/iOS agent) vs laptop (desktop agent) */
  type?: "phone" | "laptop";
  /** owner marked it lost → community beacon alerts active */
  lost?: boolean;
  /** current/last SIM operator, decoded from the SIM fingerprint */
  operator?: string | null;
  sightingCount?: number;
  sightings?: CommunitySighting[];
  /** owner confirmed the device is back ("Verified → Recovered") */
  verifiedAt?: string | null;
  /** ownership handed over for resale (second-life market) */
  transferredAt?: string | null;
  /** verified resale listing (N5) — only present when the device is listed */
  listing?: { price: number; condition: string; listedAt: string; interestCount: number } | null;
  /** owner-set one-way message shown to a finder */
  recoveryMessage?: { message: string; contactPreference?: string | null; at: string } | null;
  /** anonymous messages a finder sent through the device's recovery page */
  contactMessages?: { id: string; message: string; at: string }[];
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

const OWNER_KEY_STORAGE = "dravex_owner_key";

/**
 * Owner key for servers that enable DRAVEX_OWNER_KEY auth. Stored in
 * localStorage on this browser only; empty string = auth off (Phase-1 mode).
 */
export function getOwnerKey(): string {
  try {
    return typeof localStorage === "undefined" ? "" : (localStorage.getItem(OWNER_KEY_STORAGE) || "");
  } catch {
    return "";
  }
}

export function setOwnerKey(key: string): void {
  try {
    if (key) localStorage.setItem(OWNER_KEY_STORAGE, key);
    else localStorage.removeItem(OWNER_KEY_STORAGE);
  } catch {
    /* private mode — auth simply won't attach */
  }
}

async function req<T>(path: string, body?: unknown, method?: "POST" | "PUT"): Promise<T | null> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // Account session first (Phase 2.5 per-owner model), owner key as the
    // legacy fallback. Public endpoints (/api/check, /api/health) ignore it.
    const auth = getSessionToken() || getOwnerKey();
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const res = await fetch(DEFAULT_SERVER_URL + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Like req but never swallows the HTTP status — for flows that must tell 409
 * from 400 from 401 (account registration/login) or read a 2xx body.
 */
async function rawReq<T>(path: string, body?: unknown): Promise<{ status: number; json: T | null }> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const auth = getSessionToken() || getOwnerKey();
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const res = await fetch(DEFAULT_SERVER_URL + path, {
      method: body !== undefined ? "POST" : "GET",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
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

export async function getSightings(deviceId: string): Promise<CommunitySighting[]> {
  return (await req<CommunitySighting[]>(`/api/devices/${deviceId}/sightings`)) ?? [];
}

/**
 * Ownership handover (second-life market): the old credential is rotated and
 * a fresh single-use pairing code is returned for the new owner's agent.
 */
export async function transferDevice(
  deviceId: string,
): Promise<{ ok: boolean; code?: string; deviceId?: string } | null> {
  return req<{ ok: boolean; code?: string; deviceId?: string }>(
    `/api/devices/${deviceId}/transfer`,
    {},
  );
}

/** Owner confirms the device is back — "Verified → Recovered" lifecycle step. */
export async function verifyDevice(
  deviceId: string,
): Promise<{ ok: boolean; verifiedAt?: string } | null> {
  return req<{ ok: boolean; verifiedAt?: string }>(`/api/devices/${deviceId}/verify`, {});
}

/** Owner sets the one-way message shown to a finder of this device. */
export async function setRecoveryMessage(
  deviceId: string,
  message: string,
  contactPreference?: string,
): Promise<boolean> {
  // The server route is PUT — req() sends POST by default, so pass the method.
  const res = await req<{ ok: boolean }>(
    `/api/devices/${deviceId}/recovery-message`,
    {
      message,
      contactPreference: contactPreference || undefined,
    },
    "PUT",
  );
  return !!res?.ok;
}

export async function setDeviceLost(
  deviceId: string,
  lost: boolean,
): Promise<{ ok: boolean; recoveryCode?: string | null } | null> {
  return req<{ ok: boolean; recoveryCode?: string | null }>(`/api/devices/${deviceId}/lost`, { lost });
}

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: string;
  confidence?: number | null;
  timestamp: string;
  receivedAt?: string;
  networks?: number | WifiNetwork[];
  ipAddress?: string;
  battery?: number;
}

/** Full device detail (events + recent sightings included) for the recovery view. */
export async function getDevice(deviceId: string): Promise<PairedDevice | null> {
  return req<PairedDevice>(`/api/devices/${deviceId}`);
}

/** Location history for one device, newest first. */
export async function getFixes(deviceId: string, limit = 50): Promise<LocationFix[]> {
  return (await req<LocationFix[]>(`/api/devices/${deviceId}/fixes?limit=${limit}`)) ?? [];
}

/**
 * Public Dravex Device Check — query the stolen-device registry by IMEI or
 * serial before buying a used phone/laptop. No auth, no owner data.
 */
export interface RegistryVerdict {
  found: boolean;
  status: "reported_stolen" | "clean";
  type?: string | null;
  label?: string | null;
  reportedAt?: string;
  previouslyReported?: boolean;
  message: string;
  /** N5: this physical device is in a verified resale listing */
  resaleReady?: boolean;
  listing?: { price: number; condition: string; listedAt: string } | null;
}

export async function checkStolenRegistry(query: string): Promise<RegistryVerdict | null> {
  return req<RegistryVerdict>(`/api/check?q=${encodeURIComponent(query)}`);
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
  /** N3: NDPA data-minimization window (30–730 days) */
  evidenceRetentionDays: number;
  sms: SmsStatus;
}

export async function getSettings(): Promise<ServerSettings | null> {
  return req<ServerSettings>("/api/settings");
}

export async function saveSettings(patch: {
  ownerPhone?: string;
  smsEnabled?: boolean;
  evidenceRetentionDays?: number;
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

/* ---------------- Phase 2.5: per-owner accounts ---------------- */

const SESSION_STORAGE = "dravex_session_token";

/** Session token for the account model. Empty string = not signed in. */
export function getSessionToken(): string {
  try {
    return typeof localStorage === "undefined" ? "" : (localStorage.getItem(SESSION_STORAGE) || "");
  } catch {
    return "";
  }
}

export function setSessionToken(token: string): void {
  try {
    if (token) localStorage.setItem(SESSION_STORAGE, token);
    else localStorage.removeItem(SESSION_STORAGE);
  } catch {
    /* private mode — session simply won't persist */
  }
}

export interface SessionUser {
  ok?: boolean;
  userId?: string;
  email?: string;
  role?: string;
  deviceCount?: number;
  createdAt?: string;
}

export interface AuthResult {
  ok: boolean;
  status: number;
  error?: string;
  user?: SessionUser;
}

/** Create an owner account — the first is the default owner, later accounts
 * are separate owners with isolated device lists. Stores the session token. */
export async function registerAccount(email: string, password: string): Promise<AuthResult> {
  const res = await rawReq<SessionUser & { token?: string }>("/api/auth/register", { email, password });
  if (res.status === 201 && res.json?.token) setSessionToken(res.json.token);
  if (res.status === 201) return { ok: true, status: res.status, user: res.json ?? undefined };
  return {
    ok: false,
    status: res.status,
    error: (res.json as { error?: string } | null)?.error ?? "Server unreachable.",
  };
}

export async function loginAccount(email: string, password: string): Promise<AuthResult> {
  const res = await rawReq<SessionUser & { token?: string }>("/api/auth/login", { email, password });
  if (res.status === 200 && res.json?.token) setSessionToken(res.json.token);
  if (res.status === 200) return { ok: true, status: res.status, user: res.json ?? undefined };
  return {
    ok: false,
    status: res.status,
    error: (res.json as { error?: string } | null)?.error ?? "Server unreachable.",
  };
}

export async function logoutAccount(): Promise<void> {
  await rawReq("/api/auth/logout", {});
  setSessionToken("");
}

/**
 * Request a password-reset token for an email. ALWAYS resolves ok when the
 * server is reachable (the response never reveals whether the account
 * exists) — delivery is via ALERT_WEBHOOK_URL (webhook→email) or the server
 * console in log mode.
 */
export async function forgotPassword(
  email: string,
): Promise<{ ok: boolean; deliveredVia?: string; error?: string }> {
  const res = await rawReq<{ ok: boolean; deliveredVia?: string }>("/api/auth/forgot", { email });
  if (res.status === 200) return { ok: true, deliveredVia: res.json?.deliveredVia };
  return {
    ok: false,
    error: (res.json as { error?: string } | null)?.error ?? "Server unreachable.",
  };
}

/** Redeem a reset token with a new password; signs the owner in on success. */
export async function resetPassword(
  token: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await rawReq<{ ok: boolean; token?: string }>("/api/auth/reset", { token, password });
  if (res.status === 200 && res.json?.token) setSessionToken(res.json.token);
  if (res.status === 200) return { ok: true };
  return {
    ok: false,
    error: (res.json as { error?: string } | null)?.error ?? "Could not reset the password.",
  };
}

/** Who is this browser's session? Null when signed out or server unreachable. */
export async function getMe(): Promise<SessionUser | null> {
  const res = await rawReq<SessionUser>("/api/auth/me");
  return res.status === 200 ? res.json : null;
}

/* ---------------- Phase 2.5: observability ---------------- */

export interface AdminHealth {
  ok: boolean;
  time: string;
  uptimeS: number;
  storage: { mode: string; describe: string };
  devices: { paired: number; connected: number; offline: number; lost: number };
  lastFixAgeMin: { oldest: number; newest: number } | null;
  geolocate: { requests: number; resolved: number; unresolved: number; limited: number };
  sightings: { received: number; stored: number; deduped: number; ghosts: number; limited: number };
  commands: { queued: number; delivered: number; acked: number; deliveryRate: string };
  sms: { attempts: number; ok: number; failed: number; provider: string };
  webhooks: { sent: number; failed: number };
  alerts: { raised: number };
  errors: { route: number };
  security: { denied401: number; rateLimited: number; registryChecks: number; registryHits: number };
  retention: {
    days: number;
    purge: { runs: number; fixes: number; evidence: number; sightings: number; lastAt: string | null };
  };
  ops: { checks: number; fired: number; lastAt: string | null; last: string[] };
  deliveryLog: DeliveryEntry[];
}

export interface DeliveryEntry {
  id: string;
  channel: string; // sms | webhook
  ok: boolean;
  error: string | null;
  at: string;
  alert: { id: string; type: string; hostname: string; body: string } | null;
}

/** Service-health snapshot: agents, geolocation, sightings, delivery rates… */
export async function getAdminHealth(): Promise<AdminHealth | null> {
  return req<AdminHealth>("/api/admin/health");
}

/** Re-fire a failed SMS/webhook delivery from the Service-health log. */
export async function retryDelivery(
  id: string,
): Promise<{ ok: boolean; results?: { channel: string; ok: boolean; error?: string | null }[] } | null> {
  return req<{ ok: boolean; results?: { channel: string; ok: boolean; error?: string | null }[] }>(
    "/api/admin/retry-delivery",
    { id },
  );
}

/** N3: run the evidence-retention purge now (operator). */
export async function runPurge(): Promise<{
  ok: boolean;
  days?: number;
  purged?: { runs: number; fixes: number; evidence: number; sightings: number; lastAt: string | null };
} | null> {
  return req("/api/admin/purge", {});
}

/** N4: evaluate operator health thresholds now (operator). */
export async function runOpsCheck(): Promise<{
  ok: boolean;
  fired?: string[];
} | null> {
  return req("/api/admin/ops-check", {});
}

/* ---------------- N5: verified resale + public counters ---------------- */

export interface ResaleListing {
  deviceId: string;
  type: string | null;
  label: string | null;
  price: number;
  condition: string;
  listedAt: string;
  interestCount: number;
}

export interface PublicStats {
  ok?: boolean;
  protected: number;
  recovered: number;
  sighted: number;
  listings: number;
}

/** Public aggregate counters (landing page). */
export async function getStats(): Promise<PublicStats | null> {
  return req<PublicStats>("/api/stats");
}

/** Public verified-resale browse. */
export async function getListings(): Promise<ResaleListing[]> {
  return (await req<{ listings: ResaleListing[] }>("/api/listings"))?.listings ?? [];
}

/** Owner lists a TRANSFERRED device for verified resale. */
export async function listDevice(
  deviceId: string,
  price: number,
  condition: string,
): Promise<{ ok: boolean; listing?: unknown } | null> {
  return req<{ ok: boolean; listing?: unknown }>("/api/listings", { deviceId, price, condition });
}

/** Owner pulls a listing. */
export async function unlistDevice(deviceId: string): Promise<boolean> {
  const res = await req<{ ok: boolean }>("/api/listings/unlist", { deviceId });
  return !!res?.ok;
}

/** Buyer expresses interest — owner is alerted privately. */
export async function expressInterest(deviceId: string, message?: string): Promise<boolean> {
  const res = await req<{ ok: boolean }>(`/api/listings/${deviceId}/interest`, {
    message: message || undefined,
  });
  return !!res?.ok;
}
