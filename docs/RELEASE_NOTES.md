# TrackNaija 0.2.0 — release notes

## Highlights

- **Offline-first agents** — the Windows/macOS/Linux agent and the Android APK keep
  capturing fixes, webcam evidence and events with **no internet**: everything is held
  in an offline vault and burst-synced in one batch the moment the device touches any
  network (cafe Wi-Fi, a new SIM's data).
- **SIM-change detection (Android)** — the phone reports SIM swaps via the cellular radio
  state, which works with mobile data turned off. A thief reusing the phone is the
  loudest signal in a Nigerian theft — it raises a red alert immediately.
- **Reconnect + SIM-change alerts everywhere** — red high-priority banner and device
  activity feed on the dashboard Overview and Agents pages; the desktop agent shows the
  same banner plus a native OS notification with click-to-open.
- **Push notifications** — zero-dependency VAPID web-push. The server auto-pushes on
  every reconnect/SIM change; a service worker fetches the fresh alert and notifies the
  owner even with the dashboard closed.
- **SMS fallback alerts** — text the owner when a device reconnects or its SIM changes,
  for owners with no data or Wi-Fi. Provider-agnostic: Twilio or Termii (Nigeria-native,
  DND-friendly). Rate-limited (1/min, 10/hr) to prevent abuse.
- **Neon Postgres storage** — dual-mode storage: JSON file locally, or hosted serverless
  Postgres the moment `DATABASE_URL` is set (auto-schema, serialized write-through,
  refuses to boot if Neon is unreachable).
- **Offline recovery kit** — post-flash reality (FRP/Activation-Lock bricking), SCID +
  NIN-linked-SIM carrier escalation, Samsung SmartThings Find, powered-off beaconing
  nuance, and a printable one-page police action card.
- **Deployment-ready** — `server/Dockerfile` + `server/render.yaml` (Render Blueprint),
  `NEXT_PUBLIC_SYNC_SERVER_URL` build-time override, `docs/DEPLOY.md` full walkthrough
  (Render + Vercel + Neon + SMS).

## Downloads

- **Windows agent:** `TrackNaija Agent Setup 0.2.0.exe`
- **Android APK:** `TrackNaija-Agent-0.1.0-debug.apk`

## Full changelog

- Desktop agent restructured into `ui.js` + `offline-vault.js`; boot smoke-tested
- Webcam-command race fixed (defers until the agent window is ready)
- Notification bell with unread badge, mark-read, enable-push and test push
- SIM-change shown as a red banner + red activity rows (Overview + Agents pages)
- 18-step server E2E incl. alerts, VAPID push, settings and SMS test
- `server/sms.js` — Twilio + Termii + console log mode, phone masking on public GET,
  Nigeria `+234(0)…` dialing normalized
- `.gitignore` hardened; repo published to GitHub with installers excluded from git
