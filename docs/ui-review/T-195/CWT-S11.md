# CWT-S11 — Delivery — Park Pickup (T-195)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11055 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000004/pickup
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 45,321 of 224,400 (20.20%)
- **Side by side:** `CWT-S11.png` (reference · built · heat map) — **heat map:** `CWT-S11.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell`: `ScreenHeader` stands in for the drawn bar, the actions are in-flow (`ActionStack`) above the real tab bar rather than pinned, and the shot clips from `main` so the app header does not offset every line. The shot walked the real screen in a browser against `next dev` and a canned stand-in for the platform routes and the session, so names, codes, times and prices are illustrative. Times are shown in Lagos time as the app words them, so they differ from the reference's fixed examples.

**Real differences (intended, and why)**

- **This is the self-arranged path only, by the ticket's Park carve-out.** The reference draws a hub card ("Wuse II Park Hub"), a Release PIN (482 771) and a note that inspection starts 12 hours after the parcel arrives. None of that exists without Park, so none is drawn: no hub, no PIN, no 12-hour rule. The screen says who is delivering to which address, the waybill, and that there is no release PIN (confirm on the trade). The title is "Delivery Details", not "Ready for Collection". This is the largest deviation and is expected to be replaced when Park (F-062) is built.
- The inspection note reads the trade's own window ("starts when you confirm you have the item"), which is how the platform starts it.
- Secondary "Track the delivery" is added.
