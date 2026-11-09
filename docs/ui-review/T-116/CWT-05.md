# CWT-05 — Workspace — Disputed (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10731 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000005
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 24,195 of 224,400 (10.78%)
- **Side by side:** `CWT-05.png` (reference · built · heat map) — **heat map:** `CWT-05.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **No case reference ("DIS-88213"), issue, stage, exposure, "Evidence response due in 17h 05m", and no "Submit evidence" or "Open dispute status" buttons.** The dispute module (T-080) and its screens (F-032) are not built; the trade only knows it is DISPUTED. The screen says funds remain protected and that the case is not in the app yet, and invents no case.

**Real differences**

- Tab strip and item line as in CWT-01.
- **Money rows are added** ("You paid", "Seller payout · held while the case is open"), which the drawing does not have in this state, because they are what the person most wants to know here and the platform has them.
