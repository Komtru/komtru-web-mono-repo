# CT-B9 — Confirm & send to the buyer (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3457 — Create a Trade · Seller completes
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000001/complete
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,546 of 224,400 (10.49%)
- **Side by side:** `CT-B9.png` (reference · built · heat map) — **heat map:** `CT-B9.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **The reference draws a Park request**; the shot is a Courier one (see CT-B4). "Seller" reads "You" on the seller's own review. "IMEI on file" is not claimed.
- Figures are the platform's preview for the category and price; the delivery charge is shown as its own line and a note says it is not part of the total (owner question O2). The reference adds it into the total.
