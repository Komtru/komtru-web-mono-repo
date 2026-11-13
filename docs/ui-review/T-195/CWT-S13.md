# CWT-S13 — Evidence — Submit (T-195)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11091 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000006/evidence/new
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 30,013 of 224,400 (13.37%)
- **Side by side:** `CWT-S13.png` (reference · built · heat map) — **heat map:** `CWT-S13.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell`: `ScreenHeader` stands in for the drawn bar, the actions are in-flow (`ActionStack`) above the real tab bar rather than pinned, and the shot clips from `main` so the app header does not offset every line. The shot walked the real screen in a browser against `next dev` and a canned stand-in for the platform routes and the session, so names, codes, times and prices are illustrative. Times are shown in Lagos time as the app words them, so they differ from the reference's fixed examples.

**Real differences (intended, and why)**

- **Drawn as a seam, not the reference's form.** The reference has an evidence category list (Inspection, Dispatch, Delivery, Issue), an "Add photos and video" picker and "Submit evidence". The platform has no endpoint that attaches evidence to a trade or a case for the parties (files can be uploaded, but nothing links them to a trade; case evidence is staff-side, F-032), so no picker or Submit is drawn. The screen keeps the reference's prose, says "Not in the app yet" and links to the evidence by event. A backend ticket is needed before this can be built (owner question in the report).
