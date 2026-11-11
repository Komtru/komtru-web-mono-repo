# AB5 — Withdraw Funds (T-124)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 6319 — Seller Payouts — Mobile Web
- **Built:** http://localhost:3142/account/payouts/withdraw
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 31,770 of 224,400 (14.16%)
- **Side by side:** `AB5.png` (reference · built · heat map) — **heat map:** `AB5.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` under Account (shot with `--content main`), so the reference's own top bar and sticky footer are replaced by `ScreenHeader` and in-flow actions above the real tab bar; the tab bar is Buy mode's with Account marked (the viewer seam is anonymous), where the reference marks Shop. The shot ran against the real production build and a canned stand-in for the payout routes (one proxy adding a sealed session cookie), so names, references and dates are illustrative. Dates use the app's shared Lagos format (`6 Aug · 14:41`, `whenLabel`) rather than the reference's `Aug 6, 2:41 PM`. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- The amount is a real input (mono 38px, centred) instead of drawn text; the quick amounts are the reference's ₦50,000 and ₦200,000, offered only below the balance, plus All.
- The info banner does not say "usually arrives within 2 hours, always within 24 — no fee": neither is a platform rule. It states the platform's own `payoutFeeMinor` ("No payout fee is charged" while it is zero, the fee otherwise) and that the receipt follows the money. The banner is therefore taller.
- The account sub-line is the name the bank resolved (`accountName`), not a trading name. With more than one verified account the rows become radios, the payout account first.
- The Withdraw button sits in the flow, not pinned above the tab bar.
- Not a deviation, checked: the amount starts at the whole available balance with **All** pressed, because the reference draws exactly that (`1,200,000`, `All` selected, `Withdraw ₦1,200,000`).
