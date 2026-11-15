# SE2 — No Results (T-113)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 2808 — Home — Mobile Web · Extends the existing My Trades screen
- **Built:** http://localhost:3001/search?q=drone
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 25,541 of 224,400 (11.38%)
- **Side by side:** `SE2.png` (reference · built · heat map) — **heat map:** `SE2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Live app, F-015 (2026-11-15).** Shot at `/search?q=drone`.

- The heading reads “No trades match "drone"”, where the reference reads “No sellers listing "drone" yet”. The search covers trades only, so the copy says so. Intended.
- The body copy is trades-only and the action is “Propose a Trade”, as in the reference. Intended.
