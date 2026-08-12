# Dravex Test Matrix

Formal QA matrix for the Dravex capability set across platforms. Each row has
an explicit **pass criterion** — a capability "works" only when the stated
observable happens — and the automated coverage that proves it today.

Legend: ✅ verified by automation in this repo · 🟡 partially covered / manual
on-device step needed · 🔜 built but awaiting real hardware · ❌ not possible
(honesty contract) · N/A not applicable to the platform.

| Capability | Windows | Android | macOS | Linux | iOS | Pass criterion |
|---|---:|---:|---:|---:|---:|---|
| Online tracking | ✅ | ✅ | ✅ | ✅ | 🟡 | Fix reaches server with `{lat,lng,accuracy,source,timestamp}`; `GET /api/health` shows the device. *(e2e-test steps 1–6)* |
| Wi-Fi location | ✅ | ✅ | 🟡 | 🟡 | 🟡 | Fix carries a BSSID fingerprint; `source` is `wifi_resolved` only from a real server resolution — never fabricated. *(e2e-test [30], 501-honesty path)* |
| IP geolocation fallback | ✅ | — | ✅ | ✅ | — | `source: "ip"` fix accepted; server stores ipAddress. *(e2e-test)* |
| Last-known fallback | ✅ | ✅ | ✅ | ✅ | 🟡 | Offline device still shows `lastFix` to the owner with `last_known` honesty marking. |
| Lost mode | ✅ | ✅ | ✅ | ✅ | Companion | `POST /lost` → recovery code returned, `lost` event + `stolen` alert, registry listing appears, command queued. *(e2e-test [32], auth [8][9])* |
| BLE community relay | ✅ | ✅ | 🔜 | 🔜 | ❌ | Sighting `POST /api/sightings` stored **only for lost devices**; sighting alert throttled; unknown beacons swallowed (201, `ghosts` metric). *(e2e-test, theft lab A6; desktop `ble-scan.*` present, macOS/Linux await hardware)* |
| SIM change detection | N/A | ✅ | N/A | N/A | 🟡 | `sim_change` event stored, decoded operator shown, alert raised (works with data off — radio-level). *(theft lab A4; Android `TrackingService.kt`)* |
| Reconnect detection | ✅ | ✅ | ✅ | ✅ | 🟡 | Fix after a gap > `RECONNECT_GAP_HOURS` → `reconnected` event + alert. *(theft lab A7, B3 — lab forces gap)* |
| Offline vault + burst sync | ✅ | ✅ | ✅ | ✅ | 🟡 | Items queued offline upload via one `batch` call on reconnect; `received`/`failed` counts echo. *(e2e-test)* |
| Remote commands | ✅ | ✅ | ✅ | ✅ | Find My | Owner queues `lock`/`alarm`/`webcam`; agent poll returns it; `ack` marks delivered+acked. *(auth [9], theft lab B4)* |
| Recovery workflow | ✅ | ✅ | ✅ | ✅ | ✅ | Timeline order lost → reconnected → sighting(s) → `verify` → registry resolves clean. *(theft lab B5, C3–C4)* |
| Ownership transfer | ✅ | ✅ | ✅ | ✅ | ✅ | `POST /transfer` rotates the credential (old token dead), purges previous-owner fixes/evidence/sightings, issues fresh code. *(auth [12][13])* |
| Per-owner accounts | ✅ | — | ✅ | ✅ | — | Two users see only their own devices; cross-owner action → 403; logout kills the session. *(e2e-accounts 1–10)* |
| Stolen registry / Device Check | ✅ | ✅ | ✅ | ✅ | ✅ | `GET /api/check` returns `reported_stolen` for a lost device's IMEI/serial with a generic label; `clean` after verify. *(theft lab C2–C4, e2e-test)* |
| Claim hardening | ✅ | ✅ | ✅ | ✅ | ✅ | 10 claims/min/IP; a code locks after 5 failures (429 + code destroyed). *(auth, server code)* |
| Alert delivery | ✅ | ✅ | ✅ | ✅ | ✅ | In-app alert always; push + SMS + webhook fire-and-forget with per-channel metrics; SMS log-mode default. *(admin health counters)* |
| Geolocation honesty | ✅ | ✅ | ✅ | ✅ | ✅ | No `GEOLOCATION_API_KEY` → 501 `unresolved`; agent falls back to ip/last_known. *(auth [14][15])* |
| Powered-off tracking | ❌ | ❌ | ❌ | ❌ | ❌ | **Not offered** — OEM hardware (Find My / Find Hub) only. Honesty contract §23. |
| Factory-reset persistence | ❌ | ❌ | ❌ | ❌ | ❌ | **Not offered** — app is wiped; backstops are FRP/Activation Lock + registry + post-flash Device Check. |

## How to run the automated coverage

```bash
cd server
# 1. Open mode against Neon (or file mode: unset DATABASE_URL)
node server.js &          # set DATABASE_URL first for the PostGIS path
node e2e-test.js          # 35 steps — fixes, geolocate, nearest, transfer, verify, contact
node e2e-theft.js         # scenarios A/B/C
node e2e-accounts.js      # per-owner isolation (works open OR auth mode)
kill %1

# 2. Auth mode (DRAVEX_OWNER_KEY set) — same suites
DRAVEX_OWNER_KEY=test-owner-key-123 node server.js &
node e2e-auth.js          # 15 steps — gating, token rotation, geolocate auth
node e2e-theft.js
node e2e-accounts.js
kill %1

# 3. Web + desktop
cd ../web && npm run build          # production build must succeed
cd ../desktop && npm run check && npx electron smoke-test.js   # SMOKE_PASS

# 4. Android — compiled by CI on every push (.github/workflows/android-build.yml)
```

## Acceptance rule

A release is **shippable** only when: both e2e suites + the theft lab + the
accounts suite pass in both open and auth modes, the web production build and
desktop smoke pass, and Android CI compiled the APK. Every row above must be
either ✅ with its automation green, or explicitly listed in the release notes
as a manual/on-device item.
