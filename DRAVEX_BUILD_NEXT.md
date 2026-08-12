# Dravex — Build-Next Audit & Implementation Prompt

> **Revision 2 (2026-08-12).** Revision 1 audited `DRAVEX_NEXTGENE.md` against the
> repository and produced the M0–M8 milestone. **M0–M8 and Phase 2.5 are now
> built, validated, and deployed to production.** This revision re-audits the
> same code, marks every milestone item with its live status, and replaces §14
> with the next implementation prompt (Phase 2.5 completion + Phase 3 kickoff).
>
> The rule that governs all further work:
>
> | Doc | Role |
> |---|---|
> | **`DRAVEX_NEXTGENE.md`** | **Canonical architecture** — where anything disagrees, this wins |
> | `PLAN.md` | Historical reference only (do not build from it) |
> | `README.md` | Implementation / setup documentation only |
> | `DRAVEX_TEST_MATRIX.md` | Formal QA matrix (pass/fail criteria per platform) |

---

## 0. Production deployment (verified live 2026-08-12)

| Layer | URL / location | Status |
|---|---|---|
| Command center (Next.js) | `https://dravex.vercel.app` | ✅ Live; verified in browser (landing → dashboard → device vault loads, no CORS errors) |
| Sync API (zero-dep server) | `https://dravex.onrender.com` | ✅ Live — `GET /api/health` → `{ok:true, devices:52, mode:"neon"}` |
| Database | Neon Postgres (PostGIS-ready) | ✅ Live |
| Owner gate | `DRAVEX_OWNER_KEY` on Render | ✅ Live — `/api/admin/health` → `401` without the key |
| CORS allowlist | `CORS_ORIGIN=https://dravex.vercel.app` | ✅ Live — evil origins get no `Access-Control-Allow-Origin`; only the dashboard is allowed |
| Web→API binding | production fallback `https://dravex.onrender.com` | ✅ Baked into the deployed bundle (the old `tracknaija.onrender.com` is retired) |
| Desktop agent | Settings → **Use live server** one-click | ✅ Points at production; unaffected by CORS (Node fetch, no `Origin` header) |

Deploy runbook: `docs/DEPLOY.md` (§3 Vercel, §3.5 lockdown, env table). Helper:
`scripts/render-lockdown.js` (list / lockdown / verify via the Render REST API).

---

## 1. Audit verdict (summary)

Revision 1 found the spec accurate about what was built and named the gaps:
*fidelity* (real geolocation), *second-life/transfer*, and *hardening*. **All of
those gaps are now closed in code** (§3). The remaining work is no longer
"build the feature" — it is **real-world validation** (SMS provider live, iOS
companion build on macOS, on-device runs of `DRAVEX_TEST_MATRIX.md`) followed
by Phase 3 (second-life marketplace / recovery network). Nothing in this
revision contradicts the canonical spec; `DRAVEX_NEXTGENE.md` §21 already
reflects these statuses.

Legend: ✅ verified in code / live · 🟡 partial or needs on-device validation · 🔴 missing · ⛔ impossible by physics/platform

---

## 2. What is correctly designed (verified)

All Revision-1 claims still hold (verified again against code on 2026-08-12).
Milestone additions, each verified in code:

| Capability | Code evidence | Status |
|---|---|---|
| Real Wi-Fi geolocation (M0) | `POST /api/geolocate` — Google Geolocation → Mozilla fallback, 30-day `geoCache`, honest `501 {source:"unresolved"}` without `GEOLOCATION_API_KEY` | ✅ |
| Desktop honest Wi-Fi position (M1) | `desktop/src/tracking-engine.js` calls `/api/geolocate`; fix `source` is `wifi_resolved \| ip \| last_known` — never a faked coordinate | ✅ |
| PostGIS spatial mirror (M2) | `server/storage.js` Neon mode: `geometry(Point,4326)` columns + spatial index + SQL `nearestFix`/`/api/nearest`; JSON-file mode contract identical | ✅ |
| Ownership transfer + verified lifecycle (M3) | `POST /api/devices/:id/transfer` (rotates token, clears registry, fresh pairing code, clears `ownerId`) · `POST /api/devices/:id/verify` (Verified → Recovered, resolves registry) · web Recovery view + Devices view wired | ✅ |
| Finder contact relay (M4) | `PUT /api/devices/:id/recovery-message` (owner) · `POST /api/devices/:id/contact` (public, rate-limited, never reveals finder identity) · web recovery page renders both | ✅ |
| Hardening batch (M5) | Claim per-IP + per-code limits (`claimHits`) · `CORS_ORIGIN` allowlist (live) · desktop tokens at rest via `secret-store.js` (DPAPI/Keychain/`safeStorage`) · Android Keystore-encrypted prefs (`AppState.kt`) · sighting per-IP limit + dedupe | ✅ |
| Alert reach (M6) | Webhook/email sink (`ALERT_WEBHOOK_URL`, comma-separated) + persisted 20-entry `deliveryLog` + `POST /api/admin/retry-delivery` · SMS behind `SMS_PROVIDER=twilio\|termii` env, log-mode default | ✅ |
| Android reliability (M7) | IgnoreBatteryOptimizations flow + per-OEM whitelist guidance · `START_STICKY` + `BOOT_COMPLETED` receiver re-arms lost mode | ✅ |
| macOS/Linux BLE (M8) | `desktop/src/ble-scan.js` — CoreBluetooth helper (macOS), BlueZ `btmon` HCI dump parse (Linux), Windows WinRT path untouched | ✅ code (on-device verify 🔜) |
| Per-owner accounts (2.5) | `POST /api/auth/register\|login\|logout`, `GET /api/auth/me` — scrypt + per-user salt, sessions bounded + rate-limited, session-strict device lists (`ownerId === uid`, no legacy leak), transfer clears owner | ✅ `server/e2e-accounts.js` 12/12 |
| Password reset (2.5) | `POST /api/auth/forgot` (uniform 200, 1 h TTL, webhook/console delivery, expiry sweep) + `POST /api/auth/reset` (single-use, fresh salt) | ✅ `server/e2e-reset.js` 6/6 |
| Observability (2.5) | `GET /api/admin/health` — agents, fix age, geolocate resolution, sighting dedupe/ghosts, command delivery rate, SMS/webhook failures, auth anomalies · web Service-health page with per-row retry | ✅ |
| Theft simulation lab (2.5) | `server/e2e-theft.js` — hermetic self-booted server (random port, forces file mode + open auth), replays Nigerian chains A/B/C · `docs/THEFT_LAB.md` | ✅ A/B/C pass |
| QA matrix (2.5) | `DRAVEX_TEST_MATRIX.md` — per-platform pass/fail rows | ✅ |

---

## 3. Gaps — disposition after M0–M8 + Phase 2.5

| # | Revision-1 gap | Disposition | Remaining work |
|---|---|---|---|
| 1 | 🔴 Real Wi-Fi geolocation | ✅ Done (M0/M1) | Provider key only: `GEOLOCATION_API_KEY` |
| 2 | 🔴 PostGIS | ✅ Done (M2) | None |
| 3 | 🔴 Ownership transfer + verified | ✅ Done (M3) | None |
| 4 | 🔴 Finder contact relay | ✅ Done (M4) | None |
| 5 | 🟡 macOS/Linux BLE | ✅ Code done (M8) | 🔜 On-device verification (macOS + Linux) |
| 6 | 🟡 Alert reach | ✅ Done (M6: webhook sink + delivery log + retry) | Live webhook-to-email URL if wanted |
| 7 | 🟡 SMS provider live | ✅ Code done | 🔜 **Credentials** — `TERMII_API_KEY`/`TERMII_FROM` (or Twilio) on Render |
| 8 | 🟡 Android OEM battery UX | ✅ Done (M7) | 🔜 On-device verification (Tecno/Infinix/Samsung) |
| 9 | 🟡 iOS brand remnant + build | ✅ Renamed to `com.dravex.agent`; `ios/TrackNaija` kept intentionally | 🔜 Build on macOS; find-my handoff + reporting flow |
| 10 | 🟡 Tag firmware fidelity | 🟡 Unchanged (prototype) | RTC day-rotation, deep-sleep duty cycle, hardware bring-up |
| 11 | 🟡 Lost-mode resilience | ✅ Done (M7 boot re-arm) | On-device power-cycle test |

**New gaps opened since Revision 1** (ranked):

1. 🔴 **Real-device validation** — the theft lab proves the server; the QA
   matrix rows have not been run on physical phones/laptops on Nigerian
   networks. This is the single biggest product risk now (N1 below).
2. 🟡 **Evidence retention / NDPA data-minimization** — no retention/expiry
   policy endpoint or purge job yet (spec §20).
3. 🟡 **Fix-history pagination** — fixes capped at 100/device; fine for MVP,
   document + implement pagination before scale.
4. 🟡 **Observability alerting** — `/api/admin/health` exists but nothing
   pushes anomalies (offline surge, SMS/webhook failure) to the operator.
5. 🟡 **Tag firmware fidelity** — unchanged from Revision 1 (§10).

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

## 5. What needed to change (corrections) — done in Revision-1 batch

- `README.md`, `desktop/README.md`, `android/README.md`, `docs/compliance/*`
  no longer describe Appwrite as the backend — the Dravex sync server
  (Postgres/PostGIS via Neon) is canonical. ✅
- `PLAN.md` remains historical only.
- Brand: `TrackNaija` → **Dravex** across web/desktop/server/android/ios/docs;
  Android package `com.dravex.agent`; desktop userData migrates from
  `tracknaija-agent`; app icon renamed. ✅

---

## 6. Security hardening — audit status after M5 + Phase 2.5

| # | Finding | Disposition | Evidence |
|---|---|---|---|
| S1 | Pairing-code brute force | ✅ **Fixed** — per-IP + per-code attempt limits with lockout (`claimHits`) | `server/server.js` |
| S2 | Tokens at rest in plaintext | ✅ **Fixed** — desktop DPAPI/Keychain/`safeStorage` (`secret-store.js`); Android Keystore-encrypted prefs | `desktop/src/secret-store.js`, `AppState.kt` |
| S3 | CORS `*` | ✅ **Fixed** — `CORS_ORIGIN` allowlist, **live on Render** (verified: only `https://dravex.vercel.app` allowed) | `server/server.js` + live probe |
| S4 | Single shared owner key | 🟡 **Mitigated** — per-owner accounts (sessions, device isolation, rate-limited register/login) are the primary model; `DRAVEX_OWNER_KEY` remains the operator backstop (live on Render) | `server/e2e-accounts.js` |
| S5 | Sighting spoofing | ✅ **Fixed** — per-IP sighting limit + dedupe by beacon+position | `server/server.js` (+ `sightings.deduped` metric) |
| S6 | Check endpoint existence oracle | ✅ Accepted trade-off (buyer protection); generic labels kept | `/api/check` |
| S7 | No TLS note for self-host | ✅ Documented in `docs/DEPLOY.md` (mandatory TLS + HSTS) | `docs/DEPLOY.md` |

---

## 7. Backend / API gaps — status

- ✅ `POST /api/devices/:id/transfer` — ownership handover (registry clear + token rotation + fresh code).
- ✅ `POST /api/devices/:id/verify` — Verified → Recovered lifecycle step.
- ✅ Contact relay (`recovery-message` + `contact`) — privacy-first finder channel.
- ✅ Email/webhook alert sink + persisted delivery log + retry endpoint.
- 🟡 **No evidence retention/expiry policy** (NDPA data-minimization) — see §3 new gaps #2.
- 🟡 Fix history capped at 100/device — pagination plan pending (§3 new gaps #3).
- ✅ Every new endpoint is registered in `DRAVEX_NEXTGENE.md` §13 (canonical, kept in sync per milestone constraint).

---

## 8. Android / iOS limitations (final)

**Android:** full agent possible; constraints are OEM battery managers, Android
10+ IMEI privacy, and app-level (not firmware-level) reset survival. All
handled or documented; Keystore token + battery-whitelist flow + boot re-arm
are in code — **needs on-device verification** (Tecno/Infinix/Samsung).

**iOS:** companion only, by platform law. `ios/TrackNaija/` builds on macOS
only — **build it as N2**. Never promise iPhone background tracking.

---

## 9. Community-network architecture (audit)

- ✅ Android advertises only while **lost** (privacy-first), daily-rotating id.
- ✅ Scans 12 s / 5 min; anonymous sightings carry the *scanner's* position.
- ✅ Windows desktop can hear beacons (WinRT watcher) and join the relay.
- ✅ macOS/Linux desktop watchers in code (CoreBluetooth helper / BlueZ `btmon`) — **on-device verify pending**.
- ✅ Recovery message lives server-side (§3-4), not on the beacon.
- ✅ Sighting dedupe by beacon+position (flood-guarded, per-IP limited).
- ✅ Unknown beacons swallowed with 201 (anti-probe); sightings stored only for lost devices.

---

## 10. SIM-removal / power-off / reset scenario coverage (final)

| Scenario | Covered by | Status |
|---|---|---|
| Power-off | Last-known + vault + honest note | — (nothing more is possible) |
| SIM removed | SIM-change event, radio-based (works with data off), identity ≠ SIM | Alert reach now includes webhook + delivery retry |
| Data/Wi-Fi off | Community beacon while lost; vault burst-sync on any reconnect | macOS/Linux relay code done — on-device verify |
| Factory reset / flash | FRP / Activation Lock (OEM); registry carries IMEI; post-flash Device Check; ownership lock survives app restarts | Nothing survives the wipe — by physics |
| Sold | Buyer Device Check on IMEI/serial + **verified transfer flow** (registry clears, ownership hands over) | ✅ M3 — legit resale no longer blocked |
| Reused / reconnected | 12 h-gap reconnect event + alert | Alert reach: push + SMS + webhook |
| Community detect | Sighting → map + alert + recovery confidence | ✅ + observability metrics |

---

## 11. Buildable now vs partnership-dependent (verified against code)

**Built (software):** real Wi-Fi geolocation resolver, PostGIS spatial mirror,
ownership transfer + verification, finder contact relay, macOS/Linux BLE
watchers, Keystore/DPAPI token storage, CORS allowlist, claim rate-limit,
battery-whitelist UX, webhook/email alert sink + delivery retry, per-owner
accounts + password reset, observability, theft lab, password-reset delivery.

**Needs OEM/operator partnership:** powered-off finding, carrier IMEI block /
NIN trace (police + NCC DMS), FRP / Activation Lock (already OEM — we integrate
around), OS-reinstall-proof persistence, battery-removed / Faraday detection.

---

## 12. The Nigerian theft model — does the current system answer it?

Yes, honestly. The attack chain *stolen → powered off → SIM removed → flashed →
sold → buyer checks → community detects → owner informed* maps to a real,
working implementation at every step that software can reach — now including
the **legit-resale path** (transfer + registry clear, M3) and stronger alert
delivery (webhook sink + retry, M6). The two weakest links left are (a) the
**SMS provider is not live** (log mode until keys are set) and (b) **no
on-device validation** of the whole chain on real Nigerian hardware/networks.
Both are in the next milestone (§14 N0/N1).

---

## 13. Definition of done for the next milestone

- All five suites pass **in both auth modes** (open and `DRAVEX_OWNER_KEY`):
  - `server/e2e-test.js` — **36 steps** (`== E2E PASSED ==`)
  - `server/e2e-auth.js` — **15 steps** (`== AUTH E2E PASSED ==`)
  - `server/e2e-accounts.js` — **12 steps** (per-owner isolation)
  - `server/e2e-reset.js` — **6 steps** (forgot → deliver → reset → login)
  - `server/e2e-theft.js` — **scenarios A/B/C** (hermetic self-booted server)
- `web/` production build passes; desktop `npm run check` + electron smoke pass;
  Android compiles in CI (no local Java).
- No change violates the honesty contract (§4) or the canonical spec.
- New endpoints added to `DRAVEX_NEXTGENE.md` §13 table before merging.
- No dead code left behind; no brand remnants.
- Live deployment checks: `https://dravex.vercel.app` serves the dashboard and
  `https://dravex.onrender.com/api/health` returns `{ok:true, mode:"neon"}`;
  `/api/admin/health` stays `401` without the owner key; CORS stays locked to
  the dashboard origin.

---

## 14. The implementation prompt (paste into your agent)

> **Implement the Dravex "Phase 2.5 completion + Phase 3 kickoff" milestone, in
> this order.** Work from `DRAVEX_NEXTGENE.md` as the canonical spec; `PLAN.md`
> is historical and must not influence architecture; `README.md` is setup docs
> only; `DRAVEX_TEST_MATRIX.md` defines the QA rows you validate against.
>
> **N0 — Live SMS (Termii first, Twilio fallback).**
> `server/sms.js` already supports `SMS_PROVIDER=termii|twilio` behind env
> (log mode is the default and must stay). With real credentials set, verify:
> SIM-change and reconnect alerts actually reach a Nigerian number; failures
> land in the persisted `deliveryLog` and are retryable from the web
> Service-health page; rate limit (1/min) still holds. Do not hardcode any
> credential; update `docs/DEPLOY.md` §4 with the exact env vars.
>
> **N1 — Real-hardware validation campaign.**
> Run every row of `DRAVEX_TEST_MATRIX.md` on real devices: Android phones
> (Tecno/Infinix/Samsung — battery whitelist, reboot re-arm, beacon advertise/
> scan), Windows + macOS + Linux laptops (ladder, lost mode, BLE watchers), on
> MTN/Airtel/Glo/9mobile networks and real Wi-Fi. Use `docs/THEFT_LAB.md` as
> the script (scenarios A/B/C against the **live** server). Record pass/fail
> per row in the matrix; fix every failure in code. This is the highest-priority
> work — the lab already proves the server, this proves the devices.
>
> **N2 — iOS companion build (macOS required).**
> Build the existing SwiftUI project in `ios/TrackNaija/` on a Mac: last-known
> companion view, Apple Find My handoff guide, report-lost flow (posts to the
> registry). Wire it to the live API URL. Leave the folder name intact (the
> Xcode project depends on it) — brand it Dravex inside.
>
> **N3 — Evidence retention & NDPA data-minimization.**
> Add a retention policy: `GET/PUT /api/settings` gains `evidenceRetentionDays`
> (default e.g. 90); a sweep purges evidence/fixes older than the policy on a
> schedule; the web dashboard surfaces the policy. Document the choice in
> `DRAVEX_NEXTGENE.md` §20 (NDPA compliance).
>
> **N4 — Observability alerting.**
> When `/api/admin/health` crosses thresholds (e.g. >50% geolocate unresolved,
> SMS/webhook failure spike, offline-device surge, rate-limit storm), POST a
> summary to `ALERT_WEBHOOK_URL` (reusing the existing sink) and record it in
> the delivery log. Operator gets alerted without polling.
>
> **N5 — Phase 3 kickoff: second-life marketplace (first slice).**
> Building on the M3 transfer flow: a "verified listings" page on the web
> dashboard where a transferred device can be listed for resale (owner sets
> price + condition); the public Device Check shows a green "verified
> resale-ready" badge for listed devices; buyer expresses interest → owner gets
> an alert (reuse the contact relay). Payment (Paystack/Flutterwave) is Phase
> 3.5 — do not build checkout yet, only the verified-listing + interest
> pipeline and the public stats counters (recovered, protected, sighted) for
> the landing page.
>
> **Constraints:** zero-dependency server (no new npm deps); do not break the
> honesty contract; do not promise power-off/reset survival; every new endpoint
> must be added to `DRAVEX_NEXTGENE.md` §13; keep **all five suites** green in
> both auth modes (§13); web build + desktop check/smoke + Android CI pass; no
> dead code; no brand remnants. When finished, run the full validation matrix
> in §13, then report results per milestone (N0–N5) plus the live deployment
> checks from §13.
