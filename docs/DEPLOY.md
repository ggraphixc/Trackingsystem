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
