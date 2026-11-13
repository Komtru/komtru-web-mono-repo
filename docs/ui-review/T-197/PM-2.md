# PM-2 — Camera — guided shots (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11229 — Trade execution · Proof media
- **Built:** /dev-proof/pm2 (harness; `getUserMedia` stubbed with a canvas stream, since headless Chromium has no camera)
- **State shot:** guided camera, 3 of 4 shots, live stand-in stream
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 25,669 of 224,400 (11.44%)
- **Side by side:** `PM-2.png` (reference · built · heat map) — **heat map:** `PM-2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **A bottom sheet, not a full screen.** The camera is the ui-kit `Sheet` (focus trap, Escape, scrim) rather than a full-screen page with a back button; the count "3 of 4" sits under the title, not in the top bar. It is drawn on the page body, after the tab bar, because the sheet and the tab bar share a stacking level and the later one wins.
- **Viewfinder** is the live stream (flat midnight when stubbed) with the dashed guide frame and the "Shot 3 · IMEI / serial label" pill; the reference draws a gradient panel. The shutter is drawn in the same ring-and-disc form; it is disabled until the stream is live.
- **Chips.** "Marks" (not yet reached) is a grey pill, as the reference's archived chip; the shots done are "✓" chips.
- **"Record the video next"** opens the device's own recorder (a file input with `capture`): an in-page recorder is not built. A "Done" link closes the sheet.
- **Not drawn in the shot:** the permission-denied and no-camera states ("The camera is off for Komtru", "We couldn't open a camera", with "Choose from my gallery"), and the fallback where `getUserMedia` is missing. The reference does not draw them; they are covered by component tests.
