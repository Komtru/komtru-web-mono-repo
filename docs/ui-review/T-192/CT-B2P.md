# CT-B2P — Item & delivery — Park (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3318 — Create a Trade · Buyer starts
- **Built:** http://localhost:3118/trade/new
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 25,539 of 224,400 (11.38%)
- **Side by side:** `CT-B2P.png` (reference · built · heat map) — **heat map:** `CT-B2P.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **Shot with the Park switch temporarily on and three Parks supplied by hand** (the reference's), because Park delivery is off in the shipped build (`PARK_DELIVERY_ENABLED`) and no route lists Parks. The patch was reverted after the shot.
- The Park chooser, the collection phone and its helper line are the reference's. The "Deliver to my address instead" link is replaced by the Courier radio card. A saved address is still asked for ("Your address on file"), since the platform needs one to create the trade.
