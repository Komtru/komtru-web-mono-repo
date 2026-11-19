# CWT-05 — Workspace — Disputed (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10731 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3916/trade/0190b0a0-0000-7000-8000-000000000504
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 20,529 of 224,400 (9.15%)
- **Side by side:** `CWT-05.png` (reference · built · heat map) — **heat map:** `CWT-05.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell.** The shot is the built page cropped to `main`, so the app header is out of frame. The bottom tab bar is the app's own shell, which the reference frame does not draw; it shows the buyer tabs (Home, Trades, Messages, Discover, Account).

**Data.** The stand-in's fixtures are illustrative. The built page shows the fixture trade KMT-88244-NG (JBL Flip 6 · Tunde Bello, ₦98,000) and case DIS-088244. The drawing shows KMT-90428-NG, iPhone 13 · 128GB · TechEdge NG, ₦195,000 and DIS-88213. Differences in those values are expected.

**Differences**

- **Tabs.** The built page has a tab strip (Overview, Terms, Activity, Actions) under the card. The drawing has none on this frame.
- **Banner.** The heading matches ("Issue reported — funds remain protected"). The body differs: the built page says "The issue is now a case. The payment stays held until it is decided against the agreed terms."; the drawing says "The item issue is now a case. Submit evidence through the case so it can be reviewed against the agreed terms."
- **Countdown.** The drawing's "Evidence response due in 17h 05m" strip is not in the built frame.
- **Case rows.** "Case", "Issue" ("Not as described") and "Stage" ("Evidence requested") match. The drawing's "Exposure" row is not in the built frame.
- **Money rows are added** ("You paid ₦102,900", "Seller payout: held while the case is open"). The drawing has no money block in this state. This was an intended choice in an earlier run, kept: the person most wants to know these.
- **Actions.** The drawing puts "Submit evidence" and "Open dispute status" at the foot of the frame. The built actions start below the 660px frame, and a dark button is cut off at the bottom edge.
