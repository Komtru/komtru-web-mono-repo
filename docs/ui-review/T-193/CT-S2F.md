# CT-S2F — Item details — Fashion & Luxury (T-193)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3530
- **Built:** http://localhost:3118/trade/new
- **State shot:** stage 2, Fashion & Luxury
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,358 of 224,400 (10.41%) · content only (shell rows blanked) 3.95%
- **Side by side:** `CT-S2F.png` (reference · built · heat map) — **heat map:** `CT-S2F.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; `ScreenHeader` stands in for the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) sit above the real tab bar, and the stage rail is drawn under the header. The shot walked the real screen in a browser against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides.

**Real differences (intended, and why)**

- **A different category loads its own specification**, as the reference says. The note reads "replaces the other category's fields" (the reference names Electronics).
- Field set (brand, optional size, condition, proof) is the platform's Fashion & Luxury specification; the reference's item type, size pills and fabric pills are illustrative. Heat is mostly field labels that reflow.
