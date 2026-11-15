# SC2 — Seller Couldn't Fulfill (T-119)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4424 — Cancel After Funding — Mobile Web
- **Built:** http://localhost:3132/trade/0190b0a0-0000-7000-8000-000000000308
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 19,366 of 224,400 (8.63%)
- **Side by side:** `SC2.png` (reference · built · heat map) — **heat map:** `SC2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts and dates are illustrative. Every amount on the built screen is the stand-in's refund row or trade snapshot, rendered as sent.

**Real differences (intended, and why)**

- **The stage line follows the refund row, not the status.** The reference says "Your ₦89,500 has already been refunded in full" and "Refund already sent". Built: "{amount} was sent back to your original payment method" only when the refund is `PROCESSED`; "is being sent back" while it is `REQUESTED` or `PROCESSING`; the platform's reason and the reference for `FAILED` or `NEEDS_REVIEW`. The amount is the refund row's `amountMinor`, not the trade price.
- **No arrival time** ("Usually arrives within 2 hours, always within 24"): not a platform promise.
- "Find another seller" is "Start a new trade": the catalogue is cut from the MVP, and `/trade/new` is where a buyer starts one.
- The reason is the seller's own code ("Reason given: out of stock.").
- The seller's view of the same state reads "You cancelled this trade" with the refund's state and reference, and no amounts or fee lines.
