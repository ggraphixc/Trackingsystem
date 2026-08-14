# Dravex N1 — Real-Device Validation Log

> Source of truth for milestone **N1 (real-device validation)**. One row per
> `DRAVEX_TEST_MATRIX.md` capability. The **server side of every row is proven
> by the automated suites** (see "Software-verified" below); the **physical
> rows** require a human with real hardware and Nigerian networks — this log is
> where their PASS/FAIL is recorded, and the rule is: *a FAIL must be fixed in
> code and retested before the row flips to PASS*.
>
> Legend: ✅ pass · 🔜 pending (needs hardware/network) · ❌ fail (must fix + retest)

---

## 1. Software-verified (this machine — 2026-08-12, batch N0–N5)

These rows are exercised by the hermetic suites and the live deployment; they
need no hardware:

| Row | Result | Evidence |
|---|---|---|
| Server-side theft chains A (Android), B (laptop), C (reset/resale) | ✅ | `node server/e2e-theft.js` — scenarios A/B/C pass, hermetic (random port, file mode, auth forced off) |
| Scenario D: retention sweep (N3) | ✅ | `[D1] retention 30 days → purge removed 1 fix(es), 1 evidence` |
| Scenario D: verified resale + interest alert (N5) | ✅ | `[D2] transfer → listing → 'verified resale-ready' → interest alert → unlist` |
| Scenario D: operator health alerting over real webhook (N4) | ✅ | `[D3] ops alert fired ("rate-limit/abuse storm: 18 throttled …") → delivered to ALERT_WEBHOOK_URL` |
| Scenario D: public counters (N5) | ✅ | `[D4] stats: protected=2 recovered=0 sighted=0 listings=0` |
| All five E2E suites, both auth modes | ✅ | open: e2e-test 36 · theft A–D · accounts 12 · reset 6 — auth: e2e-auth 15 · theft A–D · accounts 12 · reset 6 |
| Web production build | ✅ | `npm run build` → Compiled successfully (landing stats band, resale UI, retention controls, ops tiles) |
| Desktop check + smoke | ✅ | `npm run check` + electron smoke — SMOKE_PASS, no renderer errors |
| Live deployment health | ✅ | `GET https://dravex.onrender.com/api/health` → `{ok:true, devices:52, mode:"neon"}` |
| Live owner gate + CORS lock | ✅ | `/api/admin/health` 401 without key; only `https://dravex.vercel.app` allowed origin |
| Live dashboard end-to-end (browser) | ✅ | dravex.vercel.app → overview + device vault load, zero CORS errors |

### Live-server theft replay (needs the production owner key)

```bash
cd server
DRAVEX_OWNER_KEY=<your render key> node e2e-theft.js \
  --live https://dravex.onrender.com --owner-key <your render key>
```

> ⚠️ This creates test devices (`LIVE-TECNO-PHONE`, `LIVE-HP-ELITEBOOK`, IMEI
> `354988079999991`) on the production server. Replay only when you accept test
> data in prod, or run against a staging Render service instead. Owner-scoped
> steps (mark-lost / transfer / verify / settings / admin) need the key; without
> it the run stops at the first owner call.

---

## 2. Physical-device rows — PENDING (hardware + Nigerian networks required)

| # | Row (`DRAVEX_TEST_MATRIX.md`) | Android | Windows | macOS | Linux | iOS | Notes |
|---|---|---|---|---|---|---|---|
| P1 | Online tracking (ladder: GPS/wifi/cell → IP → last-known) | 🔜 Tecno/Infinix/Samsung | 🔜 | 🔜 | 🔜 | 🔜 companion | MTN/Airtel/Glo/9mobile each |
| P2 | Wi-Fi positioning (`wifi_resolved` real BSSID) | 🔜 | 🔜 | 🔜 | 🔜 | 🔜 | needs `GEOLOCATION_API_KEY` on the server |
| P3 | Lost mode (beacon advertises only while lost) | 🔜 | — | — | — | — | check radio OFF → beacon still heard |
| P4 | BLE relay (scan + anonymous sighting upload) | 🔜 | 🔜 | 🔜 | 🔜 | ❌ platform | macOS/Linux watchers are code-complete — verify on real hardware |
| P5 | SIM-change detection (data off) | 🔜 | N/A | N/A | N/A | 🔜 | swap SIM mid-session; alert must fire |
| P6 | Reconnect detection (12 h gap) | 🔜 | 🔜 | — | — | — | offline >12 h, reconnect, alert fires |
| P7 | Remote commands (lock/alarm/webcam) delivered + acked | 🔜 | 🔜 | 🔜 | 🔜 | Find My | webcam: visible-indicator + consent check |
| P8 | Offline vault burst sync | 🔜 | 🔜 | 🔜 | 🔜 | 🔜 | capture offline → upload on reconnect |
| P9 | Recovery workflow (verify → transfer → resale-ready) | 🔜 | 🔜 | — | — | 🔜 | end-to-end on two devices |
| P10 | OEM battery-optimization whitelist (Tecno/Infinix/Samsung) | 🔜 | — | — | — | — | service survives background-kill; reboot re-arms lost mode |
| P11 | Reboot re-arm (BOOT_COMPLETED → beacon/lost mode restored) | 🔜 | — | — | — | — | power-cycle mid-lost |
| P12 | iOS companion: last-known + Find My handoff + report-lost | — | — | — | — | 🔜 | build `ios/TrackNaija` on macOS (N2) |

**How to record a result:** edit this table, change `🔜` → `✅ <date + device + network>`
or `❌ <what failed>`; then open a follow-up so the failure is fixed and retested.

---

## 3. Theft-scenario runbook (physical)

Use `docs/THEFT_LAB.md` scenarios A/B/C as the script, but on real hardware
against the **live** server (or a staging service):

1. **A — Android:** pair a real phone → mark LOST → pull the SIM → turn data/Wi-Fi
   off → watch a second Dravex device (phone or laptop) detect the beacon →
   owner alert → insert a new SIM → reconnect alert → verify recovered.
2. **B — Laptop:** pair a laptop → LOST → disconnect internet → move to a new
   Wi-Fi → fix lands (honest source) → lock/alarm/webcam from the dashboard →
   evidence captured → recovery timeline.
3. **C — Reset/resale:** factory-reset the phone → fresh install → Device Check
   the IMEI → 🔴 STOLEN → owner verifies/transfers → new owner claims →
   Device Check reads 🟢 verified resale-ready if listed.

Record each step's PASS/FAIL in the table above and in `docs/THEFT_LAB.md`'s
run log.

---

## 4. Milestone P1 — 27-point physical checklist (execution log)

> **Status: BLOCKED — awaiting physical hardware.** The automated suites prove
> the *server* side of every row; the *physical* side needs real devices,
> Nigerian SIMs (MTN/Airtel/Glo/9mobile) and real Wi-Fi environments, which are
> not available on this build machine (Windows CI box, no Android handsets, no
> macOS). Every row below is software-verified where it says so; the physical
> run is the remaining step. Fill the evidence column when hardware is in hand.
>
> For every row record: **device model · OS version · carrier · network state ·
> Dravex version · timestamp · expected result · actual result · evidence**.

| # | Validation item | Software-verified | Physical status | Evidence / how to run it |
|---|---|---|---|---|
| 1 | Device pairing (vault registration) | ✅ suites | 🔜 BLOCKED | Pair a Tecno/Infinix/Samsung + any laptop against the live server |
| 2 | Authentication (owner gate + device token) | ✅ e2e-auth | 🔜 BLOCKED | Owner key/session on phone + laptop; token rotation on transfer |
| 3 | Location collection | ✅ suites | 🔜 BLOCKED | Real GPS/cell on phone; Wi-Fi scan on laptop |
| 4 | Signal ladder (GPS → Wi-Fi → cell → IP → last-known) | ✅ suites | 🔜 BLOCKED | Cut signals one at a time and watch the source change honestly |
| 5 | Real Wi-Fi geolocation (BSSID resolve) | ✅ M0/M1 suites | 🔜 BLOCKED | Needs `GEOLOCATION_API_KEY` on the server + real BSSIDs |
| 6 | IP fallback | ✅ suites | 🔜 BLOCKED | Disable Wi-Fi, keep data on (phone) / tether (laptop) |
| 7 | Last-known location | ✅ suites | 🔜 BLOCKED | Power off mid-session; check last-known renders as stale, never live |
| 8 | Offline vault (burst capture) | ✅ suites | 🔜 BLOCKED | Go offline, capture fixes/evidence, reconnect → uploads |
| 9 | Burst sync after reconnect | ✅ suites | 🔜 BLOCKED | Same as row 8 — verify vault drains fully |
| 10 | Lost mode (beacon advertises only while lost) | ✅ suites | 🔜 BLOCKED | Mark LOST; watch beacon start; mark found; beacon stops |
| 11 | Reboot re-arm (BOOT_COMPLETED) | ✅ Android code | 🔜 BLOCKED | Power-cycle mid-lost on a real Android device |
| 12 | Battery-optimization behavior (OEM killers) | ✅ guidance strings | 🔜 BLOCKED | Tecno/Infinix/Samsung: whitelist + background-kill survival |
| 13 | SIM-change detection | ✅ suites | 🔜 BLOCKED | Swap SIM with data off; alert must fire (P5) |
| 14 | Reconnect detection | ✅ suites | 🔜 BLOCKED | Offline >12 h, reconnect, alert fires (P6) |
| 15 | BLE advertising (lost beacon) | ✅ Windows code | 🔜 BLOCKED | Real phone advertises; second device hears it (P3/P4) |
| 16 | BLE scanning (sighting upload) | ✅ Windows code | 🔜 BLOCKED | macOS/Linux watchers code-complete — verify on real hardware |
| 17 | Community sightings (anonymous relay) | ✅ suites | 🔜 BLOCKED | Two real devices; check owner sees count + recency, not identity |
| 18 | Remote lock | ✅ suites | 🔜 BLOCKED | Lock from dashboard on a real laptop/phone |
| 19 | Alarm | ✅ suites | 🔜 BLOCKED | Alarm + visible indicator, then dismiss |
| 20 | Evidence (webcam capture) | ✅ suites | 🔜 BLOCKED | Visible indicator + consent; capture lands in Evidence Center |
| 21 | Recovery timeline | ✅ suites | 🔜 BLOCKED | Walk scenario B; verify merged timeline ordering |
| 22 | Recovery confidence | ✅ e2e-recovery | 🔜 BLOCKED | Compare dashboard score vs actual signal freshness |
| 23 | Finder contact (anonymous message) | ✅ suites | 🔜 BLOCKED | Open public `/recover/<id>` page on another device; message owner |
| 24 | Device Check (IMEI/serial registry) | ✅ suites | 🔜 BLOCKED | Check stolen + clean IMEIs on the live site |
| 25 | Transfer (ownership handover) | ✅ suites | 🔜 BLOCKED | Two real users; registry clears; new owner claims |
| 26 | Recovery/verification | ✅ suites | 🔜 BLOCKED | Verify → Recovered; registry entry resolves |
| 27 | Forget-device (incl. stale pair-code) | ✅ theft D5 | 🔜 BLOCKED | Forget a real device; attempt its old pairing code — must fail |

### Milestone P1 — theft simulations (real hardware, live server)

| Scenario | Steps | Status |
|---|---|---|
| A — Android | Pair → LOST → SIM removed → data/Wi-Fi off → nearby Dravex detects beacon → owner alert → new SIM → reconnect alert → recovered | 🔜 BLOCKED |
| B — Laptop | Pair → LOST → offline → new Wi-Fi → honest fix → lock/alarm/webcam → evidence → timeline → recovered | 🔜 BLOCKED |
| C — Reset/resale | Factory reset → fresh install → Device Check IMEI → 🔴 STOLEN → owner transfers → new owner claims → 🟢 verified resale-ready | 🔜 BLOCKED |
| D — Forget | Forget device → attempt its stale pairing code → must NOT resurrect the device | ✅ theft-lab D5 (hermetic) — repeat on real hardware |

### Milestone P1 — runbook (once hardware is available)

1. Set `GEOLOCATION_API_KEY` on the staging/live server for row 5.
2. Install the Android APK (GitHub Actions artifact) on a Tecno, an Infinix and
   a Samsung; walk rows 1–17, 27 on each network (MTN, Airtel, Glo, 9mobile).
3. Install the desktop agent on Windows/macOS/Linux laptops; walk rows 1–11,
   18–26 per platform (macOS/Linux BLE watchers verified in row 16).
4. Build `ios/TrackNaija` on macOS (see §5 below) and walk the companion rows.
5. Record every PASS/FAIL in §4 with the evidence columns; a FAIL opens a fix
   task and the row is re-run before flipping to PASS.

---

## 5. Milestone P3 — iOS companion build (BLOCKED: needs macOS)

> **Status: BLOCKED — this build machine is Windows; Xcode/macOS is required.**
> The companion code is present and pointed at production:
> `ios/TrackNaija/ContentView.swift` defaults to `https://dravex.onrender.com`.

```bash
# On a Mac, from the repo root:
cd ios/TrackNaija
open TrackNaija.xcodeproj          # or: xcodebuild -scheme TrackNaija -destination 'generic/platform=iOS' build
```

Verify on a device/simulator:

1. App launches; brand reads **Dravex** (folder stays `TrackNaija` — the Xcode
   project depends on it).
2. Last-known location view loads from the live API.
3. Report-lost flow updates the stolen registry (Device Check reflects it).
4. Find My handoff: the companion points the user to Apple Find My for
   powered-off / background tracking — Dravex never claims iOS background
   tracking (honesty contract §23.5).
5. Recovery/reporting messaging is honest (no "continuously tracks iPhone").
