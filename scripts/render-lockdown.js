#!/usr/bin/env node
/**
 * render-lockdown.js — Dravex sync-server env lockdown on Render.
 *
 * Zero-dependency (Node 18+ global fetch). Talks to the Render REST API:
 *   GET   /v1/services            → list your services
 *   PATCH /v1/services/{id}       → set env vars (auto-triggers a deploy)
 *
 * Usage:
 *   RENDER_API_KEY=<key> node scripts/render-lockdown.js list
 *   RENDER_API_KEY=<key> node scripts/render-lockdown.js lockdown \
 *       --service <id-or-name> --cors-origin https://<dash>.vercel.app \
 *       [--owner-key <new-key>] [--dry-run]
 *   RENDER_API_KEY=<key> node scripts/render-lockdown.js verify \
 *       --host https://dravex.onrender.com [--owner-key <key>]
 *
 * The key lives in your Render dashboard → Account Settings → API Keys.
 * Setting env vars through the API redeploys the service automatically.
 */

const API_BASE = "https://api.render.com/v1";

function fail(msg) {
  console.error(`\u2717 ${msg}`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function api(path, method = "GET", body) {
  const key = process.env.RENDER_API_KEY;
  if (!key) fail("RENDER_API_KEY is not set (Render dashboard → Account Settings → API Keys).");
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    fail(`Render API ${method} ${path} → ${res.status}: ${JSON.stringify(json)?.slice(0, 300) || res.statusText}`);
  }
  return json;
}

async function listServices() {
  const services = await api("/services");
  if (!services.length) fail("No services found on this Render account.");
  console.log(`${services.length} service(s):\n`);
  for (const s of services) {
    const url = s.serviceDetails?.url || s.service?.url || "—";
    const envKeys = (s.envVars || []).map((e) => e.key).sort().join(", ") || "(none)";
    console.log(`  id:        ${s.id}`);
    console.log(`  name:      ${s.name}`);
    console.log(`  type:      ${s.type}`);
    console.log(`  url:       ${url}`);
    console.log(`  env vars:  ${envKeys}`);
    console.log("");
  }
  return services;
}

function pickService(services, needle) {
  if (!needle) fail("--service <id-or-name> is required for lockdown.");
  const exact = services.find((s) => s.id === needle || s.name === needle);
  if (exact) return exact;
  const fuzzy = services.find((s) => s.name.toLowerCase().includes(needle.toLowerCase()));
  if (fuzzy) return fuzzy;
  fail(`No service matches "${needle}". Run "list" to see your services.`);
}

async function lockdown() {
  const services = await listServices();
  const svc = pickService(services, arg("service"));
  const corsOrigin = arg("cors-origin");
  const ownerKey = arg("owner-key");
  const dryRun = hasFlag("dry-run");

  if (!corsOrigin && !ownerKey) {
    fail("Nothing to set — pass --cors-origin and/or --owner-key.");
  }
  if (corsOrigin && !/^https:\/\/[^\s/]+$/.test(corsOrigin)) {
    fail(`CORS_ORIGIN must be a bare origin (scheme + host, no trailing slash): got "${corsOrigin}".`);
  }

  const envVars = [];
  if (corsOrigin) envVars.push({ key: "CORS_ORIGIN", value: corsOrigin });
  if (ownerKey) {
    console.log(
      "\n\u26a0 WARNING: --owner-key ROTATES the owner key. Any client holding the old",
      "key (desktop agents, browser dashboard) will get 401 until you re-enter the new",
      "key. Omit --owner-key to keep the existing key and only set CORS_ORIGIN.",
    );
    envVars.push({ key: "DRAVEX_OWNER_KEY", value: ownerKey });
  }

  console.log(`\nTarget: ${svc.name} (${svc.id})`);
  for (const e of envVars) {
    console.log(`  ${dryRun ? "[dry-run] would set" : "set"} ${e.key} = ${e.key === "DRAVEX_OWNER_KEY" ? "••••••••" : e.value}`);
  }
  if (dryRun) {
    console.log("\nDry run — nothing changed. Re-run without --dry-run to apply.");
    return;
  }

  const updated = await api(`/services/${svc.id}`, "PATCH", { envVars });
  const deploy = updated.deploy;
  console.log(
    deploy
      ? `\n\u2713 Env vars applied. Auto-triggered deploy: ${deploy.id} (${deploy.status}).`
      : "\n\u2713 Env vars applied.",
  );
  console.log("Next: verify with the verify command once the deploy is live (usually ~1–3 min).");
}

async function verify() {
  const host = (arg("host") || "https://dravex.onrender.com").replace(/\/+$/, "");
  const ownerKey = arg("owner-key") || "";
  const out = [];

  const health = await fetch(`${host}/api/health`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  out.push(`GET  /api/health            → ${health?.status || "unreachable"}`);

  const admin = await fetch(`${host}/api/admin/health`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  out.push(`GET  /api/admin/health      → ${admin?.status || "unreachable"} (owner gate: expect 401 without key)`);

  if (ownerKey) {
    const authed = await fetch(`${host}/api/admin/health`, {
      headers: { Authorization: `Bearer ${ownerKey}` },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    out.push(`GET  /api/admin/health (key) → ${authed?.status || "unreachable"} (expect 200)`);
  }

  const pre = await fetch(`${host}/api/health`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  const acao = pre?.headers?.get("access-control-allow-origin");
  out.push(
    `CORS preflight evil origin  → ${pre?.status || "unreachable"}, Access-Control-Allow-Origin: ${acao || "(none — locked down \u2713)"}`,
  );

  console.log(out.join("\n"));
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === "list") await listServices();
  else if (cmd === "lockdown") await lockdown();
  else if (cmd === "verify") await verify();
  else {
    console.log(
      [
        "render-lockdown.js — Dravex sync-server env lockdown on Render",
        "",
        "  list      → show services + ids + env-var keys",
        "  lockdown  → set CORS_ORIGIN / DRAVEX_OWNER_KEY via the Render API",
        "  verify    → probe a live host for owner gate + CORS lock",
        "",
        "Examples:",
        "  RENDER_API_KEY=<key> node scripts/render-lockdown.js list",
        "  RENDER_API_KEY=<key> node scripts/render-lockdown.js lockdown \\",
        "      --service <id-or-name> --cors-origin https://<dash>.vercel.app [--owner-key <key>]",
        "  RENDER_API_KEY=<key> node scripts/render-lockdown.js verify --host https://dravex.onrender.com",
      ].join("\n"),
    );
  }
})().catch((e) => fail(e.message));
