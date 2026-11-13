# CWT-S08 — Delivery — Dispatch Readiness (T-195)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10990 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000001/dispatch
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,341 of 224,400 (9.96%)
- **Side by side:** `CWT-S08.png` (reference · built · heat map) — **heat map:** `CWT-S08.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell`: `ScreenHeader` stands in for the drawn bar, the actions are in-flow (`ActionStack`) above the real tab bar rather than pinned, and the shot clips from `main` so the app header does not offset every line. The shot walked the real screen in a browser against `next dev` and a canned stand-in for the platform routes and the session, so names, codes, times and prices are illustrative. Times are shown in Lagos time as the app words them, so they differ from the reference's fixed examples.

**Real differences (intended, and why)**

- **Delivery reads "Arranged by you", not "Courier", and there is no "Delivery charge" row.** Couriers and Park are out of the MVP (F-062 / T-093, F-066) and the platform has no delivery fee to read; none is invented.
- **Checklist items are real checkboxes** (the reference draws radio-style rows with the first selected). The checklist is **advisory**: it is the seller's own reminder, and ticking it unlocks nothing (the reference's button is also always live). The real gates are the platform's (payment protected, and the waybill evidence on the next screen). The second row reads "Waybill or courier receipt ready" because there is no waybill to generate; "Dispatch allowed" is the platform's own fact, ticked and fixed.
- **Primary button reads "Add waybill details", not "Generate waybill"**: the seller's own courier issues the waybill. It goes to CWT-S09.
- **Inspection reads "48 hours minimum"** from the trade's own window.
- Before payment is protected the screen is the dispatch lock (warning banner, disabled button); the reference's separate "Payment needs attention" screen is CWT-S07 (F-023).
- A buyer who opens it is told only the seller dispatches (permission denied); a seller whose item has gone is pointed at tracking and, while it is in transit, offered "Report delivery" (F-026's step, kept reachable here).
