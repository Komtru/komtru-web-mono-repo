# WF1 — Withdrawal Failed (T-124)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 6369 — Seller Payouts — Mobile Web
- **Built:** http://localhost:3142/account/payouts/0190b0a0-0000-7000-8000-000000000013
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 32,230 of 224,400 (14.36%)
- **Side by side:** `WF1.png` (reference · built · heat map) — **heat map:** `WF1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar; the tab bar is Buy mode's with Account marked (the viewer seam is anonymous), where the reference marks Shop. The shot ran against the real production build and a canned stand-in for the payout routes (one proxy adding a sealed session cookie), so names, references and dates are illustrative. Dates use the app's shared Lagos format (`6 Aug · 14:41`, `whenLabel`) rather than the reference's `Aug 6, 2:41 PM`. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- The screen keeps the shell's back header ("Payout"), which the reference omits; it is the payout's own page (`/account/payouts/<id>`), reached after a withdrawal or from the history, not a state of the withdraw route.
- The hero copy says the amount "is back in your available balance" (the platform has already returned it, fee included), not "still sitting safely": a failed payout did leave the balance first.
- The bank row's line is the platform's `failureReason`, falling back to "Your bank didn’t accept this payout."
- A support line quoting the payout reference is added above the actions, as AB4 does for a payment. A payout reversed after it was sent is titled "This payout came back".
