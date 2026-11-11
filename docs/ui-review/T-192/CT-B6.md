# CT-B6 — Trade request — complete the details (T-192)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 3392 — Create a Trade · Seller completes
- **Built:** http://localhost:3118/trade/0190b0a0-0000-7000-8000-000000000001
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 27,311 of 224,400 (12.17%)
- **Side by side:** `CT-B6.png` (reference · built · heat map) — **heat map:** `CT-B6.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar (title and `n / N` counter) and a pinned footer. The built screen sits in `AppShell`; the shot starts at `main`, with `ScreenHeader` in place of the drawn bar (it has no counter slot), in-flow actions (`ActionStack`) above the real tab bar, and the stage rail drawn under it. The shot walked the real screen in a browser (typing, pressing Continue) against the dev server and a canned stand-in for the platform routes, so names, codes and prices are illustrative. The naira sign comes from a system fallback on both sides (README).

**Real differences (intended, and why)**

- **No expiry line.** The reference says "Respond within 4 hours or this expires"; the trade carries no such deadline, so it is not drawn (and no countdown is invented).
- **"Identity verified" beside the buyer is not drawn**: the counterparty display carries a name only. The item card has no photo (listings carry none).
- "Category" is read from the trade; Decline opens a confirmation that asks for a reason, as the platform requires one.
