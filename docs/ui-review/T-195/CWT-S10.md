# CWT-S10 — Delivery — Tracking & Custody (T-195)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11029 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000003/track
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 30,095 of 224,400 (13.41%)
- **Side by side:** `CWT-S10.png` (reference · built · heat map) — **heat map:** `CWT-S10.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell`: `ScreenHeader` stands in for the drawn bar, the actions are in-flow (`ActionStack`) above the real tab bar rather than pinned, and the shot clips from `main` so the app header does not offset every line. The shot walked the real screen in a browser against `next dev` and a canned stand-in for the platform routes and the session, so names, codes, times and prices are illustrative. Times are shown in Lagos time as the app words them, so they differ from the reference's fixed examples.

**Real differences (intended, and why)**

- **Custody timeline is Seller, Courier, You**; the reference's third node is "Park Hub · Not received". There is no hub in the MVP.
- **"Last update" reads "Handed to the courier · <time>"** from the platform's record of the handover; the reference's "Collected from seller" implies courier scan events, which the platform does not have. **"Expected" reads "By <deadline>"** from the delivery deadline, not a courier estimate. A "Vehicle" row (the plate) is added; courier tracking events are not drawn because none exist.
- **Primary button reads "Delivery details"**, not "Pickup details" (no pickup in the self-arranged path).
- A seller whose parcel is in transit also sees "Report delivery". A failed read of the shipment or the deadline is said in place (in the words of the connection when offline) while the timeline still shows.
- The screen shows for both sides (the reference labels it buyer) and words the first and last node for the reader. Before handover it says "Not handed over yet".
