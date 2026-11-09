# Customer-2 — Agreement Summary (T-115)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3994 — Customer (Buyer) — Mobile Web
- **Built:** http://localhost:3101/trade/0190b0a0-0000-7000-8000-000000000002
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 28,452 of 224,400 (12.68%)
- **Side by side:** `Customer-2.png` (reference · built · heat map) — **heat map:** `Customer-2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome.** The reference draws these as full-screen mobile frames with their own top bar and a
pinned footer, and no tab bar. The built screens sit inside `AppShell`. The shot is taken with
`--content main`, so it starts at the screen's own content and the shell's brand row does not shift every
line; the tab bar still sits at the bottom of the compared area, and actions are in the page flow
(`ActionStack`) rather than `.btn-sticky`, because a pinned footer would sit on the tab bar. What the heat
map shows is therefore real differences in what each screen says and holds, listed below.

**Shot against a stub.** The shot ran against the real app with a canned stand-in for the backend (trade
ids mapped to states) because no backend runs in the review environment; copy and layout are the real
screens, the data is illustrative.

- **The screen is the buyer's review of a seller's proposal, not "Review & Fund".** Funding is F-024 and has no screen yet, so there is no "Fund this trade" button and no dead link. The button is "Accept terms"; after it, TC-06 says payment is not available in the app yet.
- **The seller strip and "Recent reviews" are not drawn** (API gap 2; reviews are not built).
- **Terms** are the trade's own: price, inspection window from the standard, ships-from address, version. The drawn "Delivery 2-4 days", "Cancellation Free before shipment" and "Refund Full, if item doesn't match" are policy copy with no API source and are not drawn.
- **Added:** the buyer's delivery-address picker, "Propose a change" and Decline.
