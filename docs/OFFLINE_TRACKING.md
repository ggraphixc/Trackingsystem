# Offline Tracking — finding a phone whose data & Wi-Fi are off

> **The honest starting point:** a phone with *zero* connectivity (no SIM, no
> Wi-Fi, powered off) physically cannot transmit its location. No app can fix
> that. But turning off mobile data gives a thief **zero protection** against
> the four channels below — and most thieves never achieve a truly dead phone.

This document is the source of truth for TrackNaija's offline strategy: what
the agent captures, what the dashboard generates, and the exact Nigeria legal
workflow that makes each channel actionable.

---

## The four channels (in order of real-world power)

### 1 · Carrier tower triangulation — the definitive "data off" tracker

**Physics:** a phone with an active SIM that is powered on MUST keep
registering with the cellular network on control channels — that's how the
carrier routes incoming calls and SMS. Toggling "mobile data" only switches
off the packet-data bearer; the radio registration continues. The carrier can
see which tower and sector the phone is camped on, and multi-tower
triangulation (timing advance, signal strength) narrows it to a few hundred
metres.

**In Nigeria:** operators do not act on informal requests. The lawful route:

1. File a complaint with the **NPF-NCCC** (`nccc.npf.gov.ng`) or **CRP**
   (`crp.ng`, USSD `*121#`) → get a **police report reference**.
2. Send a formal **cell-location request** to the operator's Legal &
   Regulatory Compliance / law-enforcement desk, citing **Section 147 of the
   Nigerian Communications Act 2003** (lawful interception powers).
3. Produce a **court order** where the operator's procedures require one
   (standard for real-time triangulation data; NPF-NCCC or State CID obtain it).

**In practice in Nigeria:** the mobile data is switched off by a thief, but
the SIM usually stays in and the phone stays on (or is merely locked). The
operator records tower registrations for that SIM. Note that a new SIM linked
to a **NIN (National Identification Number)** is registered by the NCC — so
when the phone later connects with a *new* SIM, the network can identify who
registered it. Both the **NPF-NCCC** and the **State Criminal Investigation
Department (SCID)** can request this; SCID is the stronger escalation for
tracked/stolen phone cases.

**What TrackNaija does:** the dashboard's **Offline Recovery → carrier
cell-location request** kit generates the exact letter (per operator:
MTN/Airtel/Glo/9mobile) with the IMEI, police reference and legal citations,
ready to print and submit. The agent pre-populates the device details.

### 2 · Google Find My Device offline network (Android)

**Physics:** if the lost phone's **Bluetooth is on** and the owner enabled
"Find your offline devices" (network mode "With network in all areas"), the
phone broadcasts rotating encrypted BLE beacons. Any nearby Android device
participating in the network picks up the beacon and — using *its own*
internet — relays the sighting to Google. The lost phone's own data/Wi-Fi
being off is irrelevant. (Pixel 8+ can even beacon briefly after power-off.)

**Caveats:** needs the phone to have an active Google account, offline
finding pre-enabled (do it NOW, before loss), and Bluetooth on. Privacy
defaults may suppress sightings in non-busy areas. High-end hardware nuance:
powered-off beaconing requires modern silicon (Pixel 8/9, iPhone 11+,
flagship Samsungs); older phones can only beacon while the battery lasts.
Samsung users also have **SmartThings Find** — an independent offline
locating network over Bluetooth/BLE that can report a lost Galaxy phone even
when it has no data or Wi-Fi.

**What TrackNaija does:** the Offline Recovery page includes the enable-now
checklist (Google Find My + SmartThings Find) + links. We complement these
channels — we don't compete with them.

### 3 · Offline evidence vault + burst sync (our agent)

**Physics:** storage and capture don't need a network. While the phone is in
the thief's hands with data off, the agent keeps working locally.

**What TrackNaija does (Android agent):**
- **`OfflineVault`** — a persistent, bounded queue on disk (`offline_queue.json`)
  holding fixes, webcam evidence and events.
- **Captures while offline:** lost mode grabs webcam photos every ~5 min
  (capped at 3 pending) even with no network; every fix is queued.
- **SIM-change detection** from the cellular radio state (works with data
  off, no restricted permissions) — records `sim_change` events: a thief
  swapping SIMs is a strong lead for the police report.
- **Burst sync:** a `ConnectivityManager` callback fires the moment ANY
  network appears (cafe Wi-Fi, a new SIM's data) and flushes the whole vault
  to the server in **one batch** (`POST /api/devices/:id/batch`). The server
  records a **`reconnected` event** when a fix arrives after a long silence —
  the dashboard shows "reconnected" and the evidence gallery fills with what
  the phone saw while it was "dead".

### 4 · IMEI blacklist (NCC-DMS / CEIR) — the deterrent

**Physics of the market:** phone theft in Nigeria is driven by resale value.
A blacklisted IMEI cannot register on **any** Nigerian network.

**In Nigeria:** the NCC runs a **Central Equipment Identity Register (CEIR) /
Device Management System (DMS)** synchronized across MTN, Airtel, Glo and
9mobile. The owner triggers the block through their **network operator's EIR
desk** with: police report, proof of purchase, and a government ID (NIN /
passport / driver's licence). No consumer self-service portal exists — the
request goes through the operator.

**What TrackNaija does:** the Offline Recovery → **IMEI blacklist request**
kit generates the operator letter plus the required-documents checklist. This
is also why the **Serial Check** page (used-laptop buyers) and the registry
matter: a blacklisted identifier is a trap for the buyer too.

---

## What happens if they flash it (factory reset / firmware reinstall)

This is the scenario the user asked about directly: thief turns the phone
off, flashes it with PC flashing software, or sells it to a phone-repair
engineer who wipes it. **Once the OS is reinstalled, no app survives** — the
agent, the vault, everything on the system partition is gone. That is a hard
wall for ANY consumer software (mSpy, Life360, GPS trackers — all wiped the
same way). What still works:

1. **FRP / Activation Lock brick the resale.** After a flash, Android phones
   with **Factory Reset Protection** and iPhones with **Activation Lock**
   freeze on the setup screen demanding the original Google/iCloud password.
   Without it the phone cannot be activated — it becomes a parts-only
disposal at a fraction of its value. This is why the **Serial Check** and
   IMEI registry pages matter, and why owners must know their Google/iCloud
   credentials are the real lock.
2. **The IMEI survives everything.** Flashing cannot change the hardware
   IMEI. Once blacklisted (channel 4) the flashed phone still cannot
   register on any Nigerian network — the repair engineer's "new" phone is
a brick.
3. **The first SIM insertion is the trap.** The moment the repair engineer
   or a buyer inserts a new SIM and powers on, the network flags the device,
   pins the cell tower, and — because that new SIM is NIN-linked — the
   police can pull the identity behind it. The lawful route: take the phone
   box (shows the IMEI) to the **NPF** station or **SCID**, file the report,
   and have them submit the IMEI to the four operators (MTN, Airtel, Glo,
   9mobile).

**What TrackNaija does:** the Offline Recovery page now includes a
**"After a factory reset"** section with the FRP/Activation-Lock checklist,
and the carrier/blacklist kits already cite the SCID + NIN-linked-SIM path.

---

## How the pieces fit

```
Thief turns data/Wi-Fi OFF
        │
        ├─► [1] Carrier triangulation   ← dashboard kit → NPF → carrier (court order path)
        │        works because the SIM must keep registering
        │
        ├─► [2] Find My offline network ← enabled BEFORE loss (checklist on dashboard)
        │        nearby Androids relay the BLE beacon (their internet)
        │
        ├─► [3] Our agent keeps capturing locally (no network needed)
        │        └─► phone touches ANY network → burst sync → dashboard:
        │             fixes, webcam photos, SIM-change events, "reconnected" alert
        │
        └─► [4] IMEI blacklist via NCC-DMS/CEIR → phone is a brick
                 even if never located, the theft was pointless
```

## Server API (offline additions)

| Endpoint | Purpose |
|---|---|
| `POST /api/devices/:id/batch` | `{items:[{type:"fix"|"evidence"|"event", …}]}` — the vault burst sync (≤100 items) |
| `POST /api/devices/:id/events` | `{event:{type, detail}}` — e.g. `sim_change` |
| `GET /api/devices` / `GET /api/devices/:id` | now include `imei`, `reconnectedAt`, `events[]` |

`storeFix` also moves `lastSeenAt` forward on every fix (fixing a bug where
"last seen" froze after the first report) and emits a `reconnected` event
after any gap > 12 h.

## What is NOT claimed

- No app can locate a phone that is powered off with the battery removed and
  SIM out. Anyone claiming otherwise is selling magic.
- After a full firmware flash (factory reset), no installed app can track
  the device — but FRP/Activation Lock and the IMEI blacklist still make it
  unsellable, and the first NIN-linked SIM insertion can still be traced via
  the police/SCID + carrier channel.
- Real-time triangulation needs the legal channel (court order path) — it is
  not instantaneous.
- iOS: Apple reserves background tracking for Find My; the companion app
  steers users there and reports last-known location when opened.

---

## Server additions (alerts & push)

| Endpoint | Purpose |
|---|---|
| `GET /api/alerts/latest` | recent alerts (`reconnected` / `sim_change`) + unread count |
| `POST /api/alerts/read` | mark one alert (`{id}`) or all (`{all:true}`) read |
| `GET /api/push/vapid-key` | VAPID public key for `PushManager.subscribe` |
| `POST /api/push/subscribe` | persist a browser push subscription |
| `POST /api/push/test` | send a test push to all subscribers |

Alerts are raised automatically when a `reconnected` or `sim_change` event
is stored, and every subscriber's browser receives a payload-less push that
wakes the service worker to fetch and display the fresh alert — so the owner
is notified the moment a stolen phone surfaces online, even with the
dashboard closed. Storage is dual-mode (`server/storage.js`): the JSON file
by default, or Neon Postgres via `DATABASE_URL` with no API changes.
