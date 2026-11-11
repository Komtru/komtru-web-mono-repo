# PR1 — Payout Receipt (T-124)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 6398 — Seller Payouts — Mobile Web
- **Built:** http://localhost:3142/account/payouts/0190b0a0-0000-7000-8000-000000000011
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 8,558 of 224,400 (3.81%)
- **Side by side:** `PR1.png` (reference · built · heat map) — **heat map:** `PR1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar; the tab bar is Buy mode's with Account marked (the viewer seam is anonymous), where the reference marks Shop. The shot ran against the real production build and a canned stand-in for the payout routes (one proxy adding a sealed session cookie), so names, references and dates are illustrative. Dates use the app's shared Lagos format (`6 Aug · 14:41`, `whenLabel`) rather than the reference's `Aug 6, 2:41 PM`. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- The hero is what the bank was sent (`transferAmountMinor`); the details add Name, From your balance (`amountMinor`) and Payout fee (`feeMinor`), all the payout's own frozen figures, so the rows below the hero shift down.
- The reference's receipt icon above the amount and the print icon in the header are not drawn.
- The reference is the platform's `payout-<id>` (what the bank statement and support know it by), not a `TXN-` code, and wraps in mono.
- **From trade** appears only for an automatic payout (`sourceTradeId`), read from the trade itself; a manual withdrawal, as shot here, has none.
- **Download receipt (PDF)** is not built: no platform route produces one (owner question in the T-124 notes).
- While the payout is on its way the same page shows `On its way` and says it updates (it polls); `NEEDS_REVIEW` shows `Being checked` with a note, never completed or failed.
