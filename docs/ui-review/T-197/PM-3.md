# PM-3 — Photo check — needs another look (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11244 — Trade execution · Proof media
- **Built:** http://localhost:3130/dev-proof/pm3
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 31,111 of 224,400 (13.86%)
- **Side by side:** `PM-3.png` (reference · built · heat map) — **heat map:** `PM-3.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **What flags a photo.** The reference says "Looks like a stock or downloaded image". No originality check exists on the platform, so the built checks are the ones this app can make on the device: not a photo or video, a photo the browser cannot open (damaged; an iPhone HEIC is let through, since browsers cannot decode it), too small to show the item (shorter side under 400px), an empty file, the same file added twice. The wording is plain and non-accusing. The shot is the damaged-file case.
- **Several files can be turned away at once**, each with its own card and outline; the heading counts them, and a good file in the same batch never clears another file's flag. The panel is announced (`role="alert"`) and focus moves to its heading. Retake keeps the flag until the replacement arrives.
- **No "ask for a review" button.** There is no review request on the platform, so the secondary action is not drawn; the note says "Asking a person to review a photo isn't in the app yet." The ghost action is "Remove it".
- **The "AI-generated, stock and downloaded images aren't accepted" line is replaced** by "Show the item itself, in your own photos", because the app enforces no such rule. "If it's ever disputed" reads "It's part of the Trade's evidence".
- **The file card** is the ui-kit risk banner rather than the reference's white card with an icon; the flagged tile is the local preview (broken for an unreadable file, which is how the shot looks) with the risk outline.
