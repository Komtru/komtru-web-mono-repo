# PM-1 — Proof of the item — add media (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11211 — Trade execution · Proof media
- **Built:** /dev-proof/pm1 (a throwaway harness page that mounts `ProofCapture`; PM-1 is a step inside the send and accept flows, not a route, because the platform attaches proof only when the trade is sent, accepted or countered)
- **State shot:** proof step of a seller's proposal, 2 of 3 photos added
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 21,438 of 224,400 (9.55%)
- **Side by side:** `PM-1.png` (reference · built · heat map) — **heat map:** `PM-1.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **The gate banner stays.** "Proof of the item needed / Attach 2 more before you can send this proposal." is drawn between the info banner and "What's required"; the reference has no such banner. It was the existing locked banner of `ProofUpload`, kept because the screens that mount it and their tests rely on it.
- **Slots.** The reference draws five tiles (3 photos and 1 video, the video slot labelled "Video"); the built grid draws one empty slot per outstanding file and does not label the video slot. Photos added show a remove control, which the reference does not draw.
- **Buttons are in flow** (above the tab bar), not a pinned footer. Where the browser has no camera API the first button is the device's own camera picker (a labelled file input with `capture`).
