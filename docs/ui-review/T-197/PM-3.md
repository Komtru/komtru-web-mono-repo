# PM-3 — Photo check — needs another look (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11244 — Trade execution · Proof media
- **Built:** /dev-proof/pm3 (harness; it adds an empty file after load to trigger the check)
- **State shot:** a flagged photo (an empty file from the gallery)
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 30,984 of 224,400 (13.81%)
- **Side by side:** `PM-3.png` (reference · built · heat map) — **heat map:** `PM-3.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **What flags a photo.** The reference says "Looks like a stock or downloaded image". No originality check exists on the platform, so the built checks are the ones this app can make on the device: not a photo or video, too small to show the item, an empty file, the same file added twice. The wording is the same plain, non-accusing kind ("Too small to show the item clearly").
- **No "ask for a review" button.** There is no review request on the platform, so the secondary action is not drawn; the banner says "Asking a person to review a photo isn't in the app yet." The ghost action is "Remove it".
- **The file card** is the ui-kit risk banner (file name as title, reason beneath) rather than the reference's white card with an icon. The flagged tile is the local preview (broken for an empty file, which is how the shot happens to look) with the risk outline; the video tile is shown dark with a play mark as the reference draws.
- The first line in the shot's heading area ("One photo needs replacing") and the "Why this matters" rows and the "AI-generated, stock and downloaded images aren't accepted." line are the reference's copy.
