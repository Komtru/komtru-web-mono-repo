# PM-6 — Active trade — the evidence trail (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11301 — Trade execution · Proof media
- **Built:** /trade/<id>/evidence (new route; also linked from Trade Actions)
- **State shot:** inspection, both people, five proof files and a dispatch photo
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 54,739 of 224,400 (24.39%)
- **Side by side:** `PM-6.png` (reference · built · heat map) — **heat map:** `PM-6.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Groups the platform can state.** "Seller's proof" (fixed when the Trade was agreed, with the agreed time), "Added by the seller · dispatch" (the waybill photo, number and time), "Added at delivery" (the delivery records, as rows). The reference's hub scan group and "Your inspection photos" thumbnails are not drawn: no hub-scan or inspection photo exists on the platform. The buyer sees a line saying inspection photos aren't kept with the Trade yet.
- **The trade code** is a line under the header, not in the top bar (`ScreenHeader` has no right-hand slot). Group labels are sentence-case section labels as the rest of the app draws them.
- Before the item ships the platform does not release the files, so the page says how many there are and that they open once shipped.
