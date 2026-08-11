# TrackNaija Consent Flow (Design Spec)

Goal: **explicit, granular, freely given, revocable** consent (NDPA §24 + GAID) with UI copy ready
to paste into both apps. Consent is never bundled with "accept all" dark patterns.

## 1. Principles

1. **Granular** — location, webcam, auto-start, and marketing are separate toggles.
2. **Before first collection** — nothing is collected until the user opts in.
3. **Visible state** — the agent always shows its state (tray icon, status chip, lost-mode banner).
4. **Revocable anywhere** — every consent can be withdrawn in-app, on the web, or by deleting the
   account; withdrawal is logged (timestamp, channel).
5. **Evidence trail** — consent events (who, what, when, version of policy) stored for audits.

## 2. Agent (Electron) — first-run onboarding

**Screen 1 — What TrackNaija does** (title, short bullets, "Continue")
> TrackNaija protects your laptop if it's lost or stolen. It never runs hidden. You stay in control.

**Screen 2 — Location consent** (radio: Yes / Not now) + checkbox for details
> "Allow TrackNaija to see this device's location using Wi-Fi and IP signals? This powers
> find-my-laptop. You can stop this any time in the agent."
> [ ] "I understand location is sent to the TrackNaija dashboard when this device is linked."

**Screen 3 — Webcam consent** (radio: Yes, in lost mode only / Yes, allow manual captures too / No)
> "TrackNaija may open the webcam to capture evidence if the device is reported lost, or when you
> tap 'Capture webcam'. A visible indicator shows whenever the camera is active."

**Screen 4 — Auto-start** (checkbox, default off)
> "Start TrackNaija when this computer starts, so protection re-arms after a reboot? You can change
> this later in Settings."

**Screen 5 — Confirm** (summary of choices + "I agree" button → stores consent record)
> Each choice stored as: `{ machineId, consentType, granted: bool, grantedAt, policyVersion }`.

## 3. Dashboard (web) — sign-up consent

Inline checkboxes (no pre-checked boxes):
- [ ] "I consent to TrackNaija processing my device registry and incident data to provide the
      service (required)."
- [ ] "I consent to location processing for linked devices (required for tracking features;
      revocable)."
- [ ] "I consent to my reported-stolen device's brand/model/serial appearing in the public
      registry (recommended — this is how recoveries happen)." — optional, checked off.
- [ ] "I agree to the Privacy Policy and Terms."

## 4. Withdrawal

| Where | How |
|---|---|
| Agent | Settings → "Stop sharing location" / "Disable webcam" / "Unlink dashboard" |
| Web | Account settings → consent panel with toggles + "Delete all data" |
| Post-withdrawal | Cease processing within 30 days; delete non-obligatory data; keep only what law requires |

## 5. Consent records (build requirement)

- Table: `consents (id, userId, deviceId, type, granted, policyVersion, grantedAt, revokedAt)`.
- Consent version = git tag of the policy at acceptance; policy changes require re-consent.
- Exportable for audit / NDPC inspection.
