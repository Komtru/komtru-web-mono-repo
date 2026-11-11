# CT-B5 — Sent — waiting for the seller (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3369 — Create a Trade · Buyer starts
- **Built:** http://localhost:3118/trade/new
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 16,948 of 224,400 (7.55%)
- **Side by side:** `CT-B5.png` (reference · built · heat map) — **heat map:** `CT-B5.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **The Trade Code** is the platform's own (`KMT-9043100-NG`); the reference's is a shorter placeholder. Copy copies the code and Share opens the platform link (or copies it).
- The "What happens next" card is the kit's timeline; its first line reads "Seller, item, price and where it goes" (the reference's "Park and phone" assumes Park).
