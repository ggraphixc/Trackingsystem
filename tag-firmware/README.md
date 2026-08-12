# Dravex Tag — recovery beacon firmware (prototype)

A tiny BLE beacon that turns any nRF52840 board into a Dravex recovery tag:
broadcast the **same beacon format** as the Android agent
(`0000fffa` service + `[0x01]` + 12 hex ASCII), so every existing Dravex phone
and desktop scanner already hears it — zero protocol changes.

> **Status:** prototype firmware. Buildable with the nRF Connect SDK (Zephyr),
> not yet bench-tested. Battery budget, RTC rotation and enclosure are product
> decisions to make after this boots on real hardware.

## What it does

- **Silent until armed** — privacy-first, like the phone agent. The tag
  broadcasts *only* while armed.
- **Long-press the button (≥ 2 s) to arm**, long-press again to disarm.
- **Identity survives everything** — a random 12-hex id is generated on first
  boot and stored in NVS (flash), so a battery swap or reboot never changes
  the id. Read it from the boot log (`tag_id`).
- **LED on while armed**, off while silent.

## Protocol (matches `android/.../Beacon.kt` + `server/beacon.js`)

```
Advertising packet (extended advertising — 43 bytes needs it):
  UUID128 0000fffa-0000-1000-8000-00805f9b34fb   (scanner filter)
  Service data [0x01] + 12 ASCII hex chars        (the beacon id)
```

The id is **static** (not day-rotated) for the prototype: `server/beacon.js`
resolves static tag beacons via a device's `staticBeacon` field, so sightings
work today. Day rotation for tags needs an RTC (see "Next steps").

## Build & flash (nRF Connect SDK 2.6+)

```bash
# with the nRF Connect SDK toolchain on PATH and ZEPHYR_BASE set
cd <repo root>
west build -b nrf52840dk_nrf52840 tag-firmware
west flash
west build -t uart  # or your terminal app — the id prints on boot
```

Pin the button/LED via devicetree aliases (`btn0`, `led0` — present on the
nrf52840dk; override with an overlay for your board).

## Pairing a tag in the dashboard

1. On the web dashboard **Agents** page, generate a pairing code.
2. Claim it on behalf of the tag — the firmware's own claim logic is out of
   scope for this prototype, but the server accepts the id at claim:

```bash
curl -X POST https://<your-server>/api/pair/claim \
  -H "Content-Type: application/json" \
  -d '{"code":"DX-XXXX-XXXX","hostname":"Dravex Tag","serialNumber":"TAG-<id>",
       "platform":"tag","staticBeacon":"<12-hex id from the boot log>"}'
```

3. Mark the tag lost → it appears in the stolen registry by serial, and any
   Dravex phone/desktop that hears its beacon reports a sighting to your map.

## Battery notes (honest)

- Advertising **while armed** at slow intervals (1–2.5 s) on a CR2032 is a
  matter of **days**, not months. A production tag should duty-cycle
  (e.g. 100 ms burst every 5 s) and sleep deeply while disarmed — the armed
  window is what matters, so sleeping disarmed is nearly free.
- There is **no GPS** in a coin-cell tag: "Seen at" is the *scanner's*
  position, exactly like the community relay already works.

## Next steps

- Deep sleep (system off) while disarmed; wake on button.
- RTC-driven day rotation of the beacon id (persistent epoch day in NVS).
- Advertising duty-cycle + a low-power SKU profile in `prj.conf`.
- Claim-over-BLE so the tag pairs without the owner typing its id.
