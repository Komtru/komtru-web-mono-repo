# PM-4 — Proof of the item — ready (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11264 — Trade execution · Proof media
- **Built:** http://localhost:3130/dev-proof/pm4
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 26,190 of 224,400 (11.67%)
- **Side by side:** `PM-4.png` (reference · built · heat map) — **heat map:** `PM-4.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Prose.** The reference says "all taken on your camera"; a file chosen from the gallery is not known to be taken on the camera, so the built line is "added from this device".
- **Continue** is not drawn: the screens that mount the proof step have their own Continue/Send. The "What happens next" timeline is the ui-kit `VersionTimeline` with the reference's three steps, reworded to what the platform does: "The buyer is given access with the offer", "You can change it until you send", "It's kept with the Trade once it's agreed". The reference's "locked when the Trade is agreed" and "change it until they accept" are rules the app does not enforce, so they are not stated. Drawn when sending a proposal, left out when accepting.
- Remove controls on the tiles are not in the reference.
