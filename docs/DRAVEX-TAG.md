# Dravex Tag — optional recovery beacon (hardware spec)

> Status: **spec only** — no firmware or hardware exists in this repo. This
> document is the design brief for the optional recovery beacon that extends
> Dravex to items that can't run an app: bags, motorcycles, a laptop you can't
> install software on, a phone before you install the agent.

## Why a tag at all

Software covers the device that runs the Dravex agent. A **tag** covers
everything else, and it closes the gap the software honestly can't: a phone
with its battery removed, or a bag in a market crowd. A $10–20 BLE beacon is
the cheapest way to give an item a Dravex identity.

## What the tag must do

1. **Broadcast a Dravex beacon** — the same `0000fffa` service + `[0x01]+12hex`
   payload format the Android agent and the desktop BLE scanner already speak.
   The existing ecosystem (phone scanner, desktop scanner, `/api/sightings`,
   the map view) adopts it with **zero protocol changes**.
2. **Be silent until armed** — privacy-first, like the phone agent: the tag
   broadcasts *only* while the owner marks it lost. Before that it's a
   sleeping BLE peripheral (months of battery).
3. **Survive a quick battery swap** — the identity lives in flash, not RAM.

## Reference hardware (off-the-shelf, no custom silicon)

| Part | Why |
|---|---|
| nRF52832 / nRF52840 (or an ESP32-C3 for the budget SKU) | BLE 5, tiny, cheap, huge community toolchain |
| CR2032 (or Li-Po + coin cell for the premium SKU) | Months of sleep-battery |
| 1–2 buttons (long-press = arm lost, 3× tap = disarm) | Works without the phone app |
| Optional: accelerometer (LIS2DH12) | Movement detection for the "Device moved X km" timeline |

Firmware is trivial on any of these: an advertising loop that starts on a
button press and stops on a second press or on a BLE write from the owner's
paired app.

## The tag lifecycle

```
OWNER                            DRAVEX NETWORK
  │  pairs tag via app (QR on box)
  ├──────────────────────────────►  deviceId + serial registered
  │  marks tag lost (app or button)
  ├──────────────────────────────►  registry entry (like any device)
  │
  │  tag starts broadcasting ─────►  any Dravex phone/desktop hears it
  │                                   → anonymous sighting → owner's map
  │
  │  owner recovers it (app button)
  ├──────────────────────────────►  registry resolved, beacon sleeps
```

## What this repo already supports

- The beacon **payload format** (`beacon.js`) — resolveBeacon maps a beacon ID
  to a device, so a tag registered as a device just works.
- The **scanner side** — Android `Beacon.scanOnce` + desktop `ble-scan.ps1`.
- The **sighting pipeline** — `/api/sightings` → alerts → map + proximity.
- The **registry** — mark a tag lost and its serial appears in `/api/check`.

The only missing pieces are the physical tag and its firmware, which live
outside this codebase.

## Honest limits

- A tag broadcasts only while **powered**. In a Faraday bag, in a metal
  drawer, or with a dead battery, it's invisible — same physics as everything
  else in the Dravex network.
- Battery life is a budget: fast broadcast while lost (seconds) drains far
  faster than the sleeping state.
- There is no GPS in a coin-cell tag. "Seen at" is the **scanner's** position,
  which is exactly how the community relay already works.

## Recommended first SKU

A nRF52840 + CR2032 + 1 button, in a keyring/screw-down case, QR pairing
sticker. Target BOM under $12. Firmware effort: a couple of days in
Zephyr/Arduino — same advertising structs as `android/.../Beacon.kt`.
