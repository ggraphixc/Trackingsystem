# TrackNaija — Phase 0 Compliance Checklist (NDPA 2023 / NDPC)

Checklist for going to market legally in Nigeria. Track status as you complete each item.

## A. Corporate & registration

- [ ] Register company with CAC (or confirm existing entity)
- [ ] Register as **Data Controller** with the NDPC (ndpc.gov.ng portal)
- [ ] Appoint a **Data Protection Officer (DPO)** — internal or outsourced (NDPC-registered DPCO can provide)
- [ ] Appoint/verify a licensed **Data Protection Compliance Organisation (DPCO)** for audit returns
- [ ] Set up **Consent Management** tooling per CONSENT_FLOW.md

## B. Documents (see this folder)

- [ ] **Privacy Policy** drafted (PRIVACY_POLICY.md) — reviewed by counsel
- [ ] **Terms of Service**
- [ ] **DPIA** completed & signed (DPIA.md)
- [ ] **Record of Processing Activities (ROPA)** — include all processing, bases, retention
- [ ] Data processing agreements with all vendors (Appwrite, maps, push, payments)
- [ ] **Breach response plan** (internal doc) + NDPC notification template

## C. Engineering

- [ ] Consent records stored with version + timestamp (see CONSENT_FLOW.md §5)
- [ ] Revocation paths live in agent AND dashboard (location/webcam/autostart/delete-all)
- [ ] Encryption in transit (TLS) + at rest; secrets in secure storage, not in code
- [ ] Evidence retention policy implemented (delete on incident close + 30 days)
- [ ] Audit log for access to location & evidence data
- [ ] No stealth behavior; visible agent indicators; store disclosure text ready
- [ ] Data export (portability) + erase (right to be forgotten) endpoints

## D. Stores & platforms

- [ ] Windows store / direct download: code signing certificate
- [ ] Web: cookie banner / consent where applicable
- [ ] Privacy policy + consent summary in every store listing

## E. Ongoing

- [ ] Annual **Compliance Audit Return (CAR)** via DPCO
- [ ] Annual DPIA re-review; re-consent on material policy changes
- [ ] DPO contact published; subject requests answered ≤ 30 days

---

**Legend:** `[ ]` = todo · `[x]` = done · `[~]` = in progress
**Next owner:** [name] · **Target date:** [date]
