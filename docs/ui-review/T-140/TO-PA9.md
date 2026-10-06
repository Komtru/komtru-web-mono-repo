# TO-PA9 — Tablet state (T-140)

- **Reference:** `docs/design-reference/Komtru — UI Screens Living Master File.html` line 8295 — TrustOps Console — Park Agents · Desktop + Tablet
- **Built:** http://127.0.0.1:6013/iframe.html?id=shells-consoleshell--tablet-rail&viewMode=story
- **Frame:** desktop, 1040px reference frame; compared at 1040 × 620
- **Differing pixels:** 3,295 of 644,800 (0.51%)
- **Side by side:** `TO-PA9.png` (reference · built · heat map) — **heat map:** `TO-PA9.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

Shot for **T-013** (`ui-kit` layout shells) against Storybook story `Shells/ConsoleShell` →
`TabletRail` (`collapsed`). T-140 owns the screen.

**Shell chrome (T-013)**

- Nothing structural: the 68px rail, the centred glyphs, the hidden labels and the surviving active
  pill all land on the reference. 0.51% flagged, the lowest of the eight.
- The brand mark is 16px, not the unsized one the reference draws — same note as NAV.
- TO-PA9 is drawn in a **desktop** frame while showing the tablet state, which is why `collapsed` is
  a prop rather than only a breakpoint: without it the shell would have to be narrowed to 900px to
  reproduce the drawing, and the reference draws a Collapse control that implies the same prop.

**Content, for whoever builds the screen (T-140)**

- The reference's two stat cards carry no trend line and label the second "Parcels held", not
  "Parcels held now". The story follows the reference.
