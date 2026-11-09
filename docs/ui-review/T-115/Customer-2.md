# Customer-2 — Agreement Summary (T-115)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3994 — Customer (Buyer) — Mobile Web
- **Built:** http://localhost:3101/trade/0190b0a0-0000-7000-8000-000000000002
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 22,736 of 224,400 (10.13%)
- **Side by side:** `Customer-2.png` (reference · built · heat map) — **heat map:** `Customer-2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome (every screen here).** The reference draws these as full-screen mobile frames with their own
top bar and a pinned footer, and no tab bar. The built screens sit inside `AppShell` (the brief says to use
it), so each carries the shell's brand row with the Buy/Sell switch above it and the tab bar below it, and its
own back/title row is drawn in the content. That is the largest part of every heat map and is intended. Actions
are in the page flow (`ActionStack`) rather than `.btn-sticky`, because a pinned footer would sit on the tab bar.

**Shot against a stub.** The harness shot ran against the real app with a canned stand-in for the backend
(trade ids mapped to states) because no backend runs in the review environment; copy and layout are the real
screens, the data is illustrative.

- **The screen is the buyer's review of a seller's proposal, not "Review & Fund".** Funding is F-024 and has no screen yet, so there is no "Fund this trade" button and no dead link. The button is "Accept terms"; after it, TC-06 says payment is not available in the app yet.
- **The seller strip and "Recent reviews" are not drawn** (API gap 2; reviews are not built).
- **Terms** are the trade's own: price, inspection window from the standard, ships-from address, version. The drawn "Delivery 2-4 days", "Cancellation Free before shipment" and "Refund Full, if item doesn't match" are policy copy with no API source and are not drawn.
- **Added:** the buyer's delivery-address picker, "Propose a change" and Decline.
