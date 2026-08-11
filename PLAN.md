# 💻 TrackNaija — Lost Laptop & Phone Tracking & Recovery (Nigeria)

> **Working title:** TrackNaija (placeholder — pick a brand name later)
>
> **Status:** Phase 1–2 scaffold · **Verdict:** ✅ Feasible — agents in `desktop/` (laptops), `android/` (phones), `ios/` (companion), command center in `web/` (Next.js dashboard)

---

## 1. Vision

A **loss-prevention, recovery, and sustainability platform for laptops and desktops in Nigeria.**

Three promises to the user:

1. **"Never lose it"** — protect your laptops before they're stolen (device vault with serial numbers).
2. **"If lost, get it back"** — a tracking agent installed on the machine reports Wi-Fi/IP location, and lost mode turns the webcam into a thief catcher.
3. **"Every recovery saves the planet"** — each recovered laptop keeps ~300 kg of CO₂e out of the air; recovery and repair beat replacement.

**Why this product:** Laptops are prime theft targets in Nigerian offices, schools, cyber cafes and markets. Windows "Find my device" is weak, Linux has nothing standard, macOS Find My only works on Apple — and victims end up paying informal "trackers" ₦30,000+ with no transparency. A cross-platform agent + a formal reporting pipeline fills a genuine gap.

---

## 2. The Four Product Pillars

### Pillar A — Protection (loss *prevention*)
- **Device Vault:** register every laptop/desktop with its **serial number** captured up front (auto-detected by the agent, or via sticker / `wmic` / `ioreg` / `dmidecode`).
- **Agent persistence:** the desktop agent sits in the tray, can auto-start with the OS, and keeps polling location — so the machine is findable the moment it's online.
- **Data-light by design:** Wi-Fi scans and tiny IP lookups cost nothing on Naira data plans.

### Pillar B — Recovery (the tracking engine)
- **Signal ladder** (laptops have no GPS/IMEI): **Wi-Fi positioning → IP geolocation → last-known fix**.
- **Remote commands:** lock screen with message, loud alarm.
- **Webcam capture** — the killer feature: in lost mode, the moment someone uses the laptop, capture the thief's face as evidence.

### Pillar C — Formalization (the Nigeria-specific wedge)
- **Stolen serial registry:** report theft once → police report generated (NPF NCCC / CRP channels) → serial listed publicly so **second-hand buyers can check before buying** (Computer Village impact).
- **Recovery kit:** police report + registry ref + community sightings + **insurance claim pack** (proof of ownership from the vault).
- No carrier/NCC angle — laptops have no IMEI — but the police + registry + community pipeline is just as strong.

### Pillar D — Sustainability (environment)
- **Impact tracking:** "Your recovery saved ~300 kg CO₂e" (a laptop's manufacturing footprint).
- **Verified second-life marketplace:** serial-cleared refurbished laptops; repair network — repair over replace.
- **Recycling drop-off locator + rewards.**

---

## 3. What's Technically Possible (honest boundaries)

| ✅ We CAN build | ❌ We CANNOT build |
|---|---|
| Installed agent (Windows/macOS/Linux) reporting Wi-Fi + IP location | Survive a full OS reinstall / disk wipe (kernel/EFI-level only) |
| Lost-mode webcam capture with consent | Stealth hidden capture (must be user-visible by policy) |
| Remote lock (workstation lock), loud alarm, tray persistence | BIOS/UEFI-level lock (OEM-only) |
| Serial registry + police report + community sightings | GPS on machines without cellular modems |
| Web dashboard command center for owners/admins | Access to Apple Find My / Windows Find my device internals |

**Key insight:** macOS users have Activation Lock; Windows users have a weak "Find my device"; Linux users have **nothing**. A cross-platform agent (Electron/Tauri) that works identically on all three is the differentiator.

---

## 4. The Tracking Engine — "Signal Ladder" (core IP)

Laptops have no GPS and no IMEI. The ladder is:

1. **Wi-Fi positioning** — scan nearby BSSIDs (`netsh`, `airport -s`, `nmcli`), resolve against a Wi-Fi geolocation DB → indoor-accurate (30–100 m).
2. **IP geolocation** — public IP lookup (`ipapi.co`) → city-level (1–2 km), always available when online.
3. **Last known fix** — the honest answer when offline; marked with original timestamp.

Every fix records `{ lat, lng, accuracy, source, ipAddress, networks, timestamp, confidence }`.
The agent polls every 2 minutes while running and stores the last fix locally (JSON in the app data dir); Phase 2 syncs fixes to the backend (PostGIS) for the web dashboard.

### Lost mode
- Fast polling + immediate locate on enable
- Webcam capture triggers (with visible consent rules) — evidence photos stored + timestamped
- UI + tray indicator so the owner always knows the state

---

## 5. Architecture

```
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────┐
│  Desktop Agent       │      │  Web Dashboard       │      │  Admin Console   │
│  (Electron → Tauri)  │      │  (Next.js)           │      │  (internal)      │
│  installed on laptop │      │  command center for  │      │  moderation,     │
│  tray + agent UI     │      │  owners & admins     │      │  incident triage │
└──────────┬───────────┘      └──────────┬───────────┘      └────────┬─────────┘
           │  fixes / evidence (Phase 2)  │                           │
           └──────────────┬───────────────┴───────────────────────────┘
                          ▼
                 ┌──────────────────┐
                 │  Backend         │
                 │  Appwrite Cloud  │   ← auth, DB, realtime, storage
                 │  + PostGIS       │
                 └──────────────────┘
```

---

## 6. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Desktop agent** | **Electron** (v1) → **Tauri** (v2, smaller binaries) | Cross-platform tray agent; reuses the React/Tailwind design system |
| **Web dashboard** | **Next.js + React + Tailwind** | The command center; already built |
| **Backend** | **Appwrite Cloud** | Postgres/PostGIS, auth, realtime, storage; self-hostable later |
| **Maps** | **Google Maps Platform** | Best Nigeria coverage; static tiles for cheap previews |
| **Wi-Fi geolocation** | Google Geolocation API / Mozilla Location (Phase 2) | Resolves BSSIDs to coordinates |
| **Payments** | **Paystack / Flutterwave** (Phase 3) | ₦ pricing, PayID |
| **Packaging** | **electron-builder** (NSIS / DMG / AppImage) | One command per platform |

---

## 7. Data Model (high level)

- `users` — profile, consent records, contact info
- `devices` — brand/model, **serialNumber**, owner, status, linked agent id
- `location_fixes` — PostGIS point + accuracy/source/ip/confidence
- `incidents` — lost/stolen reports (status: lost → reported → sighted → recovered)
- `sightings` — community reports (anonymized, verified)
- `evidence` — webcam captures, timestamps (Phase 2 upload)
- `registry_entries` — the public stolen-serial registry (used by the serial check)
- `repairers` / `listings` / `recyclers` — sustainability marketplace entities
- `impact_log` — CO₂e saved per recovery

---

## 8. Competitive Landscape & Pricing

| Player | Focus | Gap they leave |
|---|---|---|
| **Prey** | Cross-platform agent tracking | Foreign pricing ($2.99/mo), no Nigeria pipeline |
| **Cerberus / Anti-theft apps** | Phone anti-theft | Phone-only, foreign pricing |
| **macOS Find My / Windows Find my device** | OS-native | Apple-only / weak, no registry or police pipeline |
| **Informal fixers** | "Tracking for ₦30,000+" | Expensive, opaque, often fraudulent |
| **Hexaguard** | Phone IMEI verification | Phone-focused, no laptop agent |

**Our pricing play:**
- **Freemium:** free forever = vault, reporting, serial check, last-known location.
- **Pro:** **₦200–500/month** (≈ ₦2,500–6,000/yr) — live tracking, webcam catch, remote lock/alarm.
- **Insurance partnership:** embed micro-insurance (Scrella-style ₦5,500+ /yr) with telemetry-backed claims.

**The whitespace:** no one combines a cross-platform laptop agent + serial registry + police pipeline + sustainability in one app with Naira pricing.

---

## 9. Roadmap

### Phase 0 — Foundation & Compliance (weeks 1–3)
- ✅ NDPC registration as data controller; DPO; privacy policy; DPIA for location + webcam data
- ✅ Play Store / OS policy review (webcam only with consent; no stealth)
- ✅ CAC entity, brand name, domain

### Phase 1 — MVP: Agent + Report & Protect (weeks 4–10) ⬅️ **current build**
- **Desktop agent (Electron):** tray, auto-start (opt-in), Wi-Fi/IP signal ladder, lost mode, webcam capture, lock/alarm, serial auto-capture
- **Web dashboard:** device vault (serial), 4-step reporting wizard → police report + serial registry + claim pack, **Serial Check** for buyers, impact dashboard
- Agent ↔ dashboard link (pairing code) — Phase 2 backend, but UI scaffolding ready

### Phase 2 — Live Sync & Remote Commands (weeks 11–20)
- Appwrite backend: auth, PostGIS fix sync, device pairing
- Remote commands from the web dashboard (lock/alarm/webcam) pushed to the agent (FCM/WebSocket)
- Real Wi-Fi geolocation DB lookup (Google Geolocation API)
- Tauri migration for smaller installers; field test on low-end laptops

### Phase 3 — Community & Sustainability (weeks 21–30)
- Public stolen-serial registry + verified sightings
- **Serial check for used-laptop buyers** (growth channel)
- Second-life marketplace + repair network onboarding
- Impact dashboard live; monetization launch (Paystack/Flutterwave)

### Phase 4 — Scale & Partnerships (months 7+)
- Partnerships: NPF alignment, insurers, OEMs, corporate fleets (B2B)
- Data-driven public dashboard (recovery stats) — press/PR angle

---

## 10. Nigeria-Specific Considerations

- **NDPA 2023:** explicit consent, DPIA for location + webcam data, NDPC registration, encryption.
- **Webcam ethics & law:** capture only in lost mode with visible consent; store encrypted; never silent surveillance. This is both law and good store policy.
- **Serial registry design:** anonymized sightings; only the owner sees exact locations; code of conduct; legal review to avoid vigilantism.
- **Device reality:** Windows dominates; macOS second; Linux growing (devs/students). Serial capture needs admin rights on Windows (`wmic`) — handle gracefully.
- **Language:** Pidgin-English UI option later.
- **Payments:** Paystack/Flutterwave; free tier genuinely useful.

---

## 11. Monetization (summary)

1. **Freemium:** free = vault, reporting, serial check, last-known. **Pro ₦200–500/mo** = live tracking, webcam catch, remote commands.
2. **Marketplace fees** on refurbished/repair transactions.
3. **B2B/insurance:** device insurers per claim-resolution; corporate fleet tracking.
4. **Sustainability grants/partnerships** (e-waste, telecom CSR).

---

## 12. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **OS reinstall defeats the agent** | Be honest: app-level agents survive casual theft, not wipes. Offer FDE/BIOS-lock guidance + serial registry as the backstop |
| **Webcam privacy backlash** | Strict consent model, visible indicators, encrypted storage, published policy |
| **Low-end Windows machines** | Agent is tiny (Electron ~100 MB, Tauri ~10 MB later); no background bloat |
| **Registry → vigilantism** | Anonymous sightings, moderation, only owner sees exact location |
| **Regulatory (NDPC)** | Compliance-first Phase 0, DPO, transparent practices |
| **Agent malware flags** | Sign the app (code signing), transparent permissions, no stealth behavior |

---

## 13. Design System (ui-ux-pro-max generated)

Persisted in `design-system/tracknaija/MASTER.md` and mirrored in both apps:

| Token | Value |
|---|---|
| Style | **Trust & Authority** |
| Primary | `#2563EB` (trust blue) |
| CTA / accent | `#F97316` (orange) |
| Background | `#F8FAFC` · Text `#1E293B` |
| Fonts | Fira Sans (UI) + Fira Code (serial/IMEI-type data) |
| Motion | 150–300 ms; respect `prefers-reduced-motion` |

---

## 14. Phone Agents (Android + iOS companion)

### Android agent (`android/`)
Full tracking app — the desktop signal ladder **plus GPS**:

| Feature | Implementation |
|---|---|
| Signal ladder | GPS → Wi-Fi/cell (fused provider) → last-known, with accuracy/battery/confidence |
| Foreground service | Battery-aware polling (5 min idle / 10 min low-battery / 20 s lost mode), Android 14+ `FOREGROUND_SERVICE_LOCATION` |
| Pairing | Same pairing-code flow as the desktop agent → same sync server |
| Remote commands | Loud alarm + **webcam evidence** (CameraX), polled from the dashboard |
| Permissions | Fine/coarse location, camera, notifications, foreground service; background-location declared for future "allow all the time" |

Build: open `android/` in Android Studio (AGP 8.7.3, Kotlin 2.0.21, compileSdk 35, minSdk 26).

### iOS companion (`ios/`)
**iOS blocks third-party background tracking**, so the iOS app complements Apple Find My instead:

| Capability | Reality |
|---|---|
| Last-known location | One-shot when-in-use fix uploaded on demand (no background service) |
| Live tracking | **Apple Find My** — the app deep-links to `findmy://` and icloud.com/find with step-by-step guidance |
| Reporting | Police report generator + stolen registry listing (same pipeline as desktop) |
| Pairing | Same pairing flow; serial is identifier-for-vendor (iOS hides hardware serials) |

Build: create the Xcode project on macOS per `ios/README-Xcode.md` (SwiftUI, no dependencies).

### Platform matrix

| Signal | Desktop | Android | iOS |
|---|---|---|---|
| GPS | ❌ | ✅ best | ✅ on-demand only |
| Wi-Fi / cell | ✅ | ✅ | via Apple only |
| IP | ✅ | ✅ | ✅ on-demand |
| Webcam | ✅ | ✅ | ❌ (Apple Find My) |
| Remote lock | ✅ OS-level | partial (Device Admin, deprecated) | via Find My (Activation Lock) |

**Bottom line:** Android is a full agent; iOS is a companion + Find My steering. Both feed the same
sync server, dashboard, registry and incident pipeline.

## 15. Repo Structure

```
TrackingApp/
├── PLAN.md                    ← this plan
├── README.md                  ← how to run everything
├── design-system/tracknaija/  ← generated design tokens
├── desktop/                   ← Electron agent (installed on laptops)
│   ├── src/main.js            ← window, tray, IPC, tracking loop
│   ├── src/tracking-engine.js ← signal ladder: Wi-Fi → IP → last known
│   ├── src/commands.js        ← device info, serial, lock, alarm
│   └── src/renderer/          ← agent dashboard UI
└── web/                       ← Next.js command center
    ├── app/                   ← landing, dashboard, devices, incidents, serial-check, impact, track
    └── lib/                   ← types, mock data, localStorage store
```

---

## 15. Immediate Next Steps

1. Pick the brand name & register domain/CAC entity
2. Sign up: Appwrite Cloud (backend) + Google Maps Platform + Google Geolocation API
3. Phase 2: wire agent ↔ dashboard pairing + fix sync + remote commands
4. NDPC registration + DPO + privacy policy before real-user data

> **Bottom line:** Feasible and differentiated. The **cross-platform laptop agent** (Windows/macOS/Linux) with **webcam catch** is the technical moat; the **stolen-serial registry + police pipeline** is the Nigeria-specific wedge; the **sustainability angle** is the PR and partnership lever. Build on the Phase 1 scaffold in `desktop/` and `web/`.
