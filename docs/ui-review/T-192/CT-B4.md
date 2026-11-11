# CT-B4 — Review & send (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3351 — Create a Trade · Buyer starts
- **Built:** http://localhost:3118/trade/new
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,197 of 224,400 (10.34%)
- **Side by side:** `CT-B4.png` (reference · built · heat map) — **heat map:** `CT-B4.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **The reference draws a Park request** ("Park · Jos Central Park", "Collection phone"); the shot is a Courier request, so the Delivery row reads "Courier · address" and there is no phone row. The "Inspection clock" row is not drawn (see CT-B3).
- **"Seller location" is not drawn**: the buyer's request has no seller address until the seller completes it.
- The fee lines are the platform's preview (item price, Buyer Protection Fee, total due on funding); the reference's "(1.5%)" is not repeated, because the rate is the fee schedule's. The reference's "Delivery: Seller to add" and "Total: To be confirmed" are said once, in a line under the figures; the total shown is the platform's, which does not yet include delivery.
