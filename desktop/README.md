# Dravex Desktop Agent (Electron)

The **tracking agent** that installs on laptops/desktops (Windows, macOS, Linux). It:

- Reports its location via the **signal ladder**: Wi-Fi positioning → IP geolocation → last known
- Runs a **lost mode** that fast-locates and arms the webcam the moment the laptop is used
- Captures **webcam evidence photos** (the thief catcher)
- Supports **remote lock screen** and **loud alarm** commands
- Sits in the system tray, optional auto-start after reboot
- Captures the machine's **serial number** — the key that links it to the web dashboard vault

> Phase 1 scaffold: everything runs locally (JSON state in the app data dir). Phase 2 wires
> fixes/evidence to the Appwrite backend so the web dashboard can show them.

## Run

```bash
cd desktop
npm install          # installs Electron (downloads the runtime once)
npm run icon         # generates assets/dravex.png (tray + window icon)
npm start            # launches the agent UI
```

Build an installer (Windows NSIS / macOS DMG / Linux AppImage):

```bash
npm run dist
```

## Verify without launching the UI

```bash
npm run check        # node --check on all main/renderer scripts
npx electron --version
```

## Project layout

```
desktop/
├── package.json            # electron + electron-builder
├── scripts/generate-icon.js# generates the brand icon PNG (no image deps)
├── src/
│   ├── main.js             # window, tray, auto-start, IPC, tracking loop
│   ├── preload.js          # contextBridge API (window.dravex)
│   ├── tracking-engine.js  # signal ladder: Wi-Fi scan → IP geo → last known
│   ├── commands.js         # device info, serial, lock, alarm (per-platform)
│   └── renderer/           # agent dashboard UI (index.html / styles.css / app.js)
└── assets/dravex.png   # generated icon
```

## Notes & privacy

- The webcam only opens in lost mode or when **you** click "Capture webcam" — never silently.
- Auto-start is **opt-in**; the agent never silently installs itself.
- Tracking is restricted to the owner's machine with consent (NDPA 2023). No stealth features.
- `tracking-engine.js` resolves Wi-Fi via a demo mapping in this scaffold; production uses a Wi-Fi
  geolocation DB (e.g. Google Geolocation API) keyed on BSSIDs.
