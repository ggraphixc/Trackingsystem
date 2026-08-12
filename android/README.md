# Dravex Android Agent

The **phone agent** for Dravex — tracks a phone's location and captures webcam evidence,
mirroring the desktop agent but with **GPS added to the signal ladder** (phones have GPS; laptops
don't).

## What it does

- **Signal ladder:** GPS → Wi-Fi/cell (fused provider) → last-known fix, with confidence + battery
  recorded on every fix
- **Foreground tracking service:** battery-aware polling (5 min idle / 10 min low battery / 20 s
  lost mode), Android 14+ `FOREGROUND_SERVICE_LOCATION` declared
- **Link to dashboard:** same pairing-code flow as the desktop agent (sync server / Appwrite)
- **Remote commands:** loud alarm + **webcam evidence capture** (CameraX) issued from the dashboard
- **Lost mode:** fast polling + webcam armed

## Build it

Requires **Android Studio** (not installed on this machine — this is a source scaffold).

```bash
# Open the android/ folder in Android Studio → Sync → Run on a device/emulator
```

1. Install [Android Studio](https://developer.android.com/studio) (bundles JDK + SDK + Gradle).
2. Open this `android/` folder; let Gradle sync (it downloads AGP 8.7.3, Kotlin 2.0.21, SDK 35).
3. Plug in an Android phone (Tecno/Infinix/Samsung…) with USB debugging, press Run.

## Permissions (manifest)

`ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` · `FOREGROUND_SERVICE` +
`FOREGROUND_SERVICE_LOCATION` · `POST_NOTIFICATIONS` (Android 13+) · `CAMERA` · `INTERNET`.
`ACCESS_BACKGROUND_LOCATION` is declared for future "allow all the time" tracking — request it
judiciously (it's a Play Store-sensitive permission).

## Notes

- `usesCleartextTraffic="true"` lets the agent talk to a local `http://` sync server during
  development — switch to HTTPS in production.
- No stealth features: the service shows a persistent notification and the app is always visible.
- Android "lock screen" requires the deprecated Device Admin API — omitted from the MVP; webcam +
  alarm + location are the evidence core.
- The launcher icon uses an adaptive icon (API 26+ = minSdk), so no PNG mipmaps are needed.

## Building the APK (debug)

Requirements: JDK 17+, Android SDK (platform-35 + build-tools 35.0.0), Gradle 8.9+.

    echo "sdk.dir=C:/path/to/android-sdk" > local.properties
    gradle assembleDebug      # or: ./gradlew assembleDebug

Output: `app/build/outputs/apk/debug/app-debug.apk` (sideloadable debug APK).
A prebuilt copy lives in `dist/Dravex-Agent-0.1.0-debug.apk`.
