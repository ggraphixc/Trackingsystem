# 💻 Dravex — Lost Laptop & Phone Tracking & Recovery (Nigeria)

A loss-prevention, recovery, and sustainability platform for **laptops, desktops and phones** in Nigeria.
See **[DRAVEX_NEXTGENE.md](DRAVEX_NEXTGENE.md)** — the master specification (architecture, anti-theft flows, API, schema, roadmap).
Historical planning lives in **[PLAN.md](PLAN.md)**.

> **Status:** Phase 1–1.5 built & deployed.
> `desktop/` = the agent app **installed on laptops** (Windows/macOS/Linux).
> `web/` = the **command center** (dashboard for owners/admins).
> Agents sync to the **Dravex sync server** (`server/`), which stores in
> **Postgres (Neon)** the moment `DATABASE_URL` is set; without it, the server
> runs on a local JSON file for development.

## Repo layout

| Path | What it is |
|---|---|
| `desktop/` | Electron tracking agent for **laptops/desktops** (Windows/macOS/Linux) — tray app, Wi-Fi/IP signal ladder, lost mode, webcam capture, remote lock/alarm, serial auto-capture |
| `android/` | Android agent app for **phones** — GPS + Wi-Fi/cell signal ladder, foreground tracking service, lost mode, webcam evidence, remote alarm |
| `ios/` | iOS **companion** — last-known-location reporting + Apple Find My guidance + police report (iOS blocks third-party background tracking) |
| `server/` | **Canonical backend** — zero-dependency Node API: device pairing, fix/evidence sync, remote commands, stolen-device registry + `/api/check`, alerts (push/SMS), optional auth (`DRAVEX_OWNER_KEY` + device tokens). Postgres/PostGIS via Neon |
| `web/` | Next.js command center — device vault, lost-device reporting hub → stolen registry, Device Check for buyers (IMEI/serial), Recovery Mode, Agents page, Evidence gallery |
| `design-system/dravex/` | Generated design tokens (palette, typography, style rules) |
| `PLAN.md` | Full product + technical plan |

## Run the desktop agent

```bash
cd desktop
npm install          # installs Electron once
npm run icon         # generates assets/dravex.png (tray + window icon)
npm start            # launches the agent — try it on the machine you want to protect
```

Build installers: `npm run dist` (Windows NSIS / macOS DMG / Linux AppImage).
Syntax check without launching: `npm run check`.

## Run the web command center

```bash
cd web
npm install
npm run dev          # http://localhost:3000 (or 3001 if 3000 is taken)
```

Production build: `npm run build && npm start`

## Phase 1 feature map (built so far)

**Desktop agent (`desktop/`)**
- Signal-ladder tracking: Wi-Fi scan → IP geolocation → last-known fix (2-minute polling)
- Lost mode: fast locate + webcam armed (visible, consent-based)
- Webcam evidence capture with photo preview
- Remote lock screen + loud alarm (Windows/macOS/Linux)
- System tray, opt-in auto-start, serial number auto-capture (`wmic` / `ioreg` / `dmidecode`)

**Web command center (`web/`)**
- Device vault — register laptops with serial numbers (with how-to-find hints)
- 4-step lost-laptop reporting wizard → police report (NPF NCCC / CRP) → **stolen serial registry** → recovery kit
- **Serial Check** — used-laptop buyers verify before paying
- Live track view with Wi-Fi/IP signal ladder + anti-theft command demos
- Impact dashboard — ~300 kg CO₂e saved per recovered laptop

## Roadmap

Phase 1 MVP ✅ → **Phase 1.5 hardened ✅** (auth, ownership lock, Device Check, tag firmware) → **Phase 2 fidelity** (real Wi-Fi geolocation lookup, PostGIS spatial queries, iOS companion build, live SMS) → Phase 3 network (second-life marketplace, repair network) → Phase 4 partnerships.
Details, pricing, compliance and risk notes: **[DRAVEX_NEXTGENE.md](DRAVEX_NEXTGENE.md)** (§21 phased plan). Historical planning: **[PLAN.md](PLAN.md)**.

## Legal / compliance notice

Location and **webcam** data are high-risk under the **Nigeria Data Protection Act 2023**. Before
onboarding real users: register as a data controller with the **NDPC**, appoint a DPO, conduct a
DPIA, and ship a compliant privacy policy + consent flows. The agent tracks **only the owner's own
machines with explicit consent**, captures webcam only in lost mode with visible indicators — no
stealth features, ever.
