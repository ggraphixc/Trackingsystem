# 💻 Dravex — Lost Laptop & Phone Tracking & Recovery (Nigeria)

A loss-prevention, recovery, and sustainability platform for **laptops and desktops** in Nigeria.
See **[PLAN.md](PLAN.md)** for the full product & technical plan.

> **Status:** Phase 1 MVP scaffold.
> `desktop/` = the agent app **installed on laptops** (Windows/macOS/Linux).
> `web/` = the **command center** (dashboard for owners/admins).
> Data is currently local (agent JSON state / browser localStorage) — Phase 2 wires both to the Appwrite backend (PostGIS).

## Repo layout

| Path | What it is |
|---|---|
| `desktop/` | Electron tracking agent for **laptops/desktops** (Windows/macOS/Linux) — tray app, Wi-Fi/IP signal ladder, lost mode, webcam capture, remote lock/alarm, serial auto-capture |
| `android/` | Android agent app for **phones** — GPS + Wi-Fi/cell signal ladder, foreground tracking service, lost mode, webcam evidence, remote alarm |
| `ios/` | iOS **companion** — last-known-location reporting + Apple Find My guidance + police report (iOS blocks third-party background tracking) |
| `server/` | Zero-dependency sync server — device pairing, fix/evidence sync, remote-command queue (swap for Appwrite in Phase 3) |
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

Phase 1 (here) → Phase 2 live sync + remote commands from the dashboard → Phase 3 community registry & marketplace → Phase 4 partnerships.
Details, pricing, compliance and risk notes: **[PLAN.md](PLAN.md)**.

## Legal / compliance notice

Location and **webcam** data are high-risk under the **Nigeria Data Protection Act 2023**. Before
onboarding real users: register as a data controller with the **NDPC**, appoint a DPO, conduct a
DPIA, and ship a compliant privacy policy + consent flows. The agent tracks **only the owner's own
machines with explicit consent**, captures webcam only in lost mode with visible indicators — no
stealth features, ever.
