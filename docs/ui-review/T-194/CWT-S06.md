# CWT-S06 — Payment — Protected (T-194)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10954 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3123/trade/0190b0a0-0000-7000-8000-000000000001/fund
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 18,455 of 224,400 (8.22%)
- **Side by side:** `CWT-S06.png` (reference · built · heat map) — **heat map:** `CWT-S06.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer; the built screen sits in `AppShell` (brand row, mode switch, tab bar), `ScreenHeader` stands in for the drawn bar and the actions (`ActionStack`) sit in the page flow above the real tab bar, so the built shot is taller and every row below the header is offset. The shot walks the real screen in Chromium against `next dev`, with the platform's routes answered from canned data (TechEdge NG, iPhone 13 · 128GB), so names and amounts are illustrative. Amounts print with kobo (`₦195,000.00`) as the rest of the app does; the reference prints whole naira. The reference's `₦198,500` total is ₦195,000 + the ₦3,500 Buyer Protection Fee here, not ₦3,500 delivery.

**Real differences (intended, and why)**

- **The screen says what is true of the trade's status.** The same address serves every status after payment. While the money is held (FUNDED and onward to settlement) it reads "Funds protected", "Held until settlement"; "Dispatch is now eligible" is drawn only for a funded trade the seller has not yet shipped. For SETTLED and RESOLVED_RELEASED it reads "Payment released" with "Seller payout: Paid"; for refunded trades "Payment refunded" with "Not paid". The hero is "Funds protected" (F-024's V3 wording) for the reference's "Funds are protected"; the confirmed-at banner is kept without repeating the reference.
- **"View delivery" opens the trade's overview**, where the seller's dispatch shows; "View payment details" is replaced by "Back to trade timeline", because the payment details are on this screen already.
