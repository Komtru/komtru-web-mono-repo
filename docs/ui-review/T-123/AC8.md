# AC8 — Active Orders (T-123)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 6125 — Active Orders — Mobile Web
- **Built:** http://localhost:3126/orders
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 9,233 of 224,400 (4.11%)
- **Side by side:** `AC8.png` (reference · built · heat map) — **heat map:** `AC8.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of every heat map. The shot ran against the real production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so the data is illustrative: trade codes, names, amounts and dates differ from the drawing for that reason only. The shell is drawn for the anonymous viewer (Buy mode) because the viewer seam (`resolveViewer`) is not filled yet.

**Real differences (intended, and why)**

- **Row layout** reuses `TradeRow` (amount first, status chip, buyer, then item and trade code); the reference puts the item title first with the amount on the right and no chip. The chip carries the platform's own status wording ("Ship it", "In transit", "Inspection active").
- **Sub-line** is "item · trade code"; the reference's "At park hub" and "6h remaining" are not drawn: no Park, and no per-row deadline on the list.
- **Tab bar** is Buy mode's with Trades marked, because the viewer seam is anonymous (above); in Sell mode it would be the reference's Shop · Orders · Listings tabs.
- A trade to ship opens the ship screen; every other row opens the trade.
- Count badges are plain numbers beside the heading rather than pills.
