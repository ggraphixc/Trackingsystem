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
