# Seller-6 — Payouts (T-124)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 5668 — Seller — Mobile Web
- **Built:** http://localhost:3142/account/payouts
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 17,658 of 224,400 (7.87%)
- **Side by side:** `Seller-6.png` (reference · built · heat map) — **heat map:** `Seller-6.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar; the tab bar is Buy mode's with Account marked (the viewer seam is anonymous), where the reference marks Shop. The shot ran against the real production build and a canned stand-in for the payout routes (one proxy adding a sealed session cookie), so names, references and dates are illustrative. Dates use the app's shared Lagos format (`6 Aug · 14:41`, `whenLabel`) rather than the reference's `Aug 6, 2:41 PM`. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- A **Payout account** row (the default account, opening AB6) and a **Payout schedule** line are added between the balance card and the history: the reference has no way into AB6 or to see the mode, and the platform's summary carries both.
- **Schedule** opens a bottom sheet with the platform's five modes (When I withdraw, After each sale, Daily, Weekly on Monday, Monthly on the 1st) rather than a screen; the reference draws only the button. No time of day is promised: the 09:00 sweep is a backend default, not a stated rule.
- The heading is a page `h1` (19px) in the content, not the reference's `.scr-logo-row` with the profile icon, which the shell's top bar already carries.
- A history row that has not arrived adds its state after the date (`· On its way`, `· Didn’t go through`); a completed one reads as the reference. Withdraw is a disabled button while payouts are paused or the balance is zero, with a pause banner above the card.
