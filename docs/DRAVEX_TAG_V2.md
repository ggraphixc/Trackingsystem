# Dravex Tag V2 — production recovery beacon (hardware doc)

> This document is the **hardware-facing** companion to the firmware README
> (`tag-firmware/README.md`). It covers the physical board, wiring, flashing
> and bench checklist.
>
> ## Verification status — read this first
>
> | Layer | Status |
> |---|---|
> | **CODE VERIFIED** | ✅ Rotation derivation pinned by golden vectors; server resolution contract covered by `server/e2e-tag.js` (21 checks, green); all server E2E suites green |
> | **HARDWARE VERIFIED** | 🔜 **Not yet.** No code in this repo has run on a real board. Build, flash, RTC wiring, ADC calibration, deep-sleep drain and radio range all require a bench session |
>
> Battery figures in this document are **estimates only** — do not quote them
> as product claims until measured on physical hardware.

---

## 1. Product role

A Dravex Tag is a tiny BLE beacon that gives a Dravex identity to things that
can't run an app: bags, motorcycles, laptops that can't be modified, phones
before the agent is installed. It broadcasts the **same beacon format** as
the Android agent (`0000fffa` service + `[0x01]` + 12 hex ASCII), so every
existing Dravex scanner (Android, Windows, macOS, Linux) already hears it —
zero protocol changes.

Privacy model: the tag is **silent by default**. It only advertises while
armed (marked lost by the owner via long-press). It never broadcasts a
permanent identifier.

## 2. Hardware requirements

| Item | Requirement | Notes |
|---|---|---|
| MCU | nRF52840 | nRF52840 DK for dev; custom board for production |
| RTC | Battery-backed RTC (e.g. PCF85063 on I2C) wired as devicetree alias `drax_rtc` | Required for time-aware rotation; keeps time across battery swaps |
| Battery | CR2032 (~220 mAh) or Li-Po + coin cell | Cell should feed the RTC so time survives battery changes |
| Button | Devicetree alias `btn0` (active-low, pull-up) | Long-press arm/disarm, short-press status |
| LED | Devicetree alias `led0` | Short status pulses only |
| Battery sense (optional) | ADC via resistor divider, alias `batt_vbat` | Without it battery reads `UNKNOWN` (honest, not fabricated) |

## 3. Wiring

- **Button** `btn0`: GPIO input, active-low with internal pull-up (matches
  the DK default). Long-press threshold 1500 ms.
- **LED** `led0`: GPIO output. Pulses are short (≤150 ms) — no blink storms.
- **RTC** `drax_rtc`: I2C, alarm-capable, battery-backed. The firmware calls
  the Zephyr `rtc_get_time` API to derive the epoch day.
- **Battery sense** `batt_vbat`: ADC channel reading a resistor-divider from
  the cell; see `tag_batt.c` for the reference divider math (calibration on
  real boards required).

## 4. Identity & rotation (P0/P1)

- Permanent identity: a 16-byte secret persisted in **NVS**
  (`CONFIG_DRAVEX_TAG_NVS_SECRET_KEY`). Survives reboot, battery swap and
  normal restart. **Never transmitted.**
- Broadcast identity: `beaconId = hex(sha256(secret + "|" + epochDay))[0..12]`
  — deterministic per tag, changes at every UTC day boundary.
- Server resolution: `server/beacon.js` matches the current day's id **and**
  the previous day's (grace window for midnight crossings). Older ids expire
  naturally; a stale id cannot be replayed as the tag's identity.
- Fail-safe: if the RTC cannot produce trustworthy time, the tag uses the
  boot day and refuses to advertise past it (never invents unbounded time,
  never emits the permanent secret). **Fail closed, not loose.**
- Rotation scheme is documented in `DRAVEX_NEXTGENE.md` §19 and pinned by
  golden vectors in `server/e2e-tag.js`.

## 5. Duty cycle & power (P2)

```
SLEEP → WAKE → ADVERTISE (burst) → SLEEP
```

| Config | Default | Meaning |
|---|---|---|
| `TAG_ADV_INTERVAL_MS` | 100 ms | BLE advertising interval while advertising |
| `TAG_ADV_DURATION_MS` | 2000 ms | Burst length per cycle |
| `TAG_SLEEP_DURATION_MS` | 15000 ms | Deep sleep between bursts |
| `TAG_TX_POWER_DBM` | 0 dBm | Radio TX power |

All values are centralized in `tag-firmware/src/tag_config.h`; test mode can
override them at runtime (bench only).

**Battery-life estimate (NOT measured):** with the above defaults, an armed
tag advertises ~11% of the time. A CR2032-class cell at a few µA standby +
burst current suggests **weeks of continuous armed operation and months of
silent standby** — pending bench verification. Do not publish these numbers
as claims.

## 6. Arm / disarm & status (P4/P5)

| Action | Behavior |
|---|---|
| Short press | Status pulse (LED) |
| Long press (≥1.5 s) while **disarmed** | **Arm** — begin recovery advertising; LED double-pulse |
| Long press (≥1.5 s) while **armed** | **Disarm** — stop advertising; single pulse |

- Default state on boot: **DISARMED / QUIET**. A reboot never re-arms.
- LED pulses: armed = 2×150 ms, disarmed = 1×150 ms, low battery = slow
  double, error = 5×fast. Keep them short to preserve battery.
- The tag only advertises while armed — there is no permanent BLE tracking
  identifier.

## 7. Battery telemetry (P3)

- `tag_batt.c` samples the ADC divider and reports:
  - raw voltage (mV)
  - estimated percentage
  - low-battery flag (below `TAG_BATT_LOW_MV`)
- Without a `batt_vbat` alias the value is `TAG_BATT_UNMEASURED` — the
  firmware never fabricates a reading.
- Server representation: not required — battery is a local/status concern;
  sighting anonymity is unaffected.

## 8. Test mode (P8)

`CONFIG_DRAVEX_TAG_TEST_MODE` (Kconfig, **off by default**):

- Force immediate rotation (advance the day bucket)
- Override advertising duration / sleep duration at runtime
- Log battery readouts
- Inspect identity through the dev interface (UART/shell)

The permanent secret is **never** emitted in normal BLE packets, including
in test mode. Production builds ship with test mode disabled.

## 9. Server integration (P6)

- `server/beacon.js` resolves Tag V2 rotating ids (current + previous day)
  and still matches legacy static (`staticBeacon`) V1 hardware.
- Sightings remain anonymous: no owner identity, no permanent tag id, no
  scanner identity, no exact owner location.
- No API/schema changes were required for V2 (documented in
  `DRAVEX_NEXTGENE.md` §13 — no changes were needed, so no entry was added).

## 10. Community detection (P7)

The tag speaks the existing Dravex beacon format, so the existing listeners
detect it where the platform allows scanning:

- **Android** — `Beacon.kt` scanner (duty-cycled 12 s / 5 min)
- **Windows** — desktop BLE scanner (`ble-scan.ps1` / `ble-scan.js`)
- **macOS / Linux** — CoreBluetooth / BlueZ listeners (Phase 2.5 BLE
  milestone)

Platforms that restrict background scanning (iOS) will not reliably detect
it — that is an OS limitation, not a firmware one.

## 11. Security / privacy (P11)

Never broadcast: owner name, phone, email, permanent device identity, exact
recovery location, recovery message. The tag advertises **only while
armed/lost**. Rotating ids mean no permanent BLE tracking identifier exists.

## 12. Flashing

```bash
# nRF Connect SDK 2.6+ with ZEPHYR_BASE set
west build -b nrf52840dk_nrf52840 tag-firmware     # production build
west flash
west build -t uart                                 # boot log / id
```

Bench build with test mode (never for production):

```bash
west build -b nrf52840dk_nrf52840 tag-firmware -- \
  -DCONFIG_DRAVEX_TAG_TEST_MODE=y
```

## 13. Hardware bench checklist (unverified items)

| # | Item | Pass criteria |
|---|---|---|
| 1 | Build clean | `west build` completes with no errors |
| 2 | Flash + boot | Boot log prints tag id, no crash |
| 3 | NVS persistence | Reboot + battery swap: same secret, same beacon (that day) |
| 4 | RTC time | RTC reads correct epoch; day boundary rotates the beacon |
| 5 | Rotation | Beacon id stable within a day, changes at midnight |
| 6 | Server resolution | A sighting of the current day's beacon resolves to the tag |
| 7 | Duty cycle | Advertise burst then sleep; standby current ≈ spec |
| 8 | Arm/disarm | Long-press arms (advertising), long-press disarms (silent) |
| 9 | LED | Short pulses, no blink storms |
| 10 | Battery ADC | Voltage/percent sane against a multimeter |
| 11 | Low battery | Low flag fires at threshold |
| 12 | Range | Detectable by an Android phone at ≥10 m line-of-sight |
| 13 | Privacy | A sniffer sees only rotated ids, never the permanent secret |

## 14. Known hardware blockers (unresolved)

- No physical board has been purchased or flashed — everything above is
  code-verified only.
- RTC wiring (PCF85063 or equivalent) is not on the DK; a production board
  or an overlay is required for time-aware rotation.
- ADC divider calibration constants are placeholders until measured.
- Battery life and radio range are estimates until bench-tested.
