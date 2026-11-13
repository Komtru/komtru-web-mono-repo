# CWT-S02 — Agreement — Version History (T-194)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10879 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3123/trade/0190b0a0-0000-7000-8000-000000000001/agreement/history
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 31,971 of 224,400 (14.25%)
- **Side by side:** `CWT-S02.png` (reference · built · heat map) — **heat map:** `CWT-S02.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer; the built screen sits in `AppShell` (brand row, mode switch, tab bar), `ScreenHeader` stands in for the drawn bar and the actions (`ActionStack`) sit in the page flow above the real tab bar, so the built shot is taller and every row below the header is offset. The shot walks the real screen in Chromium against `next dev`, with the platform's routes answered from canned data (TechEdge NG, iPhone 13 · 128GB), so names and amounts are illustrative. Amounts print with kobo (`₦195,000.00`) as the rest of the app does; the reference prints whole naira. The reference's `₦198,500` total is ₦195,000 + the ₦3,500 Buyer Protection Fee here, not ₦3,500 delivery.

**Real differences (intended, and why)**

- **Earlier versions have a proposer and a date, but no amount.** The reference lists "Version 1 · Buyer proposal ₦205,000" and "Version 2 · Seller counter ₦198,000". The proposer and date are drawn from the trade's activity (one attributed, dated item per terms version), so "Version 2 · Seller counter" and its date are real. The amount of an earlier version is on no route (the platform returns only the accepted terms; owner question O2 is now only that), so it is not drawn. When the activity cannot account for every version, the earlier ones read "Superseded" and nothing is invented.
- **The timeline is not in a card** (the reference wraps it in one; `VersionTimeline` draws the list only).
- **"Created" row reads "Accepted"** with the acceptance time: that is what the trade carries. The trade-code row and both buttons are built as drawn.
