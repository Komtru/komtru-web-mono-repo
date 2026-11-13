# PM-8 — After completion — the Trade record (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11334 — Trade execution · Proof media
- **Built:** /trade/<id>/record (new route; the reference's /trades/KMT-…/record. The app's trade routes are by id)
- **State shot:** completed trade, five proof files and a dispatch photo
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 33,762 of 224,400 (15.05%)
- **Side by side:** `PM-8.png` (reference · built · heat map) — **heat map:** `PM-8.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Kept-evidence rows are what the platform recorded:** seller's proof (a count of photos or videos; the platform does not say which are videos), dispatch (the waybill photo) and delivery (the records). The reference's "Delivery · 1 photo · hub scan" and "Inspection · 3 photos" rows are not drawn: neither exists. The thumbnails are the first four proof files.
- **"Kept for 12 months, then archived" is not drawn.** No retention rule exists on the platform. The banner keeps the true sentences: only the two people in the Trade and Komtru can see it, and a later listing edit doesn't change it.
- The item card shows the item and price with no "Completed 6 Oct" date (the trade view carries no completion time); the Completed chip is below it. A trade that has not completed shows a note and a way to the evidence page; a refunded one shows "Refunded".
