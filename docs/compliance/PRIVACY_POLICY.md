# TrackNaija Privacy Policy (Draft)

> **Status:** Draft for legal review · **Law:** Nigeria Data Protection Act 2023 (NDPA 2023) + NDPC General Application and Implementation Directive (GAID)
> This is a starting point for counsel — not a substitute for legal advice.

## 1. Who we are (data controller)

TrackNaija ("we", "us") is the data controller for the TrackNaija platform, which comprises a
desktop agent (Windows/macOS/Linux), a web dashboard, and a sync service.

- Contact / DPO: [DPO email + address to be inserted]
- NDPC registration number: [to be inserted after registration]

## 2. What we process and why

| Data category | Examples | Lawful basis (NDPA §24) | Retention |
|---|---|---|---|
| Account & identity | Name, phone, email | Contract / consent | Until account deletion |
| Device registry | Brand, model, **serial number** | Contract (vault purpose) | Until device removed |
| Location data | Wi-Fi-derived coordinates, IP-based geo, timestamps | **Explicit consent** (high-risk) | Rolling 90 days unless incident active |
| Webcam evidence | Photos captured in lost mode | Explicit consent; vital interest in theft recovery | Until incident closed + 30 days |
| Evidence metadata | Capture time, device, event logs | Consent / legitimate interest (security) | Per above |
| Usage analytics (if added) | Anonymous event counts | Legitimate interest | Anonymized |

**We never process:** contents of files, browsing history, keystrokes, or any data unrelated to
device protection. There are **no stealth features** — the agent is visible to the device owner at
all times (tray icon, window, status).

## 3. How the agent behaves

- The agent tracks **only machines the owner has installed it on and explicitly linked**.
- Location polling runs while the agent is running; the owner can stop it any time.
- The webcam opens **only** (a) in lost mode, (b) on a manual "Capture webcam" click, or (c) on a
  dashboard command the owner initiates. A visible capture indicator is shown.
- Auto-start after reboot is **opt-in** and can be revoked in the agent UI.
- Remote commands (lock, alarm, webcam) require the machine to be linked to the owner's account.

## 4. Sharing

We do not sell personal data. We share:

- **Stolen-device registry (public):** brand/model/serial of reported-stolen devices, plus a
  general location area — **never** the owner's identity or precise live location.
- **Law enforcement:** on lawful request (police report, court order), we may share evidence and
  device data relevant to a reported theft.
- **Service providers:** hosting (e.g. Appwrite Cloud), push, and payment processors, under data
  processing agreements, Nigeria-resident where available.

## 5. Data subject rights (NDPA §34–39)

Every user may: access, rectify, erase ("right to be forgotten"), restrict/object to processing,
and data portability. Contact [DPO]. We respond within the statutory period (30 days, extendable).

## 6. Security

- Encryption in transit (TLS) and at rest (database encryption; evidence stored encrypted).
- Least-privilege access; role separation for admin vs user data.
- Breach notification to NDPC and affected users per NDPA §40 and NDPC incident guidelines.

## 7. International transfers

If data is stored outside Nigeria, we rely on adequacy or appropriate safeguards (SCCs / NDPC
guidance) and document transfers in our ROPA.

## 8. Minors

The service is for adults (18+). We do not knowingly collect data from minors.

## 9. Contact & complaints

- Email: [privacy@…] · DPO: [dpo@…]
- Complaints to the **Nigeria Data Protection Commission (NDPC)** — ndpc.gov.ng

---

*Attach as appendix: lawful basis assessment, processing records (ROPA extract), and the DPIA summary (see DPIA.md).*
