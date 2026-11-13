# PM-5 — Request stage — the buyer reviews the proof (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11283 — Trade execution · Proof media
- **Built:** /dev-proof/pm5 (harness mounting `ProofReview`; in the app it sits on CT-S7, "Review & Accept", above the agreement)
- **State shot:** buyer, before accepting; five files with signed URLs
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 57,305 of 224,400 (25.54%)
- **Side by side:** `PM-5.png` (reference · built · heat map) — **heat map:** `PM-5.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Blocking gap, owner question.** Before a trade is agreed the platform tells the buyer only how many files the seller attached (`proofMediaCount`); the files open through the inspection read, which is empty until the item ships. So on CT-S7 the buyer sees the count ("TechEdge NG showed 4 photos or videos. They open once the Trade is agreed") and not the media. `ProofReview` takes the files and draws them the moment a read exists, which is the shot above.
- **No hero video, no "Taken on a camera" / "Originality check passed" chips, no "4 photos · 1 video" tally.** The platform records no camera or originality result, and does not say which files are videos until each is opened. The rows "Shown by", "Taken" (first and last attach time) and "Can the seller change it? / Until you accept" and the info banner are the reference's.
- **Actions** ("Continue to the agreement", "Ask the seller a question") belong to the host screen; "Ask the seller a question" is not built (no chat before agreement).
