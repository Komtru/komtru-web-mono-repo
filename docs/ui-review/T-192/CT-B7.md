# CT-B7 — Item details (seller) (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3410 — Create a Trade · Seller completes
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000001/complete
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 20,244 of 224,400 (9.02%)
- **Side by side:** `CT-B7.png` (reference · built · heat map) — **heat map:** `CT-B7.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **Fields are the category's own** (Brand, Model, Serial / IMEI optional, Condition), stacked, instead of the reference's two-up Brand/Model and Storage/Colour. Condition is three radio cards, not chips. The reference's Storage and Colour are not separate fields in the seeded standard.
- **"Verify this IMEI" is not drawn**: IMEI verification is deferred (F-020).
- Photos use the existing proof uploader, with the category's own minimum photos and video requirement.
