# CWT-01 — Workspace — Awaiting Funding (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10607 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000001
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,076 of 224,400 (9.84%)
- **Side by side:** `CWT-01.png` (reference · built · heat map) — **heat map:** `CWT-01.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **No "Fund this trade" button, no "Trade expiry · 5h 18m remaining", and "Seller payout · Locked" is not drawn.** Funding is F-024, so no control is drawn (a plain line says payment is not available in the app yet). The trade view carries no payment deadline, so no expiry is stated (plan Q2).
- **No "Trade details" link rows (Payment, Delivery, Evidence).** Those open the CWT-S screens of later features. Agreement and Activity are reached through the tab strip instead.

**Real differences (intended, and why)**

- **The body is the F-017 "Terms agreed" screen (TC-06), not the CWT-01 "Protect the agreed amount" banner.** F-017's TC-06 tests must keep passing, and a PENDING_PAYMENT trade is exactly TC-06's state, so the ring, "Agreement recorded", the fee list and the version history stay, inside the workspace chrome. The banner and money rows of CWT-01 arrive with F-024, which owns what the buyer does next. This is the largest visible difference of the eleven.
- **A tab strip (Overview, Terms, Activity, Actions) sits under the card.** The reference reaches Terms, Activity and Actions from buttons and rows, one per state; the brief asks for tabs, and Activity and Actions need an entry that does not depend on the state.
- **The card's item line reads "Apple iPhone 13 · TechEdge NG"** where the drawing has "iPhone 13 · 128GB · TechEdge NG": the item title is the brand and model, and the storage is the second line of the item card below.
- **Amounts in the item card keep ".00"** ("₦195,000.00") as on every F-017 screen; the money rows drop it as the drawing does.
