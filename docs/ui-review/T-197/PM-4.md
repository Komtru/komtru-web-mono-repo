# PM-4 — Proof of the item — ready (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11264 — Trade execution · Proof media
- **Built:** /dev-proof/pm4 (harness)
- **State shot:** requirements met: 4 photos and 1 video
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 25,917 of 224,400 (11.55%)
- **Side by side:** `PM-4.png` (reference · built · heat map) — **heat map:** `PM-4.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Prose.** The reference says "all taken on your camera"; a file chosen from the gallery is not known to be taken on the camera, so the built line is "added from this device".
- **Continue** is not drawn: the screens that mount the proof step have their own Continue/Send. The timeline ("What happens next") is the ui-kit `VersionTimeline`, with the reference's three steps and copy; it is drawn for sending a proposal and left out when the seller is accepting.
- Remove controls on the tiles are not in the reference.
