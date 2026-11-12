# CT-S4 — Review & send to the buyer (T-193)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3562
- **Built:** http://localhost:3118/trade/new
- **State shot:** stage 4, review, buyer's delivery choice waiting
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,057 of 224,400 (10.27%) · content only (shell rows blanked) 3.71%
- **Side by side:** `CT-S4.png` (reference · built · heat map) — **heat map:** `CT-S4.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; `ScreenHeader` stands in for the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) sit above the real tab bar, and the stage rail is drawn under the header. The shot walked the real screen in a browser against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides.

**Real differences (intended, and why)**

- **Delivery reads "Courier · the buyer gives the address" with a Waiting chip**, the reference's "The buyer chooses". The Courier-to and Park rows are not drawn: the seller cannot see the buyer's address and Park is deferred.
- Rows are the platform's terms (seller location, inspection, cancellation, refund); the reference's Electronics-specific rows differ in count, so the list runs longer and scrolls.
- Send to buyer, with Edit, sits in-flow above the tab bar.
