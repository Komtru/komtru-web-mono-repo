# CT-B3 — Trade terms (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3336 — Create a Trade · Buyer starts
- **Built:** http://localhost:3118/trade/new
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 27,159 of 224,400 (12.10%)
- **Side by side:** `CT-B3.png` (reference · built · heat map) — **heat map:** `CT-B3.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **"Buyer can ask for: up to 72 hours"** is worded "More time, with a reason, up to the limit Komtru sets": the 72 hours is Electronics' limit in the reference, and the platform, not this screen, holds the limit.
- Rows are Komtru's own terms and read-only; the "Seller provides" chips and the closing note are the reference's. The "Clock starts" row is not drawn: its wording is Park-specific ("12 hours after the parcel arrives at the Motor Park") and the platform has no such rule for Courier.
