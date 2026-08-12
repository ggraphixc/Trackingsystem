# Data Protection Impact Assessment (DPIA) — Dravex

> **Required by:** NDPA 2023 (high-risk processing: geolocation + biometric-adjacent image data) + GAID.
> **Owner:** DPO · **Review cadence:** annually or on significant feature change.
> This template mirrors NDPC/IAPP DPIA structure. Complete the bracketed items.

## 1. Overview

| Item | Detail |
|---|---|
| Processing | Continuous device location (Wi-Fi/IP) + webcam evidence capture in lost mode |
| Data subjects | Dravex users (device owners); incidentally, persons captured by webcam evidence |
| Volume | [est. users/devices] |
| Tech | Desktop agent (Electron), sync server / Appwrite (PostGIS), web dashboard |

## 2. Necessity & proportionality

- **Purpose:** recover stolen laptops; deter theft; reduce e-waste via recovery.
- **Why needed:** no built-in cross-platform find-my-laptop; registry + evidence are the only
  practical recovery tools for Windows/Linux.
- **Less intrusive alternatives considered:** OS-native find my device (weak/incomplete), purely
  static registry (no live tracking), community-only (no evidence) → **rejected**, insufficient.

## 3. Risk assessment

| Risk | Likelihood | Impact | Mitigations | Residual |
|---|---|---|---|---|
| Stalking via location | Medium | High | Owner-only access; no public location; registry shows area only; consent required; revocation in 1 click; audit log of access | Low |
| Webcam misuse / unlawful capture | Medium | High | Capture only in lost mode / explicit command; visible indicator; encrypted storage; auto-delete after incident close; DPO review of retained evidence; legal basis (vital interest) documented | Low–Med |
| Registry enabling vigilantism | Medium | Medium | Anonymized sightings; moderation; no owner identity or exact location; code of conduct | Low |
| Data breach (location/evidence) | Low | High | TLS, encryption at rest, least privilege, breach response plan, NDPC notification procedure | Low |
| Agent flagged as spyware | Medium | Low | Transparent UI, consent-first, store disclosure, code signing | Low |

## 4. Data minimisation

- Only fields in §2 of the Privacy Policy are collected; no keystrokes/files/browsing.
- Fix history capped (90 days); evidence deleted on incident closure + 30 days.
- Registry shares brand/model/serial + area, never identity.

## 5. Security measures

- Encryption in transit (TLS) & at rest; secrets in secure storage; RBAC; audit logs for access to
  location & evidence; evidence writes are append-only + timestamped.

## 6. Data subject rights

See Privacy Policy §5. Rights are exercisable in-app and via DPO contact. Withdrawal of location
consent stops collection within [24h].

## 7. Transfer assessment

[Where data resides; adequacy/safeguard assessment; document in ROPA.]

## 8. Consultation

- Internal: DPO, engineering, product.
- External: [legal counsel] on webcam evidence admissibility and retention.
- NDPC consultation: [required if high residual risk remains — document outcome].

## 9. Sign-off

| Role | Name | Date |
|---|---|---|
| DPO | [ ] | [ ] |
| Engineering | [ ] | [ ] |
| Product | [ ] | [ ] |
