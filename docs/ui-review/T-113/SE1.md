# SE1 — Search (T-113)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 2780 — Home — Mobile Web · Extends the existing My Trades screen
- **Built:** http://localhost:3001/search?q=iphone%2013
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 7,009 of 224,400 (3.12%)
- **Side by side:** `SE1.png` (reference · built · heat map) — **heat map:** `SE1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Live app, F-015 (2026-11-15).** Shot at `/search?q=iphone 13` with the fixtures. The reference draws a listing search with stock counts.

- Results are the person's own trades, not listings. The rescope drops the listing index (T-057), so there is no product result. Intended.
- The reference's “Recent searches” chips are not drawn: nothing is stored. Intended.
- The reference's ranking footnote (“Ranked by verification status and fulfilment history”) is not drawn: trade results are not ranked by seller. Intended.
