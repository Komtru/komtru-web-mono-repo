# CT-S7 — Review & accept (buyer) (T-193)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3618
- **Built:** http://localhost:3118/trade/<id>
- **State shot:** buyer reviews and accepts
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 21,933 of 224,400 (9.77%) · content only (shell rows blanked) 3.99%
- **Side by side:** `CT-S7.png` (reference · built · heat map) — **heat map:** `CT-S7.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; `ScreenHeader` stands in for the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) sit above the real tab bar, and the stage rail is drawn under the header. The shot walked the real screen in a browser against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides.

**Real differences (intended, and why)**

- **Delivery reads "Courier · Lekki Phase 1, …"** because Park is deferred; the reference's Park rows (collection phone, inspection clock starting at the Motor Park) are not drawn as the platform has no such rule for Courier.
- The item-details row is the seller's confirmed details; the item card title is brand and model. Delivery cost, promise, inspection, cancellation and refund come from the agreed version.
- **"Ask a question" is replaced by "Change delivery"** and a decline link, as messaging is not built (F-045). Accept & continue to payment is in-flow above the tab bar.
