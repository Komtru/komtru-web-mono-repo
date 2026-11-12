# CT-S3 — Trade terms (seller) (T-193)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3547
- **Built:** http://localhost:3118/trade/new
- **State shot:** stage 3, Courier
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 26,276 of 224,400 (11.71%) · content only (shell rows blanked) 4.94%
- **Side by side:** `CT-S3.png` (reference · built · heat map) — **heat map:** `CT-S3.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; `ScreenHeader` stands in for the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) sit above the real tab bar, and the stage rail is drawn under the header. The shot walked the real screen in a browser against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides.

**Real differences (intended, and why)**

- **Park is drawn "Coming soon", not selectable** (Park delivery is deferred for MVP, O5). The reference's Park charge field is therefore not shown.
- **Delivery partner and charge are typed by the seller** (O4): no approved-partner catalogue exists, so the reference's calculated partner cards (SwiftDrop, GIG) are not drawn. The charge is a separate line, not part of the funded total (O3).
- The delivery promise is chosen from the platform's promises; protection terms are shown, not editable, as the reference says.
