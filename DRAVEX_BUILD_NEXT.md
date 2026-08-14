# Dravex — Build-Next Audit & Implementation Prompt

> **Revision 4 (2026-08-14).** Revision 3 shipped the Phase-3 Recovery
> Intelligence milestone (`7945845`). This revision records the **Phase-3 slice
> completion + production hardening** milestone: the marketplace page closes the
> last N5 gap (no more dead `listListings()`), the physical-device campaign is
> prepared (BLOCKED on hardware), the SMS pipeline gained a hermetic
> verification suite, the iOS build steps are documented, and Phase 3.5 is
> written up as design-only (§24 of NEXTGENE). See §14 for the follow-up.
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

## 0. Production deployment (verified live 2026-08-14)

| Layer | URL / location | Status |
|---|---|---|
| Command center (Next.js) | `https://dravex.vercel.app` | ✅ Live; hydration warning #418 fixed and deployed (browser-verified forget flow, stats band, resale panels) |
| Sync API (zero-dep server) | `https://dravex.onrender.com` | ✅ Live — `GET /api/health` → `{ok:true, devices:0, mode:"neon"}` |
| Database | Neon Postgres (PostGIS-ready) | ✅ Live |
| Owner gate | `DRAVEX_OWNER_KEY` on Render | ✅ Live — `/api/admin/health` → `401` without the key |
| CORS allowlist | `CORS_ORIGIN=https://dravex.vercel.app` | ✅ Live — evil origins get no `Access-Control-Allow-Origin` |
| Web→API binding | production fallback `https://dravex.onrender.com` | ✅ Baked into the deployed bundle (the old `tracknaija.onrender.com` is retired) |
| Desktop agent | Settings → **Use live server** one-click | ✅ Points at production; unaffected by CORS (Node fetch, no `Origin` header) |
| Data hygiene | test fixtures swept off production | ✅ **0 devices remain** — all suite-created fixtures (BOB-/ALICE-/TEST-/LIVE-/DBG-/AUTH-/HP-ELITEBOOK/TECNO-PHONE…) forgotten via the new `/forget` endpoint; public registry reads clean; stats honestly `0/0/0` and rebuild from real pairings |

Deploy runbook: `docs/DEPLOY.md` (§3 Vercel, §3.5 lockdown, env table). Helper:
`scripts/render-lockdown.js` (list / lockdown / verify via the Render REST API).

---

## 1. Audit verdict (summary)

Revision 2's gaps — *fidelity*, *second-life/transfer*, *hardening* — are
closed in code. The **N0–N5 batch is complete and live**: SMS pipeline is
contract-verified (still log-mode until credentials), the theft lab replays
scenarios A/B/C against production, retention + ops alerting + the verified
resale first slice are all in production, and the public counters render on the
landing page. Three real bugs found since Revision 2 were fixed and pushed
(claim-token drop, missing Android `postContactMessage`, hydration #418), and
production was swept clean of test fixtures.

Remaining work is *not* "build the feature" — it is (a) **close the one
missing N5 slice: the public verified-listings browse + buyer-interest UI**
(API exists, `listListings` is dead code in the web app — no page consumes it),
(b) **real-world validation** (SMS credentials, on-device runs of
`DRAVEX_TEST_MATRIX.md`, iOS build on macOS), then (c) Phase 3.5 (payment,
repair network). Nothing in this revision contradicts the canonical spec;
`DRAVEX_NEXTGENE.md` §13/§20/§21 already reflect the N0–N5 statuses.

Legend: ✅ verified in code / live · 🟡 partial or needs on-device validation · 🔴 missing · ⛔ impossible by physics/platform

---

## 2. What is correctly designed (verified)

All Revision-1/2 claims still hold (re-verified against code on 2026-08-14).
Milestone additions, each verified in code or live:

| Capability | Code evidence | Status |
|---|---|---|
| Real Wi-Fi geolocation (M0) | `POST /api/geolocate` — Google Geolocation → Mozilla fallback, 30-day `geoCache`, honest `501 {source:"unresolved"}` without `GEOLOCATION_API_KEY` | ✅ |
| Desktop honest Wi-Fi position (M1) | `desktop/src/tracking-engine.js` calls `/api/geolocate`; fix `source` is `wifi_resolved \| ip \| last_known` — never a faked coordinate | ✅ |
| PostGIS spatial mirror (M2) | `server/storage.js` Neon mode: `geometry(Point,4326)` columns + spatial index + SQL `nearestFix`/`/api/nearest`; JSON-file mode contract identical | ✅ |
| Ownership transfer + verified lifecycle (M3) | `POST /api/devices/:id/transfer` (rotates token, clears registry, fresh pairing code, clears `ownerId`) · `POST /api/devices/:id/verify` (Verified → Recovered, resolves registry) | ✅ |
| Finder contact relay (M4) | `PUT /api/devices/:id/recovery-message` (owner) · `POST /api/devices/:id/contact` (public, rate-limited, never reveals finder identity) · web recovery page renders both | ✅ |
| Hardening batch (M5) | Claim per-IP + per-code limits (`claimHits`) · `CORS_ORIGIN` allowlist (live) · desktop tokens at rest via `secret-store.js` (DPAPI/Keychain/`safeStorage`) · Android Keystore-encrypted prefs · sighting per-IP limit + dedupe | ✅ |
| Alert reach (M6) | Webhook/email sink (`ALERT_WEBHOOK_URL`, comma-separated) + persisted `deliveryLog` + retry endpoint · SMS behind `SMS_PROVIDER=twilio\|termii` env, log-mode default | ✅ |
| Android reliability (M7) | IgnoreBatteryOptimizations flow + per-OEM whitelist guidance · `START_STICKY` + `BOOT_COMPLETED` receiver re-arms lost mode | ✅ |
| macOS/Linux BLE (M8) | `desktop/src/ble-scan.js` — CoreBluetooth helper (macOS), BlueZ `btmon` HCI dump parse (Linux), Windows WinRT path untouched | ✅ code (on-device verify 🔜) |
| Per-owner accounts (2.5) | register/login/logout/me — scrypt + per-user salt, sessions bounded + rate-limited, session-strict device lists | ✅ `server/e2e-accounts.js` 12/12 |
| Password reset (2.5) | forgot (uniform 200, 1 h TTL, webhook/console delivery, expiry sweep) + reset (single-use, fresh salt) | ✅ `server/e2e-reset.js` 6/6 |
| Observability (2.5) | `GET /api/admin/health` — agents, fix age, geolocate resolution, sighting dedupe/ghosts, command delivery, SMS/webhook failures, auth anomalies · web Service-health page with per-row retry | ✅ |
| Theft simulation lab (2.5) | `server/e2e-theft.js` — hermetic (random port, file mode, open auth) + **`--live` mode** against production | ✅ A/B/C/D pass, hermetic **and live** |
| QA matrix (2.5) | `DRAVEX_TEST_MATRIX.md` — per-platform pass/fail rows | ✅ |
| **Live SMS pipeline (N0)** | `server/sms.js` — Termii-first/Twilio-fallback/log-mode auto-detection; payload contract-verified against the real Termii endpoint (`401` parses cleanly = auth-gated, not shape error); failures persist to `deliveryLog` and retry from Service Health; 1/min throttle | ✅ code + wiring (🔜 real-number delivery needs credentials) |
| **Real-device validation harness (N1)** | `node e2e-theft.js --live <base>` replays scenarios A/B/C against production; zero-setup (reads `server/.env`); reconnect-gap aware (production's 12 h `RECONNECT_GAP_HOURS` can't be waited out — hermetic lab proves the reconnect event) · `docs/VALIDATION_LOG.md` records software-verified rows + physical matrix P1–P12 | ✅ harness + live replay (🔜 physical rows) |
| **iOS companion target (N2)** | `ios/TrackNaija/` SwiftUI — branded Dravex inside; `ContentView.swift` default server URL → `https://dravex.onrender.com` | ✅ code (🔜 Xcode build on macOS) |
| **Evidence retention (N3)** | `evidenceRetentionDays` (default 90, 30–730) in `/api/settings`; purge keys on **capture time** (vault burst-sync never wrongly purged), keeps latest fix + `lastFix`; boot + 6 h sweep + on-demand `POST /api/admin/purge` (operator-only); Agents-page control + admin tile; `DRAVEX_NEXTGENE.md` §20 updated | ✅ |
| **Ops alerting (N4)** | Env-tunable thresholds (geolocation unresolved, SMS/webhook failures, offline surge, rate-limit storm) → `ops` alerts through push + `ALERT_WEBHOOK_URL` + delivery log; **cooldown keyed by stable slug** (volatile message strings would spam operators); `POST /api/admin/ops-check`; Service-health page shows fired conditions | ✅ |
| **Verified resale first slice (N5)** | Only **transferred** devices can be listed; owner sets price + condition; public Device Check shows **"Verified resale-ready"** only when the registry reads clean (no STOLEN+resale-ready contradiction); anonymous buyer interest → private owner alert; landing-page live counters | ✅ API + owner UI + Device Check badge (🔜 public browse UI — see gap 1) |
| **claim() token fix (post-N5)** | `SyncClient.claim()` now **stores the returned device token** — a real production bug found via the live replay: every device-authed call (fixes/events/evidence) silently 401'd on the auth-mode server because the library dropped the credential; the desktop agent had masked it by re-setting the token in `main.js` | ✅ `d1be0a9`, verified live (`sim_change` → 200, fix → 201) |
| **Forget-device action (post-N5)** | `POST /api/devices/:id/forget` (owner-only) removes the device **plus** its stolen-registry entries, verified-resale listing, alerts and — critical — **outstanding pairing codes** (a stale code would resurrect the device via the lazy `device()` getter); web Agents page two-click confirm; theft-lab D5 asserts the stale code can't recreate the device | ✅ `b2f4168`; live-verified (401 without key, 200 with; 67 fixtures swept) |
| **Android CI fix (post-N5)** | `MainActivity.kt` called `postContactMessage()` which didn't exist on the Kotlin `SyncClient` → `assembleDebug` failed. Method added (mirrors `postEvent`); GitHub Actions now `completed \| success` | ✅ `b2f4168` |
| **Hydration fix (post-N5)** | Warning #418 root-caused: (1) `useState(getOwnerKey())` read localStorage in the initializer → SSR "no key set" vs client "key set" text mismatch; now loaded in a mount effect. (2) `new Date().toLocaleDateString()` rendered in JSX on the recovery action card (UTC server vs WAT client date drift) → `suppressHydrationWarning` | ✅ `a46242c`, web build passes |

---

## 3. Gaps — disposition after N0–N5 + hardening batch

| # | Gap | Disposition | Remaining work |
|---|---|---|---|
| 1 | ✅ **Public verified-listings browse UI** | **Built** — `/marketplace` (public, buyer-facing) consumes `getListings()`; generic labels only (no owner identity, no `deviceId` shown); interest form per card → `POST /api/listings/:id/interest` → private owner alert; loading/empty/error/rate-limited states; nav + Device Check badge link added | Done (`7945845` follow-up) |
| 2 | 🟡 SMS provider live | ✅ Code + wiring done (N0) | 🔜 **Credentials** — `TERMII_API_KEY` + **approved** `TERMII_FROM` (DND sender ID) on Render, then real-number verification |
| 3 | 🟡 Real-device validation | ✅ Harness + live replay done (N1) | 🔜 On-device runs: Tecno/Infinix/Samsung + Windows/macOS/Linux on MTN/Airtel/Glo/9mobile (`DRAVEX_TEST_MATRIX.md` rows P1–P12) |
| 4 | 🟡 iOS build | ✅ Code branded + live URL (N2) | 🔜 Xcode build on macOS; Find My handoff + reporting flow |
| 5 | 🟡 macOS/Linux BLE | ✅ Code done (M8) | 🔜 On-device verification (macOS + Linux) |
| 6 | 🟡 Android OEM battery UX | ✅ Done (M7) | 🔜 On-device verification (Tecno/Infinix/Samsung) |
| 7 | 🟡 Fix-history pagination | 🟡 Unchanged — fixes capped at 100/device | Document + implement pagination before scale |
| 8 | 🟡 Tag firmware fidelity | 🟡 Unchanged (prototype) | RTC day-rotation, deep-sleep duty cycle, hardware bring-up |

**New gaps opened since Revision 2** (ranked):

1. 🔴 **Buyer-facing verified-listings page missing** (gap 1 above) — the only
   N5 slice that shipped as API but not UI.
2. 🟡 **Live SMS delivery unproven on a real number** — wiring is
   contract-verified, but N0 stays credential-gated.
3. 🟡 **Physical-device matrix unrun** — the theft lab proves the server; the
   devices remain unproven (biggest product risk).

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

## 5. What needed to change (corrections) — done through Revision 3

- `README.md`, `desktop/README.md`, `android/README.md`, `docs/compliance/*`
  no longer describe Appwrite as the backend — the Dravex sync server
  (Postgres/PostGIS via Neon) is canonical. ✅
- `PLAN.md` remains historical only.
- Brand: `TrackNaija` → **Dravex** across web/desktop/server/android/ios/docs;
  Android package `com.dravex.agent`; desktop userData migrates from
  `tracknaija-agent`; app icon renamed. ✅
- Post-milestone fixes folded into the codebase and docs: `claim()` stores the
  device token (`d1be0a9`), Android `SyncClient.postContactMessage()` added
  (`b2f4168`), `/api/devices/:id/forget` registered in `DRAVEX_NEXTGENE.md` §13
  (`b2f4168`), hydration-safe owner-key load + `suppressHydrationWarning` on the
  print date (`a46242c`). ✅
- Production hygiene: all test fixtures forgotten; public stats honestly at 0.
  ✅

---

## 6. Security hardening — audit status after M5 + Phase 2.5 + hardening batch

| # | Finding | Disposition | Evidence |
|---|---|---|---|
| S1 | Pairing-code brute force | ✅ **Fixed** — per-IP + per-code attempt limits with lockout (`claimHits`) | `server/server.js` |
| S2 | Tokens at rest in plaintext | ✅ **Fixed** — desktop DPAPI/Keychain/`safeStorage` (`secret-store.js`); Android Keystore-encrypted prefs | `desktop/src/secret-store.js`, `AppState.kt` |
| S3 | CORS `*` | ✅ **Fixed** — `CORS_ORIGIN` allowlist, **live on Render** | `server/server.js` + live probe |
| S4 | Single shared owner key | 🟡 **Mitigated** — per-owner accounts are the primary model; `DRAVEX_OWNER_KEY` remains the operator backstop (live on Render) | `server/e2e-accounts.js` |
| S5 | Sighting spoofing | ✅ **Fixed** — per-IP sighting limit + dedupe by beacon+position | `server/server.js` (+ `sightings.deduped` metric) |
| S6 | Check endpoint existence oracle | ✅ Accepted trade-off (buyer protection); generic labels kept | `/api/check` |
| S7 | No TLS note for self-host | ✅ Documented in `docs/DEPLOY.md` (mandatory TLS + HSTS) | `docs/DEPLOY.md` |
| S8 | **Device token dropped by client library** | ✅ **Fixed** — `claim()` stores the token; device-authed calls no longer silently 401 on auth-mode servers | `desktop/src/sync-client.js` + live replay |
| S9 | **Stale pair code resurrects a forgotten device** | ✅ **Fixed** — `/forget` also deletes outstanding pairing codes pointing at the device; theft-lab D5 regression-tests it | `server/server.js`, `server/e2e-theft.js` |
| S10 | Hydration/SSR text mismatch | ✅ **Fixed** — localStorage no longer read in render path (leaks no secrets, but the mismatch was user-visible noise) | `web/app/dashboard/agents/page.tsx` |

---

## 7. Backend / API gaps — status

- ✅ `POST /api/devices/:id/transfer` — ownership handover (registry clear + token rotation + fresh code).
- ✅ `POST /api/devices/:id/verify` — Verified → Recovered lifecycle step.
- ✅ Contact relay (`recovery-message` + `contact`) — privacy-first finder channel.
- ✅ Email/webhook alert sink + persisted delivery log + retry endpoint.
- ✅ Evidence retention policy + purge job (N3) — `evidenceRetentionDays`, boot + 6 h sweep + on-demand purge.
- ✅ Ops alerting (N4) — threshold breaches → `ALERT_WEBHOOK_URL` + delivery log + cooldown.
- ✅ Verified resale API (N5) — list/unlist/interest only for transferred devices.
- ✅ `POST /api/devices/:id/forget` — full device data removal (registry, listing, pair codes, alerts).
- 🟡 **Public browse UI for `/api/listings` missing** — API returns listings, but the web app never calls `listListings()` (dead code). Buyer-side interest UI also missing.
- 🟡 Fix history capped at 100/device — pagination plan pending (§3 gap 7).
- ✅ Every new endpoint is registered in `DRAVEX_NEXTGENE.md` §13 (canonical, kept in sync per milestone constraint).

---

## 8. Android / iOS limitations (final)

**Android:** full agent possible; constraints are OEM battery managers, Android
10+ IMEI privacy, and app-level (not firmware-level) reset survival. All
handled or documented; Keystore token + battery-whitelist flow + boot re-arm
are in code — **needs on-device verification** (Tecno/Infinix/Samsung).

**iOS:** companion only, by platform law. `ios/TrackNaija/` builds on macOS
only — **build it as N2** (code is ready, points at the live API). Never
promise iPhone background tracking.

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
| SIM removed | SIM-change event, radio-based (works with data off), identity ≠ SIM | ✅ Alert reach: push + SMS pipeline + webhook + retry |
| Data/Wi-Fi off | Community beacon while lost; vault burst-sync on any reconnect | ✅ macOS/Linux relay code done — on-device verify |
| Factory reset / flash | FRP / Activation Lock (OEM); registry carries IMEI; post-flash Device Check; ownership lock survives app restarts | Nothing survives the wipe — by physics |
| Sold | Buyer Device Check on IMEI/serial + **verified transfer flow** (registry clears, ownership hands over) | ✅ M3 + N5 verified-listing first slice (owner side + Device Check badge live) |
| Reused / reconnected | 12 h-gap reconnect event + alert | ✅ Alert reach: push + SMS + webhook |
| Community detect | Sighting → map + alert + recovery confidence | ✅ + observability metrics |

---

## 11. Buildable now vs partnership-dependent (verified against code)

**Built (software):** real Wi-Fi geolocation resolver, PostGIS spatial mirror,
ownership transfer + verification, finder contact relay, macOS/Linux BLE
watchers, Keystore/DPAPI token storage, CORS allowlist, claim rate-limit,
battery-whitelist UX, webhook/email alert sink + delivery retry, per-owner
accounts + password reset, observability + ops alerting, evidence retention
(N3), verified-resale API + owner UI + Device Check badge (N5), theft lab with
live replay, forget-device action, live-SMS pipeline (credential-gated), iOS
companion code pointing at production.

**Needs OEM/operator partnership:** powered-off finding, carrier IMEI block /
NIN trace (police + NCC DMS), FRP / Activation Lock (already OEM — we integrate
around), OS-reinstall-proof persistence, battery-removed / Faraday detection.

---

## 12. The Nigerian theft model — does the current system answer it?

Yes, honestly. The attack chain *stolen → powered off → SIM removed → flashed →
sold → buyer checks → community detects → owner informed* maps to a real,
working implementation at every step that software can reach — now including
the **legit-resale path** (transfer + registry clear + verified-listing + buyer
interest alert, N5) and stronger alert delivery (webhook sink + retry + SMS
pipeline, N0/M6). The three weakest links left are (a) **the buyer-facing
verified-listings page isn't built** (API is live, UI is not), (b) **SMS
delivery is unproven on a real number** (log mode until credentials), and
(c) **no on-device validation** of the whole chain on real Nigerian
hardware/networks. All three are in the next milestone (§14).

---

## 13. Definition of done for the next milestone

- All five suites pass **in both auth modes** (open and `DRAVEX_OWNER_KEY`):
  - `server/e2e-test.js` — **36 steps** (`== E2E PASSED ==`)
  - `server/e2e-auth.js` — **15 steps** (`== AUTH E2E PASSED ==`)
  - `server/e2e-accounts.js` — **12 steps** (per-owner isolation)
  - `server/e2e-reset.js` — **6 steps** (forgot → deliver → reset → login)
  - `server/e2e-theft.js` — **scenarios A/B/C/D** (hermetic self-booted server;
    `--live` replay against production also passes)
  - `server/e2e-recovery.js` — **63 checks** (Phase-3: confidence engine unit
    checks, lifecycle transitions, evidence retention + pack export, finder
    contact privacy, recovery-API auth) — hermetic self-booted server
- `web/` production build passes; desktop `npm run check` + electron smoke pass;
  Android compiles in CI (GitHub Actions `assembleDebug` = the compile gate).
- No change violates the honesty contract (§4) or the canonical spec.
- New endpoints added to `DRAVEX_NEXTGENE.md` §13 table before merging.
- No dead code left behind (e.g. `listListings()` must be *consumed* by the new
  marketplace page, not left orphaned); no brand remnants.
- Live deployment checks: `https://dravex.vercel.app` serves the dashboard and
  `https://dravex.onrender.com/api/health` returns `{ok:true, mode:"neon"}`;
  `/api/admin/health` stays `401` without the owner key; CORS stays locked to
  the dashboard origin; public stats + Device Check read clean.

---

## 14. The implementation prompt (paste into your agent)

> **Implement the Dravex "Phase-3 slice completion + production hardening"
> milestone, in this order.** Work from `DRAVEX_NEXTGENE.md` as the canonical
> spec; `PLAN.md` is historical and must not influence architecture; `README.md`
> is setup docs only; `DRAVEX_TEST_MATRIX.md` defines the QA rows you validate
> against.
>
> **P0 — Public verified-listings marketplace (closes the one missing N5
> slice).**
> The API is live: `GET /api/listings` (public browse with generic labels),
> `POST /api/listings/:id/interest` (anonymous buyer → private owner alert) —
> but **no web page consumes them** (`listListings()` in `web/lib/api.ts` is
> dead code). Build a `/dashboard/listings` (or `/marketplace`) page: browse
> verified resale-ready devices (price, condition, generic label — never the
> owner's identity), an "I'm interested" action that posts interest and tells
> the buyer the owner has been alerted through the existing privacy-preserving
> relay, and a link from the public Device Check "Verified resale-ready" badge.
> Add the nav entry in `web/app/dashboard/layout.tsx`. Keep owner-side list /
> unlist controls where they are (Agents page). Do NOT build payment/checkout
> (Phase 3.5). The page must fetch from the live API and degrade gracefully
> when offline or empty.
>
> **P1 — On-device validation campaign (human-in-the-loop; you build the
> tools, the operator runs the hardware).**
> The lab and live replay already prove the server. Prepare everything a human
> needs to run `DRAVEX_TEST_MATRIX.md` rows P1–P12 on real devices
> (Tecno/Infinix/Samsung; Windows/macOS/Linux; MTN/Airtel/Glo/9mobile): a
> step-by-step device runbook in `docs/VALIDATION_LOG.md` (which app/build to
> install, what to observe, where to record PASS/FAIL), the `--live` replay
> command, and a checklist that maps each matrix row to its observable. Fix any
> bug surfaced. Do not mark P-rows PASS from automation alone.
>
> **P2 — Live SMS verification (credential-gated; you prepare, the operator
> provides keys).**
> `server/sms.js` is contract-verified (Termii-first/Twilio-fallback, log-mode
> default). With `TERMII_API_KEY` + an **approved** `TERMII_FROM` (DND sender
> ID) set on Render: verify SIM-change and reconnect alerts reach a real
> Nigerian number; failures persist to `deliveryLog` and retry from the web
> Service-health page; the 1/min throttle holds. Update `docs/DEPLOY.md` §4 with
> the exact env vars and the DND sender-ID requirement (already documented —
> keep in sync). Never hardcode a credential.
>
> **P3 — iOS companion build (macOS required).**
> Build the existing SwiftUI project in `ios/TrackNaija/` on a Mac (code is
> ready, `ContentView.swift` points at `https://dravex.onrender.com`): verify
> last-known-location view, the Find My handoff guide, and the report-lost →
> registry flow. Leave the folder name intact (the Xcode project depends on it)
> — brand it Dravex inside.
>
> **P4 — Phase 3.5 readiness (do NOT build yet — document only).**
> Record in `DRAVEX_NEXTGENE.md` the Phase 3.5 shape: repair/refurbish network,
> verified finders, trusted repairers, and payment (Paystack/Flutterwave)
> behind the existing verified-transfer + interest pipeline. No code.
>
> **Constraints:** zero-dependency server (no new npm deps); do not break the
> honesty contract; do not promise power-off/reset survival; every new endpoint
> must be added to `DRAVEX_NEXTGENE.md` §13; keep **all five suites** green in
> both auth modes (§13); web build + desktop check/smoke + Android CI pass; no
> dead code (the marketplace page must consume `listListings()`); no brand
> remnants; do not leave test fixtures on production. When finished, run the
> full validation matrix in §13, then report results per milestone (P0–P4) plus
> the live deployment checks from §13.
