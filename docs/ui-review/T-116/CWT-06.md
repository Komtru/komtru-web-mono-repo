# CWT-06 — Workspace — Settlement (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10761 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000006
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 25,074 of 224,400 (11.17%)
- **Side by side:** `CWT-06.png` (reference · built · heat map) — **heat map:** `CWT-06.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **"Trade outcome · Item accepted" is "Completed".** The trade does not say whether the buyer accepted or the window ran out; the Activity tab does (TRADE_COMPLETED or INSPECTION_ELAPSED).
- **No "View trade outcome" button.** The outcome screen belongs to F-029.

**Real differences**

- Tab strip and item line as in CWT-01. The draw is the seller's view (it is "both" in the reference); the buyer's differs only in the amount (item price, not the seller's proceeds).
