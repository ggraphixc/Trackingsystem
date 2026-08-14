# Dravex Tag V2 — production recovery beacon firmware

A tiny BLE beacon that turns an nRF52840 board into a Dravex recovery tag:
it broadcasts the **same beacon format** as the Android agent
(`0000fffa` service + `[0x01]` + 12 hex ASCII), so every existing Dravex
phone and desktop scanner already hears it — **zero protocol changes**.

> **Verification status — read this first**
>
> - ✅ **CODE VERIFIED** — the rotation derivation is pinned by golden
>   vectors and the server resolution contract is covered end-to-end by
>   `server/e2e-tag.js` (21 checks).
> - 🔜 **HARDWARE VERIFIED** — *not yet.* Nothing here has run on a real
>   board: the build, flash, RTC wiring, battery ADC, deep-sleep drain and
>   radio range all still need a bench session (see `docs/DRAVEX_TAG_V2.md`
>   for the hardware checklist). Battery figures in this README are
>   **estimates**, not measurements — do not quote them as product claims.

## What changed in V2 (vs the prototype)

| | V1 prototype | V2 |
|---|---|---|
| Identity | 12-hex NVS id, **broadcast directly** | 6-byte NVS **secret**, never broadcast |
| Beacon | static (permanent BLE identifier) | **day-rotated**: `sha256(secret \| epoch_day)[0..12]` |
| Time | none | battery-backed **RTC** (`drax_rtc` alias); without one the tag **fails closed** (quiet + error LED) |
| Power | advertises continuously while armed | **duty cycle**: SLEEP → WAKE → ADVERTISE(burst) → SLEEP; STANDBY (~1 µA) between bursts |
| Button | long-press arm/disarm | short press = status · long press (≥2 s) = arm/disarm |
| Default | disarmed | **disarmed / quiet** — advertises only while armed; a reboot never re-arms |
| Battery | none | ADC sense via `batt_vbat` alias (honest UNKNOWN without it) |
| Test mode | none | `CONFIG_DRAVEX_TAG_TEST_MODE` (bench only, default off) |

## Hardware requirements

- **MCU:** nRF52840 (nRF52840 DK works for dev; production needs a custom
  board with an RTC + battery).
- **RTC (required for production rotation):** a battery-backed RTC wired as
  devicetree alias `drax_rtc` with the Zephyr `rtc_get_time` API — e.g.
  NXP PCF85063 on I2C (alarm-capable). **Without an RTC the tag cannot know
  the epoch day and refuses to advertise** (fail-safe: no invented time, no
  permanent id on air). The DK has no RTC — use it for dev/test mode only,
  or add an RTC overlay.
- **Battery:** CR2032 coin cell (typical ~220 mAh). The cell should feed the
  RTC so time survives battery changes.
- **Button:** devicetree alias `btn0` (active-low, pull-up — as on the DK).
- **LED:** devicetree alias `led0`.
- **Battery sense (optional):** ADC channel through a resistor divider wired
  as devicetree alias `batt_vbat`. Without it battery state is `UNKNOWN`.

## Build & flash (nRF Connect SDK 2.6+)

```bash
# with the nRF Connect SDK toolchain on PATH and ZEPHYR_BASE set
cd <repo root>
west build -b nrf52840dk_nrf52840 tag-firmware     # production build
west flash
west build -t uart                                 # see the boot log / id
```

Bench build with test mode (never for production):

```bash
west build -b nrf52840dk_nrf52840 tag-firmware -d build-test \
  -- -DCONFIG_DRAVEX_TAG_TEST_MODE=y
```

## Firmware configuration (all centralized)

| Knob | Where | Default |
|---|---|---|
| Advertising burst per cycle | `tag_config.h` / `CONFIG_DRAVEX_TAG_ADV_BURST_MS` | 250 ms |
| Deep sleep between bursts | `tag_config.h` / `CONFIG_DRAVEX_TAG_SLEEP_MS` | 5000 ms |
| Advertising interval range | `CONFIG_DRAVEX_TAG_ADV_INT_MIN/MAX_MS` | 100–150 ms |
| TX power | `prj.conf` (`CONFIG_BT_CTLR_TX_PWR_*`) | 0 dBm |
| Test mode | `CONFIG_DRAVEX_TAG_TEST_MODE` | **off** |

## Behavior

- **Boot:** loads/creates the NVS secret → derives the day's beacon → quiet.
- **Short press (<1 s):** status pulse (2 blinks = armed, 1 = disarmed; a
  slow extra blink = low battery) + battery logged.
- **Long press (≥2 s):** arm ⇄ disarm. Arming without an RTC time source
  fails closed (error pattern, stays silent).
- **While armed:** duty-cycles `ADVERTISE(250 ms) → SLEEP(5 s)`, re-deriving
  the beacon each cycle so it rotates automatically at the UTC day boundary.
  LED glows softly with each burst.
- **Battery:** measured only when `batt_vbat` exists; low threshold ≈ 2.3 V.
- **Reboot:** starts disarmed. Never re-arms itself.

## Pairing a tag in the dashboard

1. On the web dashboard **Agents** page, generate a pairing code.
2. Claim it on behalf of the tag with the tag's **permanent secret** as
   `staticBeacon` (read it from the boot log via `west build -t uart` — it
   prints once on first boot and never changes):

```bash
curl -X POST https://<your-server>/api/pair/claim \
  -H "Content-Type: application/json" \
  -d '{"code":"DX-XXXX-XXXX","hostname":"Dravex Tag","serialNumber":"TAG-<secret>",
       "platform":"tag","staticBeacon":"<12-hex secret from the boot log>"}'
```

3. Mark the tag lost → it enters the stolen registry by serial, and any
   Dravex phone/desktop that hears its **day-rotated beacon** reports an
   anonymous sighting to your map. The server resolves today's + yesterday's
   rotated beacons (`server/beacon.js`); legacy V1 static ids still resolve.

## Battery-life estimates (ESTIMATES ONLY — not measured)

- **Armed:** a 5% radio duty cycle (250 ms burst / 5 s) on a CR2032 is on
  the order of **weeks**, dominated by radio + RTC + LED. This has NOT been
  bench-verified — measure before quoting anything.
- **Disarmed:** deep STANDBY (~1 µA) + RTC — months, in theory. Same caveat.

## Next steps (hardware)

- Bench the DK: build, flash, duty cycle, button, LED, battery ADC on a
  custom board, radio range.
- External RTC overlay + `drax_rtc` wiring; verify rotation across power
  loss and battery change.
- Claim-over-BLE so a tag pairs without the owner typing its secret.
