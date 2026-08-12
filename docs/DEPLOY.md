# Dravex — production deployment

Dravex has three runtime pieces that need hosting:

| Piece | What it is | Host |
|---|---|---|
| **Sync server** | Zero-dependency Node HTTP server (`server/`) — relays fixes, evidence, commands, alerts, push, SMS | Render (or Fly.io) |
| **Web dashboard** | Next.js app (`web/`) — owner console, push registration, alerts | Vercel |
| **Database** | Neon serverless Postgres (optional — without it the server uses a local JSON file) | Neon |

Deploying matters for push notifications: **service workers only run on https** (or
`http://localhost`), and a secure page cannot fetch a plain-http sync server (mixed
content). Both the dashboard and the sync server need public https URLs in production.

---

## 1. Database — Neon (optional but recommended)

1. Create a free account at https://neon.tech and a project (any region; Lagos/eu-central
   is a good default for Nigeria).
2. Copy the **connection string** (Console → your project → Connection Details).
3. Paste it into the sync server's `DATABASE_URL` env var (Render dashboard or local `.env`).

The server auto-creates its schema on first boot (`dravex_kv` key/value table) and
switches from the JSON file to Postgres automatically — no code changes. If Neon is
unreachable at boot the server **refuses to start** so you never silently lose data.

## 2. Sync server — Render (free tier)

The repo ships with the pieces:

- `server/Dockerfile` — Node 20 image, binds `0.0.0.0` (required for hosting)
- `server/render.yaml` — Render Blueprint (auto-provisions from the repo)

Steps:

1. Push this repository to GitHub.
2. Render → **New → Blueprint** → pick the repo. Render reads `render.yaml` and creates
   the service. (Alternatively: New → Web Service → Docker, root directory `server`.)
3. In the Render dashboard set env vars:
   - `DATABASE_URL` — your Neon string
   - SMS credentials (see §4) — or leave unset; SMS falls back to console "log mode"
4. Deploy. Render gives you a public `https://<name>.onrender.com` URL.
5. Verify: visit `https://<name>.onrender.com/api/health` → `{"ok":true,...}`.

> Fly.io alternative: `fly launch` in `server/`, set the same env vars, `fly deploy`.
> The Dockerfile works there too (Fly sets `PORT`/`HOST` itself if you prefer).

## 3. Web dashboard — Vercel

1. Push `web/` to GitHub (or use Vercel's CLI: `vercel --prod` from `web/`).
2. Set the build-time env var on Vercel:
   - `NEXT_PUBLIC_SYNC_SERVER_URL` = `https://<name>.onrender.com`
3. Deploy. Vercel gives you `https://<project>.vercel.app`.

The dashboard reads `NEXT_PUBLIC_SYNC_SERVER_URL` (falls back to `http://localhost:4173`)
and writes it to IndexedDB for the service worker, so push notifications fetch alerts
from the deployed server automatically.

## 4. SMS fallback alerts — Twilio or Termii

Configure **one** provider on the sync server. No provider = "log mode" (messages print
to the server console — handy for testing).

### Twilio
1. https://www.twilio.com → sign up, buy a number.
2. Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
3. Nigeria: register an alphanumeric sender ID (NCC-compliant) in the Twilio console —
   otherwise long SMS can fall back to the shared number and delivery is slower.

### Termii (Nigeria-native, cheaper NGN pricing, DND-friendly)
1. https://termii.com → sign up, get an API key, configure a sender ID
   (e.g. `Dravex`).
2. Env vars: `TERMII_API_KEY`, `TERMII_FROM`.

Then, in the dashboard **Agents page → SMS fallback alerts**, enter the owner's phone
(`+234...`) and hit *Save & enable* + *Send test SMS*. The server texts that number on
every reconnect and SIM change.

## 5. Point the agents at the live server

- **Desktop agent (Windows/macOS/Linux):** open the agent → *Link to dashboard* → enter
  the Render URL in the server field → *Test server* → generate a pairing code on the
  deployed dashboard's Agents page and link.
- **Android agent (APK):** the app reads its server URL from the pairing screen — enter
  the Render URL there before pairing.
- After pairing, the agent streams fixes/evidence to the deployed server, and the
  desktop agent shows reconnect/SIM-change banners + native notifications.

## 6. Push notifications checklist (https requirements)

- ✅ Dashboard on https (Vercel).
- ✅ Sync server on https (Render/Fly).
- ✅ Service worker registered at `/sw.js` (domain root).
- ⚠️ Browser push requires the owner to *grant* notification permission (the bell
  button does this on first use).

## Local development recap

```bash
cd server && npm start        # sync server on http://localhost:4173
cd web && npm run dev         # dashboard on http://localhost:3000
cd desktop && npm start       # desktop agent
```

Set `DATABASE_URL` locally to use Neon in development; unset it to use `server/data.json`.

## Enabling API auth (optional)

The server runs fully open by default (Phase-1 zero-config). To lock it down,
set an owner key in the server env:

```bash
DRAVEX_OWNER_KEY=your-long-random-secret
```

When set:

- **Owner endpoints** (device list, mark lost, alerts, settings, command queue,
  evidence/sighting/fix reads) require `Authorization: Bearer <DRAVEX_OWNER_KEY>`.
- **Agent endpoints** (fix/evidence/event upload, command poll/ack) require the
  per-device token issued at `POST /api/pair/claim` — agents store it automatically.
- Public stays public: `/api/health`, `/api/check`, `POST /api/sightings`, claim.

Clients that need the key: the **web dashboard** (owner-key card on the Agents
page, stored per browser) and the **desktop agent** (owner-key field in
Settings, for the owner-only views).

> Devices paired *before* auth was enabled have no stored token and will get
> 401 on uploads. Fix: `POST /api/devices/:id/token` (owner key) returns a
> fresh token — enter it in the agent, or simply re-pair the device.

## Phase 2 (Fidelity + Second-Life) environment

| Env var | Purpose | Required |
|---|---|---|
| `DRAVEX_OWNER_KEY` | Optional auth master key. Unset = fully open API (dev). Set = owner endpoints need `Bearer <key>` **or** an account session; agent endpoints need the per-device token. Generate with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` | optional (recommended in production) |
| `GEOLOCATION_API_KEY` | Wi-Fi geolocation (Google Geolocation API key; the server falls back to Mozilla Location). **Without it, `POST /api/geolocate` answers 501 `{ source: "unresolved" }`** and the desktop honestly uses IP / last-known — it never fakes a coordinate | to resolve Wi-Fi fixes |
| `CORS_ORIGIN` | The web dashboard's origin (the **Vercel/Next.js app**, not the API host) — e.g. `https://dravex-dashboard.vercel.app`. When set, cross-origin calls from any other origin are blocked (default `*` is dev-only) | when the dashboard is served from a different domain than the API |
| `ALERT_WEBHOOK_URL` | Comma-separated HTTPS URLs that receive every alert as JSON `{ alert }`. Point it at a webhook-to-email service (e.g. ntfy, Zapier, Pipedream) for an email fallback the moment push/SMS can't reach the owner. **Also carries password-reset tokens** (payload `{ type: "password_reset", email, token, expiresAt }`) — the server-side delivery channel for the forgot-password flow | optional (needed for real email reset delivery) |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` | Twilio SMS provider (replaces log mode) | optional — either Twilio or Termii |
| `TERMII_API_KEY` + `TERMII_FROM` | Termii SMS provider — Nigeria-native, DND-friendly | optional — either Termii or Twilio |

SMS stays in **log mode** (messages print to the server console) until a
provider is configured — the E2E suite runs against log mode, and switching
to a live provider requires zero code changes.

## Phase 2.5 (Production Readiness) notes

- **Per-owner accounts** — `POST /api/auth/register|login|logout`, `GET /api/auth/me`.
  Sessions are owner credentials in both open and `DRAVEX_OWNER_KEY` modes; each
  account sees only its own devices (cross-owner actions → 403); pairing codes
  minted under a session claim to that user. Devices paired before accounts
  existed have `ownerId: null` — claim them under an account (fresh code) to
  take ownership. Register/login are rate-limited (10/min/IP); passwords are
  scrypt-hashed with per-user salts.
- **Password reset** — `POST /api/auth/forgot` issues a 1 h reset token and
  delivers it via `ALERT_WEBHOOK_URL` (webhook-to-email) or the server console
  in log mode; `POST /api/auth/reset { token, password }` redeems it. The
  response never reveals whether an email has an account.
- **Observability** — `GET /api/admin/health` (owner) reports agents
  connected/offline/lost, geolocation + sighting counters, command delivery
  rate, SMS/webhook failures and the last 20 alert-delivery attempts.
  `POST /api/admin/retry-delivery { id }` re-fires a failed delivery.

**PostGIS note:** the Neon store auto-creates a `dravex_points` table with a
GiST index when PostGIS is available and answers `/api/nearest` with real
`ST_Distance` queries. On hosts without PostGIS the table degrades to
plain coordinate columns and the server falls back to haversine — same API,
no config needed. Enable PostGIS on Neon per-project (it ships with the
service).
