# Dravex — Master Specification (NextGen)

> **Status:** live source of truth. This document supersedes the inconsistent
> architecture notes in `PLAN.md` (historical plan), `README.md` (run guide)
> and `design-system/dravex/MASTER.md` (design tokens). Where they disagree,
> this file wins. It reconciles those documents with what is **actually
> built** in this repository today.
>
> Product: **Dravex — Nigeria's Device Recovery Network.** Find. Track. Recover.

---

## 1. Product vision & positioning

**One line:** Dravex stops stolen phones and laptops from disappearing into the
Nigerian second-hand market, and brings them back to their owners.

**Positioning (decision):** the moat is the **Device Recovery Network** — the
full chain *agent → detection → recovery mode → stolen registry → community
sightings → verification → recovery*. The webcam capture is **one evidence
source inside that system**, never the headline. Dravex is positioned as a
*recovery* product, not surveillance software.

**What users get:**
1. **Never lose it** — register devices with IMEI/serial up front.
2. **If lost, get it back** — signal ladder, recovery mode, community network,
   registry, police-ready reports.
3. **Don't buy stolen** — public Device Check before any used purchase.
4. **Every recovery saves the planet** — ~300 kg CO₂e avoided per laptop
   replaced by recovery instead of repurchase.

---

## 2. The four pillars (official product architecture)

| Pillar | Definition | Built today |
|---|---|---|
| **Protection** | Prevention: device vault, identity capture, agent persistence, optional auth | ✅ Vault, pairing, owner key + device tokens |
| **Recovery** | The tracking engine + recovery mode + remote commands + evidence | ✅ Signal ladders, lost mode, lock/alarm/webcam, recovery view |
| **Formalization** | The Nigeria wedge: stolen registry, police pipeline, buyer verification | ✅ Live registry + `/api/check`, NPF reports, Device Check |
| **Sustainability** | Impact tracking, verified second-life market, repair network | 🟡 Impact dashboard built; marketplace is Phase 3 |

---

## 3. Canonical architecture (decision record)

**Decision (2026-08):** the zero-dependency Dravex sync server **is** the
backend. It is deployed, tested and already carries production data — it is
not a placeholder to be swapped.

```
Desktop agent ──┐
Android agent ──┼──►  Dravex API / Sync Layer (server/)  ──►  PostgreSQL + PostGIS (Neon today)
iOS companion ──┘                │  ▲
                                 ▼  │  fixes, evidence, commands, alerts, registry, auth
                          Next.js Command Center (web/)
```

- **API/sync layer:** `server/` — zero-dependency Node HTTP server, dual-mode
  storage (JSON file by default → **Postgres/PostGIS** the moment `DATABASE_URL`
  is set). This satisfies "PostgreSQL + PostGIS" today via Neon.
- **Appwrite:** *optional* later for services that genuinely reduce complexity
  (e.g. managed auth), **not** the storage plan. This resolves the
  PLAN.md ("Appwrite backend Phase 2") vs README.md ("swap for Appwrite
  Phase 3") contradiction — neither is correct anymore.
- **Realtime:** web-push (VAPID) for alerts today; WebSocket only if the polling
  model (10–20 s) ever proves insufficient.

---

## 4. Anti-theft & recovery architecture

### 4.1 Phone theft — the Nigerian scenario

```
stolen → powered off → SIM removed → flashed / factory reset → sold → buyer checks → community detects → owner informed
```

| Attack step | What Dravex does | What only OEM/carrier can do | Honest note |
|---|---|---|---|
| Powered off | Beacon stops; last-known + vault evidence retained | Apple Find My / Google Find Hub (hardware) | No app tracks a powered-off phone |
| SIM removed | Identity is device-based, not SIM-based; SIM-change events recorded | — | Dravex identity survives the SIM |
| Data/Wi-Fi off | Community BLE beacon (while lost) + offline vault burst sync | — | Works on, offline |
| Factory reset | App is wiped — FRP / Activation Lock block reuse; stolen registry carries the IMEI | Android FRP, Apple Activation Lock, carrier IMEI block (NCC DMS) | App layer ends at the wipe |
| Sold | Buyer runs Device Check on IMEI → 🟢/🔴 | Carrier/NCC IMEI trace | Registry makes it unsellable |
| Reused | New SIM → reconnect event + SIM-change alert to owner | Carrier tower ping + NIN trace (with police) | The 12h-gap reconnect is the alert |
| Community | Any Dravex device hears the beacon → anonymous sighting → map + alert | — | Android-to-Android today |

### 4.2 Laptop theft — the flow

```
agent loses connection → Wi-Fi/IP signal recovered → thief changes network → lost mode → remote commands → evidence → stolen registry → buyer verification → recovery
```

1. Agent goes quiet → owner sees "offline · data off?" and last-known position.
2. Laptop rejoins any network → fix uploads; after a 12 h+ gap the server raises
   a **reconnected** alert (push + SMS fallback).
3. Owner marks **lost** → registry listing + commands queue (lock / alarm /
   webcam) → the next user gets a webcam evidence capture.
4. Buyer checks the serial at Computer Village → verdict.
5. Owner exports the **incident report** (IMEI/serial, timeline, sightings,
   evidence, owner + station fields) for NPF/SCID.

---

## 5. Device Identity System

**Dravex identity ≠ phone number ≠ SIM card.** Removing the SIM removes only one
communication channel.

```
Device identity
├── deviceId      — UUID, minted at pairing (permanent)
├── token         — per-device API credential, issued at claim, rotatable
├── serialNumber  — laptops (Windows/macOS/Linux auto-capture)
├── imei          — phones (entered/reported by the agent)
├── staticBeacon  — Dravex Tag hardware (12-hex, NVS-persisted)
├── beacon id     — rotating daily: sha256(deviceId|day)[0..12] — privacy
├── recoveryCode  — owner-set PIN delivered with the `lost` command
└── owner account — dashboard + owner key (DRAVEX_OWNER_KEY)
```

---

## 6. Signal & Location Engine (the ladder)

Best signal first; every fix records `{lat, lng, accuracy, source, confidence,
timestamp, networks, ipAddress/battery}`.

### Desktop (no GPS, no IMEI)
1. **Wi-Fi fingerprint** — `netsh` / `airport -s` / `nmcli` scan → BSSID list
   uploaded with every fix (the fingerprint is itself a locate signal).
2. **IP geolocation** — `ipapi.co` lookup (city-level, ±1.2 km, always online).
3. **Last known fix** — honest fallback, marked `last_known`.

> **Honest status:** today's desktop *Wi-Fi* position is a demo mapping (the
> fingerprint is real, the coordinate is not yet DB-resolved). The Phase-2
> upgrade is BSSID→coordinate lookup (Google Geolocation API / Mozilla
> Location). IP position is real.

### Android (phone)
1. **GPS / fused location** (play-services) — outdoor accurate.
2. **Wi-Fi / cell** (fused) — indoor fallback; classified by accuracy
   (`gps ≤ 25 m`, `wifi ≤ 200 m`, else `cell`).
3. **Last known fix.**
4. **Network fingerprints ride with every fix** — nearby Wi-Fi BSSIDs *and*
   cell towers (MCC/MNC/LAC/CID), so a stolen device is recognizable by its
   surroundings, not just coordinates. Cell fingerprint works with data off.

Polling: desktop 2 min; Android battery-aware (5 min idle, 10 min low-battery,
**20 s in lost mode**).

---

## 7. Offline detection strategy

1. **Community BLE beacon** — the Android agent *advertises* only while marked
   lost (privacy-first) and *scans* for other lost devices (~12 s every 5 min),
   reporting anonymous sightings with the **scanner's** position.
2. **Offline vault + burst sync** — fixes/evidence/events pile up locally while
   offline and upload in one `batch` call the moment *any* network appears
   (Wi-Fi, new SIM data — a `ConnectivityManager` callback fires the flush).
3. **SIM-change detection** — reads the cellular radio state (MCC/MNC), which
   works with mobile data off; two-check debounce against radio flapping.
4. **Reconnect detection** — a fix after a 12 h+ gap records a `reconnected`
   event + alert (push + SMS fallback).

**Honest limits:** powered-off, battery-removed, Faraday-bagged or destroyed
devices are invisible to any software. iOS blocks third-party background BLE
advertising, so the relay is Android-to-Android today. OEM battery managers
(Samsung/Tecno/…) may kill background scans unless the app is exempted.

---

## 8. Recovery Mode

Marking a device **lost** (`POST /api/devices/:id/lost`, owner-only) triggers:

- `lost` flag → **community beacon armed** (phone) / alerts active (all).
- **Recovery code** generated/kept → returned to the owner, delivered to the
  phone inside the `lost` command payload.
- **Registry listing** (IMEI/serial → public check).
- `lost` event + `stolen` alert; `found` reverses all of it (beacon off,
  registry resolved, `found` event).
- Command queue: `lock`, `alarm`, `webcam` (polled by agents every 10 s).

**The recovery view** (`/dashboard/recovery/[id]`) shows: STOLEN banner,
last-known + accuracy, offline/SIM status, **recovery confidence score**
(fix recency + sighting recency + evidence), **movement** (haversine between
fixes), the merged **recovery timeline** (reported → went offline → SIM changed
→ back online → community sightings), and honest-limits guidance.

**App-level ownership lock (Android):** while lost with a recovery code, the
app demands the code before it can be used again — the FRP-style barrier that
survives app restarts (it does not survive a factory reset; nothing app-level
does).

---

## 9. Stolen Device Registry

- **Fed automatically** when an owner marks a device lost; **resolved** when
  found (resolving clears *every* active report on that device's identifiers —
  a recovered device must read clean again).
- **Public check** — `GET /api/check?q=<IMEI|serial>`:
  - 🟢 `clean` — no active report (resolved entries say "previously reported").
  - 🔴 `reported_stolen` — do not buy; report to police.
  - **Never leaks** owner name, deviceId or location (labels are generic
    "A phone"/"A laptop"); rate-limited (30/min/IP) against enumeration;
    active reports always win over stale resolved ones.
- **How to find identifiers:** `*#06#` for IMEI; `wmic bios get serialnumber`
  / About This Mac / `dmidecode` for serials.

---

## 10. Community Recovery Network

- Any Dravex device that hears a lost device's beacon reports an **anonymous
  sighting** with its own position — no account, no deviceId, no owner data.
- Sightings are stored **only for lost devices**; alerts throttled (1/30 min);
  unknown beacons are swallowed with a 201 so the network can't be probed.
- The desktop **map view** plots device fixes + sighting markers, draws the
  **nearest-device-to-sighting** line and panel, and the **Find nearby** sweep
  lets a laptop join the relay. Sightings feed the recovery confidence score.
- Privacy: beacon ids rotate daily; sightings never expose the reporting device.

---

## 11. Device resale / Device Check

The market feedback loop that makes fencing unprofitable:

```
owner marks lost ──► registry listing ──► buyer checks IMEI/serial ──► 🔴 don't buy
                                              ▲
                     Computer Village / online marketplaces ─────────┘
```

- **Built:** `/dashboard/serial-check` (now **Device Check**) with an IMEI/serial
  toggle against the live registry; the Android app has the same check built in
  (Device Check card — useful on a fresh install after a flash).
- **Phase 3:** verified second-life marketplace + repair network; NCC IMEI
  Device Management System integration *requires operator/regulator
  partnership* — Dravex can generate the report and the IMEI list, it cannot
  block devices by itself.

---

## 12. Security & anti-tampering

- **Optional auth:** `DRAVEX_OWNER_KEY` env var. Unset = zero-config open API
  (Phase-1 mode). Set = owner endpoints need `Bearer <key>`; agent endpoints
  need the per-device token (issued at claim, rotatable via
  `POST /api/devices/:id/token`). Web dashboard (owner-key card) and desktop
  (Settings field) both carry the key; Android stores its token automatically.
- **Recovery code + ownership lock** — the app-level reactivation barrier.
- **No stealth:** webcam only in lost mode with visible indicators; tracking
  only the owner's own devices with consent; no hidden capture (policy and law).
- **Rate limits / anti-abuse:** check endpoint 30/min/IP, sighting alerts
  1/30 min per device, SMS 1/min + 10/rolling hour, ghost-beacon probing
  defeated, alerts ring-buffered.
- **Anti-enumeration:** `/api/check` and `/api/sightings` answer identically
  for unknown inputs.

---

## 13. Backend architecture (`server/`)

Zero-dependency Node HTTP server; dual-mode storage (JSON file ↔ Postgres when
`DATABASE_URL` set — same API contract). Deployed on Render today.

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | public | liveness + device count + storage mode |
| `GET /api/check` | public (rate-limited) | stolen-device verdict (IMEI/serial) |
| `POST /api/sightings` | public | anonymous community BLE sighting |
| `POST /api/pair/register` | owner | mint pairing code |
| `POST /api/pair/claim` | code (credential) | link agent → `{deviceId, token}`; accepts `staticBeacon` |
| `GET /api/devices` | owner | all paired devices |
| `GET /api/devices/:id` | owner/device | detail (events, sightings, meta) |
| `GET/POST /api/devices/:id/fixes` | owner/device / device | read / upload fixes |
| `POST /api/devices/:id/batch` | device | offline-vault burst sync |
| `GET/POST /api/devices/:id/events` | device / owner+device | SIM changes, reconnects |
| `POST /api/devices/:id/lost` | owner | lost/found + recovery code + registry |
| `POST /api/devices/:id/verify` | owner | **Verified → Recovered** lifecycle step (resolves registry, `recovered` event) |
| `POST /api/devices/:id/transfer` | owner | ownership handover — rotate credential, clear registry, fresh pairing code |
| `PUT /api/devices/:id/recovery-message` | owner | one-way message shown to a finder |
| `POST /api/devices/:id/contact` | public (rate-limited) | anonymous finder→owner message (only stored while lost) |
| `POST /api/geolocate` | owner/device | BSSID fingerprint → real coordinate (Google/Mozilla, cached; 501 honest when unconfigured) |
| `GET /api/nearest` | owner | nearest device fix to a point (PostGIS `ST_Distance` on Neon / haversine in file mode) |
| `GET /api/devices/:id/sightings` | owner/device | community sightings |
| `GET/POST /api/devices/:id/evidence` | owner/device / device | webcam evidence |
| `GET/POST /api/devices/:id/commands` + `/ack` | device poll / owner queue | remote commands |
| `POST /api/devices/:id/token` | owner | rotate agent credential |
| `GET /api/alerts/latest`, `POST /api/alerts/read` | owner | alert feed |
| `GET/POST /api/settings`, `POST /api/sms/test` | owner | SMS fallback config |
| `GET /api/push/vapid-key`, `POST /api/push/(subscribe\|test)` | owner | web-push |

**Limits:** fixes 100/device, alerts 50 ring buffer, sightings 50/device,
body cap 5 MB (evidence data-URLs), sighting alert throttle 30 min. Rate
limiters (sliding 60 s, per-IP): check 30/min, claim 10/min (codes lock after
5 failed attempts), sightings 30/min (+ 5-min dedupe by beacon+position),
contact 5/min. Alert delivery: web-push + SMS fallback + `ALERT_WEBHOOK_URL`
(email/webhook sink).

---

## 14. Database schema

The store is a single JSON-shaped object (file mode) / mirrored tables (Neon).
PostGIS point columns are the Phase-2 migration for coordinates.

```
devices[]  { deviceId, hostname, serialNumber, imei, platform, token, staticBeacon,
             pairedAt, lastSeenAt, reconnectedAt, lastFix, fixes[], evidence[],
             commands[], events[], sightings[], lost, recoveryCode, verifiedAt,
             transferredAt, recoveryMessage, contactMessages[] }
geoCache   { "A0:36:9F:11:22:33": { lat, lng, accuracy, at } }   (30-day TTL)
dravex_points (Neon/PostGIS) { device_id, kind (fix|sighting), point geometry(Point,4326), recorded_at } + GiST index
stolen[]   { id, deviceId, type, imei, serialNumber, label, status(reported|resolved),
             reportedAt, resolvedAt }
alerts[]   { id, type, deviceId, hostname, body, at, read }
pairCodes  { code → deviceId }
pushSubscriptions[] { endpoint, keys, createdAt }
settings   { ownerPhone, smsEnabled, smsLastSentAt, smsLastResult }
```

---

## 15. Desktop agent architecture (`desktop/`)

Electron (Windows/macOS/Linux), single instance, tray-resident.

- **`tracking-engine.js`** — the ladder (§6), 2-min loop + on-demand `trackNow`.
- **`offline-vault.js`** — fixes/evidence/events held offline, burst batch sync.
- **`ble-scan.js` + `ble-scan.ps1`** — Windows-native BLE watcher for
  `0000fffa` + `[0x01]`+12-hex beacons; heard beacons become sightings with
  this machine's position (the laptop joins the relay).
- **Commands** — `lock`/`alarm`/`webcam` (CameraX-style capture, consent-gated).
- **Lost mode** — fast locate + webcam armed; tray + UI indicator.
- **Dashboard UI** — Overview (signal ladder, anti-theft), Devices (IMEI/serial,
  operator, mark-lost), **Map** (Leaflet: fixes + sightings + proximity),
  **Find nearby** (BLE sweep), **Alerts** (live feed), Settings (server link,
  **owner key**, report details). **Incident report** export (self-contained
  HTML with IMEI, timeline, sightings, evidence, owner/station → NPF/SCID).
- **Identity** — serial auto-capture; `deviceToken` stored at claim; state
  migration from the pre-rebrand userData dir.
- Packaging: electron-builder NSIS/DMG/AppImage; custom icon; SIGNING.md for
  code-signing certs.

---

## 16. Android architecture (`android/`)

Kotlin, minSdk 26, foreground location service.

- **`SignalLadder.kt`** — GPS→wifi/cell→last-known + Wi-Fi/cell fingerprints.
- **`Beacon.kt`** — advertise own beacon **only while lost** (daily-rotating
  id), scan duty-cycle 12 s/5 min, same payload as desktop/`server/beacon.js`.
- **`TrackingService.kt`** — battery-aware polling, connectivity callback →
  vault flush, SIM-change fingerprinting (data-off capable), 10 s command poll.
- **`OfflineVault.kt`** — offline evidence + fixes, batch upload on reconnect.
- **`SyncClient.kt`** — device-token auth; public `checkRegistry()`.
- **Ownership lock** — non-cancelable dialog demanding the recovery code while
  lost (app-level activation barrier).
- **Device Check card** — post-flash IMEI lookup against `/api/check` (the
  honest post-reset layer: the *new* user gets flagged).
- Build: Android Studio (AGP 8.7.x, Kotlin 2.0.x, compileSdk 35), CI-built APK
  via GitHub Actions.

---

## 17. iOS limitations & integration (`ios/`)

iOS blocks third-party background tracking and BLE advertising. Dravex iOS is
an honest **companion**:

| Capability | Reality |
|---|---|
| Last-known location | One-shot when-in-use upload; no background service |
| Live tracking | Apple Find My — deep links + step-by-step guidance |
| Reporting | Same police report + registry pipeline |
| Identity | identifier-for-vendor (iOS hides hardware serials) |

Project files scaffolded in `ios/TrackNaija/` (SwiftUI, no dependencies); build
on macOS per `ios/README-Xcode.md`. Never promise "iPhone tracking" beyond this.

---

## 18. Web command center (`web/`)

Next.js 15 + Tailwind, static-export friendly, owner key in localStorage.

- Landing → dashboard: **Overview** (stats, recovery banner, device activity),
  **My Devices**, **Incidents** (reporting wizard → NPF channels), **Recovery**
  (list + per-device recovery view), **Device Check** (live registry, IMEI +
  serial), **Offline Recovery** (kit + action card), **Agents** (pairing, SMS
  fallback, owner key), **Evidence**, **Impact** (CO₂e), **Track** (signal
  ladder + commands).
- Components: `device-alerts`, `notification-bell` (Web Push), UI kit
  (Card/StatCard/ProgressBar/MapPreview…).
- Design: `design-system/dravex/MASTER.md` tokens (trust blue `#2563EB`,
  accent orange `#F97316`, Fira Sans/Fira Code).

---

## 19. Dravex Tag (hardware prototype)

`tag-firmware/` — Zephyr firmware for nRF52840 recovery beacons (bags, bikes,
items that can't run an app): broadcasts the identical Dravex beacon format
(`0000fffa` + `[0x01]` + 12-hex), silent until armed (long-press button), NVS
identity that survives battery swaps. Server resolves static tag beacons via
`staticBeacon`. Prototype only: no RTC rotation yet, armed battery is days.

---

## 20. Nigeria & NDPA compliance

- **NDPA 2023:** location + webcam data are high-risk. Consent flows
  (`docs/compliance/CONSENT_FLOW.md`), DPIA, NDPC registration, DPO — before
  real-user onboarding.
- **Webcam ethics:** lost-mode only, visible indicators, encrypted, never
  stealth — law and store policy.
- **Registry ethics:** anonymous sightings, generic public labels, only the
  owner sees exact coordinates; legal review against vigilantism.
- **SMS:** Nigerian-friendly via Twilio/Termii (log mode until configured).
- **Operator/NCC:** IMEI trace requires police (NPF NCCC/CRP) → carriers;
  NCC IMEI DMS is a partnership path, not an app feature.

---

## 21. Phased implementation plan (status)

| Phase | Scope | Status |
|---|---|---|
| **1 — MVP** | Desktop agent ladder/lost-mode/webcam; Android agent + beacon; sync server; web vault/reporting; registry + check; recovery mode | ✅ **Done** (this repo) |
| **1.5 — hardened** | Optional auth (owner key + device tokens), ownership lock, post-flash IMEI check, tag firmware | ✅ Done |
| **2 — fidelity** | Real Wi-Fi geolocation (server `/api/geolocate`, Google/Mozilla, cached) ✅ · PostGIS spatial mirror + `/api/nearest` ✅ · ownership transfer + verified lifecycle ✅ · finder contact relay ✅ · hardening (claim rate-limit, CORS allowlist, token-at-rest encryption) ✅ · email/webhook alert sink ✅ · Android boot re-arm + battery protection ✅ · macOS/Linux BLE watchers 🟡 · iOS companion build 🟡 · live SMS provider 🟡 | 🟡 In progress |
| **3 — network** | Second-life marketplace + repair network; verified listings; monetization (Paystack/Flutterwave); public recovery stats | 🔜 |
| **4 — partnerships** | NPF alignment, insurers, OEMs (power-off finding), NCC IMEI DMS, corporate fleets (B2B) | 🔜 |

---

## 22. Possible now vs partnership-dependent

| Buildable now (software) | Needs OEM/operator partnership |
|---|---|
| Signal ladders + fingerprints + recovery view | Powered-off finding (Apple Find My, Google Find Hub) |
| BLE community relay + sightings | Carrier IMEI blocking / NIN trace (police + NCC DMS) |
| Stolen registry + public check | FRP / Activation Lock (already OEM — we integrate around) |
| Recovery mode + evidence + reports | OS-reinstall-proof persistence (EFI-level) |
| App-level ownership lock | Battery-removed / Faraday-bag detection |

---

## 23. What we will NOT promise (honesty contract)

1. **No app tracks a powered-off phone.** Dravex covers *on + any signal*;
   powered-off finding is OEM hardware only (documented per platform).
2. **A factory reset wipes the app.** We say so plainly; the backstops are FRP/
   Activation Lock, the IMEI/serial registry, the carrier trace, and the
   post-flash Device Check.
3. **No stealth webcam, ever.** Lost-mode only, visible, consent-based.
4. **No "always track your phone"** — the beacon broadcasts only while armed
   lost, and sightings are anonymous.
5. **iOS is a companion, not a tracker** — we steer to Apple Find My.
6. **Android 10+ apps cannot read the device's own IMEI** — the Device Check is
   user-entered; we won't claim automatic post-flash self-identification.
