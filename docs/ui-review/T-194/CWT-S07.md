# CWT-S07 — Payment — Failed or Expired (T-194)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10971 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3123/trade/0190b0a0-0000-7000-8000-000000000001/fund
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 21,302 of 224,400 (9.49%)
- **Side by side:** `CWT-S07.png` (reference · built · heat map) — **heat map:** `CWT-S07.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer; the built screen sits in `AppShell` (brand row, mode switch, tab bar), `ScreenHeader` stands in for the drawn bar and the actions (`ActionStack`) sit in the page flow above the real tab bar, so the built shot is taller and every row below the header is offset. The shot walks the real screen in Chromium against `next dev`, with the platform's routes answered from canned data (TechEdge NG, iPhone 13 · 128GB), so names and amounts are illustrative. Amounts print with kobo (`₦195,000.00`) as the rest of the app does; the reference prints whole naira. The reference's `₦198,500` total is ₦195,000 + the ₦3,500 Buyer Protection Fee here, not ₦3,500 delivery.

**Real differences (intended, and why)**

- **Three actions, not two.** "Try payment again" starts a fresh payment (F-024's restart) and "Return to trade" is as drawn; "I've sent it, check again" is kept from AB4 because a bank transfer that arrives late is the common case and the buyer should not have to start again.
- **The hero and the "Payment needs attention" banner are one block**: F-024's AB4 hero ("We couldn't confirm this payment") carries the reference's sentence "No protected-funds state has been created". The "Trade" row reads "Awaiting funding"; an expired trade shows EX-01 instead.
