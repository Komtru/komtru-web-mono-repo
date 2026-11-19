# BVR1 — Business Verification Rejected (T-121)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 5985 — Seller — Mandatory Proof, Counter-Proposal, Post-Acceptance — Mobile Web
- **Built:** http://localhost:3916/account/verification/merchant
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 31,836 of 224,400 (14.19%)
- **Side by side:** `BVR1.png` (reference · built · heat map) — **heat map:** `BVR1.diff.png`

## Deviations

- **Reference wording overridden: "Trade as an individual seller — Unaffected".** Owner correction (2026-11-19): the account is a seller either way, and a rejected business stays a default seller, capped on what it can transact until it is a merchant. The row reads "Selling as a default seller — Limited until you are a merchant".
- **Resubmit starts a new application.** The reference's "Resubmit CAC details" goes to the business step. A rejected application is final on the backend, so the step saves a new draft pre-filled with the old answers; documents must be attached again.
- **Contact support reveals the case reference** through the existing `ContactSupport` disclosure, which the account screens use. The application id is the reference.
- **Reviewer's reason shown verbatim** under "Why", as the reviewer wrote it.
- **"Verified Merchant" badge row kept** ("Not available yet") and "Resubmit" ("Anytime, with corrected details").
- **Uses the ui-kit `TermList`/`TermRow`** rather than `.verify-row`.
- **Back goes to the account's Verification section.**

**Stand-in run, 2026-11-19 (application rejected, seller persona).**

- **"Why" copy comes from the stand-in's fixture**, which names a business-name mismatch. The drawing's reason names a CAC number that matches no registration. The difference is in the fixture's text, not the layout.
- **Actions** ("Resubmit CAC details", "Contact support") sit directly under the list in the built page; the drawing pins them to the foot of the frame.
- **Shell.** The bottom tab bar shows the buyer tabs, as on M2.

**Code:** `apps/web-app-ui/src/sell/Verification.tsx` (`Rejected`).
