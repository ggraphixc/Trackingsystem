# Dravex Theft Simulation Lab

The lab proves the recovery chain the product is built around — not by
simulating *feelings*, but by replaying the exact signals a stolen device
emits against a real running server:

```
Phone stolen → powered off → SIM removed → goes offline → surfaces again
→ owner alerted → registry blocks resale
```

It is the bridge between "the architecture models this" and "we watched it
happen on a real server". Run it in CI or locally before every release.

## Run it

```bash
cd server

# File mode (zero setup)
node server.js &
node e2e-theft.js
kill %1

# Auth mode — same script, same assertions
DRAVEX_OWNER_KEY=test-owner-key-123 node server.js &
node e2e-theft.js
kill %1
```

Against Neon (PostGIS): just set `DATABASE_URL` and run the same commands.

Exit code 0 + `THEFT LAB PASSED` = all three scenarios held.

## Scenario A — Android theft (the Nigerian chain)

```
phone paired → normal tracking → marked LOST → SIM removed → Wi-Fi off
→ device goes offline → beacon sighting → owner alerted → device reconnects
on a new SIM → reconnect + sim_change alerts → recovery
```

The lab replays each stage against a device the server knows:

1. `pair/register` + `claim` (phone identity with IMEI + operator fingerprint).
2. Fixes stream in (last-seen stays fresh).
3. Owner marks **lost** → server returns a recovery code and arms the
   community beacon.
4. `sim_change` event (thief swapped SIM — fingerprint `621|20` → `621|50`,
   MTN → Glo) → SIM-change alert.
5. Device goes quiet (no fixes) → "offline" is visible to the owner.
6. A **sighting** for the lost device's beacon arrives from a community
   scanner position → sighting alert (throttled), sighting stored.
7. After a silence longer than `RECONNECT_GAP_HOURS` (default 12 h — the lab
   boots the server with `RECONNECT_GAP_HOURS=0` so every gap counts), a new
   fix uploads → `reconnected` event + alert.
8. The lab asserts: sightings were stored **only because** the device was
   lost, alerts fired for sim_change/sighting/reconnected, and the recovery
   code round-trips.

**Why this matters:** this is the exact moment a real owner finds out their
phone resurfaced — SIM change says "it's being reused", reconnected says
"it's online somewhere", sighting says "it was near here 8 minutes ago".

## Scenario B — Laptop theft

```
laptop paired → marked LOST → internet disconnected → laptop moved
→ new Wi-Fi → real Wi-Fi geolocation → fix uploaded → remote command
→ evidence → owner sees the recovery timeline
```

The lab replays:

1. Pair + claim with a serial number (laptop identity).
2. Mark lost → registry entry keyed by serial (the buyer-protection listing).
3. Reconnect on a new network after a gap → `reconnected` event; the new fix
   carries a Wi-Fi fingerprint (`wifi_resolved` when the server has
   `GEOLOCATION_API_KEY`, honest `ip`/`last_known` fallback otherwise —
   **never a fabricated coordinate**).
4. Queue a remote command (`lock`) and verify the agent poll delivers and
   acks it — the "the next user gets locked out + photographed" path.
5. The lab asserts the recovery timeline contains lost → reconnected → command
   ack in order, and the registry lists the serial as `reported_stolen`.

## Scenario C — Reset / resale

```
device stolen → factory reset → new owner checks the device
→ IMEI/serial submitted → 🔴 STOLEN
```

The lab replays:

1. A device (IMEI on a phone, serial on a laptop) is reported lost.
2. The public `GET /api/check?q=<imei|serial>` returns `reported_stolen`
   with a generic label — **no owner data leaks**.
3. Owner recovers → `verify` resolves the registry.
4. The same check now reads `clean` (previously reported) — an honest seller
   is never flagged by an old report.
5. A second device with a *different* identifier reads `clean` — the registry
   doesn't over-match.

## Moving from simulated to real hardware

The lab replays server-side signals. To test the full loop on physical
devices (Phase 2.5 on-device checklist):

| Test | Android (real phone) | Windows laptop |
|---|---|---|
| Pair + claim | Install APK (CI artifact), enter code | Desktop agent → Link to dashboard |
| Mark lost | Web dashboard → My Devices → Lost | Same |
| SIM removal | Remove SIM, watch dashboard for sim_change (data-off works) | n/a |
| Offline vault | Airplane mode → fixes queue → reconnect → burst sync | Disconnect network → reconnect |
| Beacon relay | Two phones: A lost, B scans → sighting on A's recovery view | `Find nearby` sweep hears phone A |
| Command | Lock/Alarm from web → phone locks/alarms | Webcam capture + alarm |
| Recovery | `verify` → registry clean | Same |

**Known gaps to record on real devices:** OEM battery managers may kill the
scan duty-cycle (use the in-app battery-protection flow, M7); iOS is a
companion only (no BLE advertising); a full OS reinstall wipes the agent —
the backstops are FRP/Activation Lock and the registry.
