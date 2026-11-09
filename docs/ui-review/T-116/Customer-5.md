# Customer-5 — Trade Complete (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4087 — Customer (Buyer) — Mobile Web
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000010
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 19,037 of 224,400 (8.48%)
- **Side by side:** `Customer-5.png` (reference · built · heat map) — **heat map:** `Customer-5.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **No "343 trades now on your Trust Profile" and no "Leave a review".** The trade count is Trust Passport data (F-016, not wired into this screen) and reviews are F-038 (post-MVP). The screen draws no control that would do nothing.

**Real differences**

- **The drawing is a full-screen celebration with no card or tabs; the built screen keeps the workspace's summary card and tab strip above the same ring and heading**, because a settled trade is still the same trade a person may open Terms or Activity on. "Trade complete" and "₦… released to … Both sides honoured the agreement in full." read as drawn.
- **A "Back to Trades" button and the item card are added** below the heading; the card shows the item and its agreed price.
