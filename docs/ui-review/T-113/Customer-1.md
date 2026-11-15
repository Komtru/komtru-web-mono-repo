# Customer-1 — My Trades (T-113)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3961 — Customer (Buyer) — Mobile Web
- **Built:** http://localhost:3001/home
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 11,124 of 224,400 (4.96%)
- **Side by side:** `Customer-1.png` (reference · built · heat map) — **heat map:** `Customer-1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Live app, F-015 (2026-11-15).** Customer-1 is the Trades tab's list (`/trades`, Q1), which the trade module owns. The shot is Home with the same fixtures, the closest screen F-015 builds. The comparison is therefore between Home and a Trades-tab drawing; read it as a check of the list's rows, not of the tab.

- The reference summary “3 active · 342 completed” is not drawn: the list carries no completed count. Intended.
- Home groups the rows (needs attention, active, past) where the reference draws one list. Intended per the rescope.
- The reference's trade rows show a delivery sub-line (“Awaiting shipment”, “Inspection period — 9h left”). Home shows the trade's item and the status line from the shared describe rules. Deviation until the list carries deadlines.
