# CWT-S09 — Delivery — Waybill & Handover (T-195)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11008 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000002/dispatch/waybill
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 20,331 of 224,400 (9.06%)
- **Side by side:** `CWT-S09.png` (reference · built · heat map) — **heat map:** `CWT-S09.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell`: `ScreenHeader` stands in for the drawn bar, the actions are in-flow (`ActionStack`) above the real tab bar rather than pinned, and the shot clips from `main` so the app header does not offset every line. The shot walked the real screen in a browser against `next dev` and a canned stand-in for the platform routes and the session, so names, codes, times and prices are illustrative. Times are shown in Lagos time as the app words them, so they differ from the reference's fixed examples.

**Real differences (intended, and why)**

- **No waybill is generated.** The reference's logistics card shows a courier and a generated waybill "SW-88213-04"; the self-arranged seller gives their own waybill number, a receipt photo, the driver's phone and the plate (the four things the platform requires), so the card reads "Arranged by you · Pickup · seller address" and "Waybill <number>".
- **The handover confirmation is a checkbox** ("The courier has collected the parcel"), required before "Confirm handover", which is the call that marks the trade shipped. After it the screen says "Handover confirmed" and links to tracking.
- After handover the screen shows "Handover confirmed" with "Report delivery" for the seller (F-026's step) and a link to tracking.
- Secondary "Back" goes to dispatch readiness (CWT-S08).
