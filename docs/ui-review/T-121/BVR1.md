# BVR1 — Business Verification Rejected (T-121)

- **Reference:** line 5985 — Seller — Mandatory Proof, Counter-Proposal, Post-Acceptance — Mobile Web (new in v2)
- **Built:** http://localhost:3001/shop/verification (the rejected state of the same screen as M2)
- **Code:** `apps/web-app-ui/src/sell/Verification.tsx` (`Rejected`)

**Visual check not run.** `pnpm visual-check` needs a signed-in session and the platform API for this screen. The app has no harness for the gated routes yet, and the backend infrastructure was not available to this run. The list below is the deviation list from reading the reference against the build; the pixel comparison is still to do.

## Deviations

- **Resubmit starts a new application.** The reference's "Resubmit CAC details" goes to the business step. A rejected application is final on the backend, so the step saves a new draft pre-filled with the old answers; documents must be attached again.
- **Contact support reveals the case reference** through the existing `ContactSupport` disclosure, which the account screens use. The application id is the reference.
- **Reviewer's reason shown verbatim** under "Why", as the reviewer wrote it.
- **Trade rows kept** ("Unaffected", "Not available yet", "Anytime, with corrected details").
- **Uses the ui-kit `TermList`/`TermRow`** rather than `.verify-row`.
