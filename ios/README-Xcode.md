# Dravex iOS Companion — Build Guide

The iOS companion **complements Apple Find My** (iOS blocks third-party background tracking, so it
reports last-known location on demand and steers users to Find My for live tracking).

Requires **macOS + Xcode** (this repo was scaffolded on Windows — no .xcodeproj can be generated
here, so you create one in Xcode and drop these files in).

## 1. Create the project

1. Open **Xcode → File → New → Project → iOS → App**.
2. Product name: `Dravex` · Interface: **SwiftUI** · Language: **Swift** · Organization:
   `com.dravex` — Bundle ID will be `com.dravex.Dravex`.
3. Save it inside this `ios/` folder (Xcode creates `Dravex.xcodeproj`).
4. Delete the generated `DravexApp.swift` and `ContentView.swift`, then drag these files from
   `ios/Dravex/` into the Xcode project (✓ Add to target `Dravex`):

   | File | Purpose |
   |---|---|
   | `DravexApp.swift` | App entry |
   | `ContentView.swift` | This iPhone / Report lost / Find My tabs |
   | `LocationReporter.swift` | One-shot when-in-use location fix |
   | `SyncClient.swift` | URLSession client for the sync server |
   | `FindMyGuideView.swift` | Find My instructions + police report generator |
   | `Info.plist` | Location + local-network usage descriptions |

5. For `Info.plist`: set **Info → Custom iOS Target Properties** from the provided `Info.plist`
   (or overwrite the generated one with it).

## 2. Sign & run

1. Select your team under **Signing & Capabilities** (personal team works for a device).
2. Plug in an iPhone, select it as the run destination, press **Run**.
3. On first run, grant **location while using the app** and allow **local network** access.

## 3. Link it

1. Start the sync server: `cd server && npm start` (note your machine's LAN IP, e.g.
   `192.168.1.100`).
2. On the web dashboard's **Agents** page, generate a pairing code.
3. In the app's **This iPhone** tab, set the server URL to `http://<your-ip>:4173`, enter the code,
   tap **Link this iPhone**.
4. Tap **Report location now** — the fix appears in the dashboard Agents page.

## 4. Notes & honest limits

- **No background tracking on iOS** — that's Apple's Find My job (see the in-app Find My tab).
- Production: switch `http://` to your HTTPS backend and drop the local-networking ATS exception.
- The serial shown in pairing is the identifier-for-vendor (not a hardware serial — iOS hides
  hardware serials from third-party apps). Pairing is by device, not by hardware serial.
