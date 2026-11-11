# CT-B8 — Delivery (seller) — Courier (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3425 — Create a Trade · Seller completes
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000001/complete
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,962 of 224,400 (10.23%)
- **Side by side:** `CT-B8.png` (reference · built · heat map) — **heat map:** `CT-B8.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **The delivery partner and charge are typed by the seller**, not chosen from a list of partners with preset prices: there is no approved-partner catalogue before funding, and the screen does not invent partners or costs (owner question O3). The charge is stored with the terms and is not part of the platform's funded total (owner question O2).
- **The promise** is a radio per range the category's delivery deadline allows (Electronics: 1–3 and 5–7 days), not all four.
- "Ships from" is an added saved-address choice: the platform needs the seller's address on the terms.
