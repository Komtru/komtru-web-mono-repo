# PM-8 — After completion — the Trade record (T-197)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11334 — Trade execution · Proof media
- **Built:** http://localhost:3130/trade/0190b0a0-0000-7000-8000-000000000002/record
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 33,871 of 224,400 (15.09%)
- **Side by side:** `PM-8.png` (reference · built · heat map) — **heat map:** `PM-8.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer. The built screen sits in `AppShell` (`ScreenHeader` for the bar, in-flow actions above the real tab bar). The shot was taken against `next dev` behind a one-line proxy that adds a sealed session cookie, with a canned stand-in for the platform routes (names, codes, prices and the photo tiles are illustrative). Interaction states that the reference does not draw (loading, empty, error, offline, permission denied) are covered by component tests.

**Real differences (intended, and why)**

- **Kept-evidence rows are what the platform recorded:** seller's proof (a count of photos or videos; the platform does not say which are videos), dispatch ("1 photo · waybill" for the seller; "Waybill noted" for the buyer, whose access to the waybill photo the platform withholds) and delivery (the records). The reference's "Delivery · 1 photo · hub scan" and "Inspection · 3 photos" rows are not drawn: neither exists. The thumbnails are the first four proof files.
- **Privacy and retention.** "Kept for 12 months, then archived" is not drawn (no retention rule exists), and neither is "only the two people and Komtru can see it" or "later listing edits don't change it". The banner says what is true: these files are held privately with the Trade, not made public, and shared only with the people in it.
- The item card shows the item and price with no "Completed 6 Oct" date (the trade view carries no completion time); the Completed chip is below it. A trade that has not completed shows a note and a way to the evidence page; a refunded one shows "Refunded". Route is `/trade/<id>/record`, as the app's trade routes are by id.
