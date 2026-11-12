# CT-S1 — Create Trade — About (T-193)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3495
- **Built:** http://localhost:3118/trade/new
- **State shot:** stage 1, buyer found, item and price typed
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 24,669 of 224,400 (10.99%) · content only (shell rows blanked) 4.42%
- **Side by side:** `CT-S1.png` (reference · built · heat map) — **heat map:** `CT-S1.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; `ScreenHeader` stands in for the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) sit above the real tab bar, and the stage rail is drawn under the header. The shot walked the real screen in a browser against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides.

**Real differences (intended, and why)**

- **Buyer field takes a handle, email or phone** (the platform looks a person up by any of the three); the reference shows a phone. The found strip reads "Profile found · 24 completed trades"; "Identity verified" is not something the lookup reports, so it is not drawn.
- **"Delivery address on file" is not drawn.** No route exposes the buyer's address to the seller; the buyer gives it at CT-S6 (owner question O2).
- **Listing picker replaced by typed item name and price** (O1): no listings exist yet. A line under the price shows what the seller receives.
