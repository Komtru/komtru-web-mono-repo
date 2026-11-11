# AB6 — Payout Bank Account (T-124)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 6348 — Seller Payouts — Mobile Web
- **Built:** http://localhost:3142/account/payouts/bank
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 31,893 of 224,400 (14.21%)
- **Side by side:** `AB6.png` (reference · built · heat map) — **heat map:** `AB6.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar; the tab bar is Buy mode's with Account marked (the viewer seam is anonymous), where the reference marks Shop. The shot ran against the real production build and a canned stand-in for the payout routes (one proxy adding a sealed session cookie), so names, references and dates are illustrative. Dates use the app's shared Lagos format (`6 Aug · 14:41`, `whenLabel`) rather than the reference's `Aug 6, 2:41 PM`. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- The reference draws only a filled form with a matched name. The built screen lists the seller's accounts first (payout account, verified, being checked, or not verified with the bank's reason, each removable; a verified one can be made the payout account), then the add form (Bank select from the platform's bank list, ten-digit account number).
- The name is never typed and is not shown in the form: the platform resolves it with the bank after the account is saved (202, `PENDING_VERIFICATION`, the list polls until verified or failed), so it appears on the account row, not under the field.
- The reference's "auto-matched with your business registration" and "can only be changed to an account matching your verified business name" are not claimed: T-073 accepts the bank's resolution and refuses only a T-051 mismatch on record (backend owner decision 3). The note says what is true: the name comes from the bank and money only goes to a confirmed account.
- With a chip on the row the account title wraps at 340px.
