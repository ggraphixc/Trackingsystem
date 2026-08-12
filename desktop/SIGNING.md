# Signing the TrackNaija Windows installer

The installer builds **unsigned** by default. Windows will show a
"Unknown publisher" / SmartScreen warning until it is signed with a trusted
code-signing certificate.

## Why signing matters

- Removes the "Unknown publisher" warning and the red SmartScreen block
  (`Windows protected your PC`) for most users.
- Lets you set a `publisherName` so the installer shows your real name.
- A self-signed certificate does **not** help — Windows only trusts
  certificates chained to a public CA (or one you distribute to every user's
  Trusted Root store, which is impractical).

## Get a certificate

Buy an **OV (Organization Validation) code-signing certificate** from a CA —
DigiCert, Sectigo, SSL.com, GlobalSign (≈$200–400/year). It ships as a
`.pfx`/`.p12` file with a password.

## Sign during build (electron-builder)

electron-builder signs automatically when these env vars are set:

```bash
export CSC_LINK=/path/to/your-certificate.pfx
export CSC_KEY_PASSWORD="your-pfx-password"
npm run dist
```

That's it — electron-builder signs the exe, the NSIS installer and the
elevation helper with signtool automatically.

### Verify a signed build

```bash
# From a Windows SDK prompt
signtool verify /pa /v "dist/TrackNaija Agent Setup 0.2.0.exe"
```

## Alternative: sign the built exe afterwards

If you prefer to sign outside electron-builder:

```bash
# From a Windows SDK prompt (adjust arch)
signtool sign /f certificate.pfx /p YOUR_PASSWORD /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "dist/TrackNaija Agent Setup 0.2.0.exe"
```

## Current status

- App icon: `build/icon.png` (512×512) — electron-builder converts it to
  `.ico`/`.icns` automatically at build time. Regenerate with
  `npm run icon` (also writes the 64px tray icon to `assets/`).
- Signing: **not configured** — no certificate is present on the build
  machine. Set `CSC_LINK`/`CSC_KEY_PASSWORD` and rebuild to sign.
