# CT-B2 — Item & delivery — Courier (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3300 — Create a Trade · Buyer starts
- **Built:** http://localhost:3118/trade/new
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 26,353 of 224,400 (11.74%)
- **Side by side:** `CT-B2.png` (reference · built · heat map) — **heat map:** `CT-B2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **The item rows are the category's own required fields** (Brand, Model, Condition for the seeded Electronics standard) rather than the reference's fixed "Colour & storage, Serial / IMEI, Condition". Each reads "Seller provides".
- **Delivery mode** is two radio cards (Courier, Park), and Park reads "Coming soon" and is disabled: Park needs the hub network, which is deferred for MVP. The reference's "Collect at a Park instead" text link is therefore not drawn; CT-B2P is the Park state, shot with the Park switch on.
- Courier delivery is a choice among the buyer's saved addresses (with Add a new address) rather than City, Phone, Address and Landmark fields in this screen: the platform takes a saved address (T-115).
