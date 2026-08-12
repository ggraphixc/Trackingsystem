# Dravex — Build-Next Audit & Implementation Prompt

> **Status:** audit of `DRAVEX_NEXTGENE.md` against the **actual repository**
> (verified against code on 2026-08-12) and the **Nigerian theft model**.
> The rule that governs all further work:
>
> | Doc | Role |
> |---|---|
> | **`DRAVEX_NEXTGENE.md`** | **Canonical architecture** — where anything disagrees, this wins |
> | `PLAN.md` | Historical reference only (do not build from it) |
> | `README.md` | Implementation / setup documentation only |
>
> End of this document: **one precise implementation prompt** (§14) — paste it
> into any capable agent and it will build the next milestone without making
> architectural assumptions.

---

## 1. Audit verdict (summary)

`DRAVEX_NEXTGENE.md` is **accurate about what is built** — every "Built today"
claim was checked against code and holds. The repository is a genuine
Phase 1–1.5 scaffold, not a mock. What the spec **under-specifies** is the
*fidelity* layer (real geolocation), the *second-life/transfer* lifecycle step,
and *hardening* (token-at-rest, CORS, claim rate-limit). Those are the gaps
this audit turns into the implementation prompt.

Legend: ✅ verified in code · 🟡 partial / needs work · 🔴 missing · ⛔ impossible by physics/platform

---

## 2. What is correctly designed (verified)

| Spec claim | Code evidence | Verdict |
|---|---|---|
| Desktop signal ladder: Wi-Fi scan → IP → last-known | `desktop/src/tracking-engine.js` (netsh/airport/nmcli parse, `ipapi.co`) | ✅ |
| Android ladder: GPS → wifi/cell → last-known + Wi-Fi **and cell** fingerprints | `SignalLadder.kt` (TelephonyManager MCC/MNC/LAC/CID, data-off capable) | ✅ |
| SIM-change detection, radio-based, 2-check debounce | `TrackingService.kt` (~L250, `TelephonyManager` state, flapping guard) | ✅ |
| Reconnect alert after 12 h+ offline gap | `server/server.js` `gapHours > 12` → `reconnected` event + alert | ✅ |
| Stolen registry: auto-fed on mark-lost, active-wins, resolve clears all reports on the device's identifiers | `server/server.js` `syncRegistry` / `registryLookup` / `resolveBeacon`-adjacent logic; e2e 29/29 | ✅ |
| Public check never leaks owner/deviceId; generic labels | `/api/check` returns type/label only, rate-limited 30/min/IP (`checkHits`) | ✅ |
| Optional auth: `DRAVEX_OWNER_KEY` + per-device tokens, rotate endpoint | `server/server.js` `ownerOk/deviceOk`; `POST /api/devices/:id/token`; e2e-auth 11/11 | ✅ |
| Beacon: advertises only while **lost**, daily-rotating id, anonymous sightings | `Beacon.kt` (AdvertiseSettings/ScanSettings, day-bucket id); `server/beacon.js` | ✅ |
| Sighting alert throttle 1/30 min; unknown beacons swallowed (201) | `SIGHTING_ALERT_MIN_MS = 30*60_000`; `server/beacon.js` | ✅ |
| Android ownership lock (recovery-code barrier on app restart) | `MainActivity.kt` non-cancelable dialog; recovery code in `lost` command | ✅ |
| Post-flash Device Check in the Android app | `SyncClient.checkRegistry()` + Device Check card | ✅ |
| Offline vault + burst batch sync | `desktop/offline-vault.js`, `OfflineVault.kt`, `POST /api/devices/:id/batch` | ✅ |
| iOS honest companion (last-known, Find My guide, report) | `ios/TrackNaija/` SwiftUI scaffold | ✅ (unbuildable on Windows) |
| Dravex Tag firmware prototype | `tag-firmware/` Zephyr nRF52840, NVS identity | ✅ (prototype) |
| SMS fallback, throttle 1/min | `server/sms.js`, `smsLastSentAt` guard | ✅ (log mode until provider keyed) |

---

## 3. What is missing (gaps, ranked by product impact)

1. 🔴 **Real Wi-Fi geolocation (desktop fidelity).** The Wi-Fi *fingerprint* is
   real, but the coordinate derived from it is demo-mapped — the single biggest
   honesty/fidelity gap in the product. Needs a server-side BSSID→coordinate
   resolver (Google Geolocation API / Mozilla Location Service) with caching,
   and honest fallback to IP when the resolver fails.
2. 🔴 **PostGIS.** Neon is plain Postgres today; coordinates are JSON
   `lat/lng` and "nearest device to sighting" is computed in JS. Migration:
   `geometry(Point,4326)` columns + index + SQL distance queries.
3. 🔴 **Ownership transfer + "Verified" lifecycle step.** The vision lifecycle
   is *Protected → Lost → Stolen → Detected → Sighted → **Verified** →
   Recovered*. There is no `transfer` endpoint and no verification UI — the
   second-hand sale (registry-clear + ownership handover) is the natural
   endgame of the Device Check feature and it is not implemented.
4. 🔴 **Secure owner↔finder contact.** The recovery vision promised a secure
   one-way channel ("found it — contact owner") without leaking either side's
   identity. Not built. Design: owner sets a recovery message + contact
   preference on the recovery view; finder submits a message that lands in the
   owner's dashboard, never revealing the finder's identity.
5. 🟡 **macOS/Linux BLE scan.** `ble-scan.js`/`ble-scan.ps1` is Windows-native
   (WinRT/PowerShell). macOS (CoreBluetooth) and Linux (BlueZ) laptops cannot
   hear beacons — the community relay is Android-to-Android + Windows-desktop
   today.
6. 🟡 **Alert reach.** SIM-change and reconnect alerts reach the owner only via
   web-push (needs an open browser with a subscription) or SMS (needs provider
   key). No email/webhook fallback.
7. 🟡 **SMS provider live.** `sms.js` is in log mode until a provider
   (Twilio/Termii) credential is configured.
8. 🟡 **Android OEM battery whitelist UX.** Foreground service survives, but
   Samsung/Tecno/Infinix battery managers kill background scans. Needs an
   in-app "protect from battery optimization" flow (IgnoreBatteryOptimizations
   + per-OEM whitelist guidance).
9. 🟡 **iOS brand remnant + build.** Folder is still `ios/TrackNaija/` (kept to
   avoid breaking the Xcode project). Rename when the project is regenerated
   on a Mac; SwiftUI scaffold is untested.
10. 🟡 **Tag firmware fidelity.** No RTC day-rotation yet, no deep-sleep duty
    cycle, battery measured in days. Hardware bring-up + rotation before any
    real deployment.
11. 🟡 **Lost-mode resilience.** 20 s lost-mode polling depends on the service
    surviving restarts; verify `START_STICKY` + reboot receiver so a thief
    power-cycling the phone re-arms the beacon.

---

## 4. What is technically impossible (reaffirmed — keep this honesty)

- ⛔ **Any app tracks a powered-off phone.** Power-off finding is OEM hardware
  (Apple Find My / Google Find Hub). Dravex covers *on + any signal*.
- ⛔ **Any app survives a factory reset / flash.** Backstops are FRP / Activation
  Lock, the IMEI/serial registry, the carrier trace (police → NCC), and the
  post-flash Device Check on the *new* user's phone.
- ⛔ **Apps read their own IMEI on Android 10+.** Device Check is user-entered.
- ⛔ **iOS third-party background tracking / BLE advertising.** iOS is a
  companion; we steer to Apple Find My.
- ⛔ **BIOS/UEFI-level locking** without OEM partnerships; ⛔ battery-removed or
  Faraday-bagged devices are invisible to all software.

---

## 5. What needs to change (corrections)

- `README.md`, `desktop/README.md`, `android/README.md`, `docs/compliance/*`
  no longer describe Appwrite as the backend — the Dravex sync server
  (Postgres/PostGIS via Neon) is canonical. **Done in this batch.**
- `PLAN.md` remains historical only (its Appwrite architecture is superseded
  and must not be built from).
- **Nothing else in the spec is wrong** — the corrections are additions (§3),
  not rewrites.

---

## 6. Security vulnerabilities & hardening (audited)

| # | Finding | Evidence | Fix |
|---|---|---|---|
| S1 | **Pairing-code brute force.** `/api/pair/claim` is public and rate-limit-free; a 4-segment code can be guessed | `server/server.js` (claim public, no `claimHits` guard) | Per-IP + per-code attempt limits, exponential backoff, lock code after N fails |
| S2 | **Tokens at rest in plaintext.** Desktop `agent-state.json` and Android `SharedPreferences` store the device token unencrypted | `desktop/src/main.js` (state JSON); `AppState.kt` (`device_token` pref) | Windows DPAPI / macOS Keychain; Android **Keystore**-encrypted prefs |
| S3 | **CORS `*`.** Any origin can call the API (moot only because auth is optional) | `server/server.js` `Access-Control-Allow-Origin: *` | Config-driven allowlist (web origin) in production |
| S4 | **Single shared owner key.** One leaked secret exposes the whole owner surface | `DRAVEX_NEXTGENE.md` §12 | Per-owner accounts (Phase 3) + key rotation UX; device tokens already rotatable |
| S5 | **Sighting spoofing.** Public `POST /api/sightings` can be flooded with fake sightings | `server/beacon.js` (unknown beacons swallowed, but known ones unbounded per IP) | Per-IP sighting rate limit + sighting dedupe by beacon+position |
| S6 | **Check endpoint existence oracle.** "Previously reported" reveals history | `/api/check` | Acceptable trade-off (buyer protection); keep generic labels |
| S7 | **No TLS note for self-host.** Render does HTTPS; self-hosted server may not | `docs/DEPLOY.md` | Document mandatory TLS + HSTS for any self-host |

---

## 7. Backend / API gaps

- 🔴 No `POST /api/devices/:id/transfer` (ownership handover for the second-life
  market — clears registry on verified transfer).
- 🔴 No `POST /api/devices/:id/verify` (owner marks device recovered/verified —
  the "Verified" lifecycle step; feeds registry resolution).
- 🔴 No contact-relay endpoint (owner recovery message + finder reply inbox).
- 🟡 Alerts have no email/webhook sink (push + SMS only).
- 🟡 No evidence retention/expiry policy endpoint (NDPA data-minimization).
- 🟡 Fix history capped at 100/device — fine for MVP; document pagination plan.

---

## 8. Android / iOS limitations (final)

**Android:** full agent possible; constraints are OEM battery managers, Android
10+ IMEI privacy, and app-level (not firmware-level) reset survival. All
already handled or documented. Next hardening: Keystore token, battery-whitelist
flow, reboot receiver.

**iOS:** companion only, by platform law. `ios/TrackNaija/` builds on macOS
only. Never promise iPhone background tracking.

---

## 9. Community-network architecture (audit)

- ✅ Android advertises only while **lost** (privacy-first), daily-rotating id.
- ✅ Scans 12 s / 5 min; anonymous sightings carry the *scanner's* position.
- ✅ Windows desktop can hear beacons (WinRT watcher) and join the relay.
- 🔴 macOS/Linux desktop cannot hear beacons yet (§3-5).
- 🔴 Beacon payload carries only the 12-hex id — no owner message; the
  recovery-message channel must live server-side (§3-4), not on the beacon.
- 🔴 No dedupe of identical sightings (beacon + position) — flood risk (S5).
- ✅ Unknown beacons are swallowed with 201 (anti-probe).
- ✅ Sightings stored only for lost devices.

---

## 10. SIM-removal / power-off / reset scenario coverage (final)

| Scenario | Covered by | Gap |
|---|---|---|
| Power-off | Last-known + vault + honest note (nothing more is possible) | — |
| SIM removed | SIM-change event, radio-based (works with data off), identity ≠ SIM | Alert reach (push/SMS only) |
| Data/Wi-Fi off | Community beacon while lost; vault burst-sync on any reconnect | macOS/Linux relay gap |
| Factory reset / flash | FRP / Activation Lock (OEM); registry carries IMEI; post-flash Device Check; ownership lock survives app restarts | Nothing survives the wipe — by physics |
| Sold | Buyer Device Check on IMEI/serial | No **transfer** flow for legit resale (§3-3) |
| Reused / reconnected | 12 h-gap reconnect event + alert | Alert reach (push/SMS only) |
| Community detect | Sighting → map + alert + recovery confidence | macOS/Linux scan gap; spoofing limit |

---

## 11. Buildable now vs partnership-dependent (verified against code)

**Buildable now (software):** real Wi-Fi geolocation resolver, PostGIS
migration, ownership transfer + verification, owner↔finder contact relay,
macOS/Linux BLE watchers, Keystore/DPAPI token storage, CORS allowlist, claim
rate-limit, battery-whitelist UX, email/webhook alert sink, SMS provider live.

**Needs OEM/operator partnership:** powered-off finding, carrier IMEI block /
NIN trace (police + NCC DMS), FRP / Activation Lock (already OEM — we integrate
around), OS-reinstall-proof persistence, battery-removed / Faraday detection.

---

## 12. The Nigerian theft model — does the current system answer it?

Yes, honestly. The attack chain *stolen → powered off → SIM removed → flashed →
sold → buyer checks → community detects → owner informed* maps to a real,
working implementation at every step **that software can reach**, and the spec
names the OEM/carrier steps it cannot. The two weakest links are (a) alert
reach when the owner has no browser-open push subscription and no SMS config,
and (b) the missing legit-resale path, which would make the registry a
liability for honest sellers. Both are §3-6 / §3-3 and are in the prompt.

---

## 13. Definition of done for the next milestone

- Both e2e suites pass in both auth modes: `server/e2e-test.js` (29 steps) and
  `server/e2e-auth.js` (11 steps) with and without `DRAVEX_OWNER_KEY`.
- `web/` production build passes; desktop `npm run check` + electron smoke
  pass; Android compiles in CI (no local Java).
- No change violates the honesty contract (§4) or the canonical spec.
- New endpoints added to `DRAVEX_NEXTGENE.md` §13 table before merging.
- No dead code left behind; brand remnants (except the intentional
  `ios/TrackNaija` folder + userData migration path) eliminated.

---

## 14. The implementation prompt (paste into your agent)

> **Implement the Dravex "fidelity + second-life" milestone, in this order.**
> Work from `DRAVEX_NEXTGENE.md` as the canonical spec; `PLAN.md` is historical
> and must not influence architecture. `README.md` is setup docs only.
>
> **M0 — Server: real Wi-Fi geolocation resolver.**
> In `server/`, add `POST /api/geolocate` (owner/device-auth): accepts a BSSID
> list, returns `{lat, lng, accuracy, source}`. Use Google Geolocation API with
> Mozilla Location Service fallback; cache lookups in the store (BSSID →
> coordinate, with TTL); config via env (`GEOLOCATION_API_KEY`). When no key is
> set, return 501 with an honest `source: "unresolved"` so the desktop never
> lies about accuracy. Do not hardcode any third-party key.
>
> **M1 — Desktop: honest Wi-Fi position.**
> In `desktop/src/tracking-engine.js`, replace the demo-mapped Wi-Fi coordinate
> with a call to `/api/geolocate` (batch the BSSIDs already being uploaded).
> Keep IP geolocation as fallback. Mark every fix with its real `source`
> (`wifi_resolved` | `ip` | `last_known`). Never emit a coordinate from a
> fingerprint that was not resolved.
>
> **M2 — PostGIS migration (Neon).**
> In `server/storage.js` Postgres mode: add `geometry(Point,4326)` columns for
> fix and sighting coordinates (backfill from `lat/lng`), add a spatial index,
> and replace the JS haversine "nearest device to sighting" computation with a
> SQL distance query. Keep the JSON-file mode's API contract identical. Update
> `DRAVEX_NEXTGENE.md` §14 schema accordingly.
>
> **M3 — Ownership transfer + verified lifecycle.**
> Add `POST /api/devices/:id/transfer` (owner-auth): marks the device
> transferred, clears its registry entry, issues a fresh pairing code + new
> device token for the new owner's agent. Add `POST /api/devices/:id/verify`
> (owner-auth): the "Verified → Recovered" step — resolves registry entries and
> writes a `recovered` event. Wire both into the web dashboard (Recovery view +
> Devices view) with confirmation dialogs. Extend `e2e-test.js` to cover
> transfer (registry clears) and verify.
>
> **M4 — Owner↔finder contact relay (privacy-first).**
> Server: `PUT /api/devices/:id/recovery-message` (owner-auth) — one message +
> contact preference, shown only on that device's recovery view while lost.
> `POST /api/devices/:id/contact` (public, rate-limited) — a finder submits a
> message that lands in the owner's alerts; it never reveals the finder's
> identity. Web: render both on `/dashboard/recovery/[id]`. Rate-limit both
> endpoints per-IP.
>
> **M5 — Hardening (from §6).**
> a) Rate-limit `/api/pair/claim` per-IP + per-code with exponential backoff
> (lock the code after N failures). b) CORS: replace `*` with a config-driven
> allowlist (`CORS_ORIGIN` env, default web origin). c) Desktop: encrypt
> `deviceToken` at rest (DPAPI on Windows, Keychain on macOS, fallback to
> obfuscated file with a warning). d) Android: store `device_token` via
> Android Keystore-encrypted prefs. e) Rate-limit public sighting posts per-IP
> and dedupe identical (beacon, position) sightings.
>
> **M6 — Alert reach + SMS live.**
> Add an email/webhook sink for alerts (`ALERT_EMAIL_TO` + optional
> `ALERT_WEBHOOK_URL` env) alongside push/SMS. Wire `server/sms.js` to a real
> provider behind env (`SMS_PROVIDER=twilio|termii` + keys) while keeping log
> mode as default. Document in `docs/DEPLOY.md`.
>
> **M7 — Android reliability.**
> Add a "Protect from battery optimization" screen (IgnoreBatteryOptimizations
> request + Samsung/Tecno/Infinix whitelist instructions), verify the tracking
> service is `START_STICKY` with a `BOOT_COMPLETED` receiver so lost mode
> re-arms after a reboot.
>
> **M8 — macOS/Linux beacon listening.**
> Port the desktop BLE watcher: CoreBluetooth (macOS) and BlueZ `bluetoothctl`
> adapter (Linux), same `0000fffa`+`[0x01]`+12-hex filter and sighting upload.
> Keep the existing Windows path untouched.
>
> **Constraints:** zero-dependency server (no new npm deps); do not break the
> honesty contract; do not promise power-off/reset survival; every new endpoint
> must be added to `DRAVEX_NEXTGENE.md` §13; keep both e2e suites green in both
> auth modes; no brand remnants (except `ios/TrackNaija` folder + userData
> migration path); no dead code. When finished, run the full validation matrix
> in §13 and report results per milestone.
