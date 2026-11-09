# CWT-09 — Trade Actions (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10832 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000009/actions
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,971 of 224,400 (10.24%)
- **Side by side:** `CWT-09.png` (reference · built · heat map) — **heat map:** `CWT-09.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **No "Fund trade · Buyer" row on this trade, and "Release funds" says it is not a shortcut.** Rows are derived from state and role exactly as the drawing says: this trade is already paid for, so funding is not offered, and a withdrawal before payment is not available either. Steps that belong to later features (shipping, confirming delivery, inspection, cancelling after payment, disputes) are listed with "Not in the app yet" and have no control.
- **The row icons are not drawn.**

**Real differences**

- **The only controls are real ones.** "View agreed terms" is a link and "Withdraw from this trade" (before payment only) cancels the trade through the platform after one confirmation.
- Tab strip under the header. "View current trade" and "Open trade activity" are in the page flow, not pinned.
