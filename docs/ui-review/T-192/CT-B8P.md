# CT-B8P — Delivery (seller) — Park (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3440 — Create a Trade · Seller completes
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000002/complete
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 24,731 of 224,400 (11.02%)
- **Side by side:** `CT-B8P.png` (reference · built · heat map) — **heat map:** `CT-B8P.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **No Park card detail line.** The Park's name comes from the buyer's request; its opening hours are not on the terms, so only "The buyer chose to collect at a Park: <name>." is drawn.
- Charge, promise and the "Ships from" address are as CT-B8. Promise ranges are radio cards, not chips.
