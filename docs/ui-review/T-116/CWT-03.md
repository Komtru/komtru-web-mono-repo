# CWT-03 — Workspace — In Transit (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10667 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000003
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 21,919 of 224,400 (9.77%)
- **Side by side:** `CWT-03.png` (reference · built · heat map) — **heat map:** `CWT-03.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **No courier partner, "Last update · Arrived at Abuja hub" or "Next · Out for delivery".** The platform has no courier tracking (courier and Park custody are T-087 and T-093). What it records is shown: when the seller handed the item over and the waybill, from the inspection read. If none was recorded the card is omitted rather than invented (plan Q1).
- **No "View delivery tracking" or "Message seller" buttons.** Tracking has no source; messaging is F-044.

**Real differences**

- Tab strip and item line as in CWT-01.
- **"Inspection · Courier: on delivery · Park: 12h after arrival" is "48 hours from delivery"** from the trade's own terms, because the dispatch method that makes the two differ is not chosen in the app yet.
