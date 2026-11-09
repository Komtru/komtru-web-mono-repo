# CWT-07 — Agreed Terms (T-116)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10791 — Canonical Mobile Architecture — Trade Workspace · Tabbed
- **Built:** http://localhost:3102/trade/0190b0a0-0000-7000-8000-000000000007/terms
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,321 of 224,400 (10.39%)
- **Side by side:** `CWT-07.png` (reference · built · heat map) — **heat map:** `CWT-07.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stub.** The reference draws a full-screen mobile frame with its own top bar and a pinned footer. The built screen sits in `AppShell` (shot with `--content main`, so the shell's brand row does not shift every line) and its actions are in the page flow, because a pinned footer would sit on the tab bar. The shot ran against the real app and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the session cookie), so copy and layout are the real screen and the data is illustrative: the trade code, counterparty and amounts differ from the drawing for that reason only.

**Correctly shows less (post-MVP or not built yet).** The chat icon in the top bar is messaging (F-044). **Real differences** are listed under their own heading.

**Correctly shows less**

- **"Delivery · Courier · ₦3,500" and the "Cancellation & issue terms" block ("Before shipment", "After shipment", "Item problem") are not drawn.** The delivery method and fee are chosen at dispatch (F-026), and the cancellation wording is policy copy with no API source (open question Q-A from F-017). **No "Review policy terms" button** for the same reason.

**Real differences**

- **The page lists the F-017 terms rows (Price, Inspection, Delivery to, Ships from, Version, Accepted)** rather than the drawing's four, because those are the agreed terms the platform holds. It adds the fee summary and the version history from TC-06.
- **The item card line is the item only**; the drawing adds "Buyer · Amaka O. · Seller · TechEdge NG", which the party strip shows below it as the counterparty.
- "Terms recorded" is a banner where the drawing has a small chip and a paragraph.
