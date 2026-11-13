# PM-5 — Request stage — the buyer reviews the proof (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11283 — Trade execution · Proof media
- **Built:** http://localhost:3130/dev-proof/pm5
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 66,222 of 224,400 (29.51%)
- **Side by side:** `PM-5.png` (reference · built · heat map) — **heat map:** `PM-5.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Blocking gap, owner question (corrected).** The buyer already holds access grants on the seller's proof files before accepting: the platform grants them after send, counter and the other proposal steps whenever a buyer exists. What is missing is a read that lists the file ids. `TradeView` carries only `proofMediaCount`, and the inspection read returns `sellerProof.media` empty until the trade reaches shipment. So the files could be opened, but nothing says which they are. Exposing the ids is an access-control decision for the owner and was not made here.
- **What the screen says today.** "TechEdge NG attached N photos or videos. This app can't show them yet: the platform lists a Trade's files only once the item has shipped. At inspection you compare the item with them." `ProofReview` takes the files and draws them (signed per file) the moment a read lists them; the shot is the no-listing state, which is what CT-S7 shows.
- **No hero video, no "Taken on a camera" / "Originality check passed" chips, no tally, and no "Can the seller change it? / Until you accept" row.** The platform records no camera or originality result, says which files are videos only when each is opened, and the app does not enforce a change rule. "Shown by" and "Taken" (first and last attach time, when a listing exists) are the reference's; the banner reads "This proof stays with the Trade as its evidence. At inspection, it's what the item is compared with."
- **Actions** ("Continue to the agreement", "Ask the seller a question") belong to the host screen; "Ask the seller a question" is not built (no chat before agreement).
