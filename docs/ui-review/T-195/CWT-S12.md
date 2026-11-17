# CWT-S12 — Evidence — Trade Media (T-195)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11073 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3128/trade/0190b0a0-0000-7000-8000-000000000001/evidence
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 51,576 of 224,400 (22.98%)
- **Side by side:** `CWT-S12.png` (reference · built · heat map) — **heat map:** `CWT-S12.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell`: `ScreenHeader` stands in for the drawn bar, the actions are in-flow (`ActionStack`) above the real tab bar rather than pinned, and the shot clips from `main`. The shot walked the real screen in a browser against `next dev` and a canned stand-in for the platform routes and the session (a buyer in inspection; four proof files, two delivery files, two inspection files), so names, codes and times are illustrative. Times are shown in Lagos time.

**Real differences (intended, and why)**

- **Delivery and Inspection are filled from the new read** (`GET /trades/:id/evidence?event=`), one group each with its own loading, empty and failed state. A file says who added it in its screen-reader label ("Delivery file 1, added by the seller"). Dispatch files and an Issue group are drawn only when there are some, because the reference has no Issue group and Dispatch already carries the waybill.
- **Headings keep the wording the merged screen already used** ("Added at delivery", "Added at inspection", "Added by the seller · dispatch") with the count in the caption ("3 files · shared with both sides of the trade"), not the reference's "Delivery · 3 files" labels.
- **Real thumbnails, signed on demand,** where the reference draws grey tiles; the dashed "add" tile in the Dispatch row is replaced by the "Add evidence" action at the foot.
- **"Add evidence" is drawn only while the trade can take evidence** (shipped, delivered, inspection, under review); a finished trade shows Back to trade alone.
- **Own empty wording** when nothing was added ("Nothing has been added at delivery yet."; for the buyer at inspection, "Photos you add at inspection are kept here, with the trade.").
- **Not drawn:** the header chat icon (no chat-from-evidence flow), and the Listing label (the seller's proof keeps the wording the merged screen uses, "Seller’s proof").
- **Heat map.** Large red blocks are the real thumbnails against the reference's flat tiles, plus the longer content pushing every later heading down.
