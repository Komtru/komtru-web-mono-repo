# CTS1 — Trade Standards (T-115)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3650 — Trade Standards by Category — Mobile Web
- **Built:** http://localhost:3101/trade/standards
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 13,432 of 224,400 (5.99%)
- **Side by side:** `CTS1.png` (reference · built · heat map) — **heat map:** `CTS1.diff.png`

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

- **Four rows of the reference are not drawn** (Clock starts, Buyer can request, Full refund if, Cancellation) and the two closing paragraphs about inspection timing. The Trade Standards API carries none of them; writing them from the drawing would state terms nothing enforces. Intended, and open question Q-A in the plan. The built card instead lists the item details the category asks for, the seller proof it needs and the delivery deadline, all from the API.
- **Inspection window reads in hours** ("48 hours"), as drawn.
- **Banner icon** is the reference's two-nodes-on-a-rail mark (`RULES`); the banner is `<Banner tone="info">`, so its text is 11.5px as in the reference.
- **Category marks** follow the drawing for the two launch categories (briefcase in info, garment in warning); any later category gets the briefcase.
- The page heading is the top-bar title, drawn as the `h1`.
