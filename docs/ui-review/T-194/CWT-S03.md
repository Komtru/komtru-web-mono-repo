# CWT-S03 — Payment — Funding Method (T-194)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10901 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3123/trade/0190b0a0-0000-7000-8000-000000000001/fund
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 19,019 of 224,400 (8.48%)
- **Side by side:** `CWT-S03.png` (reference · built · heat map) — **heat map:** `CWT-S03.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer; the built screen sits in `AppShell` (brand row, mode switch, tab bar), `ScreenHeader` stands in for the drawn bar and the actions (`ActionStack`) sit in the page flow above the real tab bar, so the built shot is taller and every row below the header is offset. The shot walks the real screen in Chromium against `next dev`, with the platform's routes answered from canned data (TechEdge NG, iPhone 13 · 128GB), so names and amounts are illustrative. Amounts print with kobo (`₦195,000.00`) as the rest of the app does; the reference prints whole naira. The reference's `₦198,500` total is ₦195,000 + the ₦3,500 Buyer Protection Fee here, not ₦3,500 delivery.

**Real differences (intended, and why)**

- **Methods are Bank transfer and Debit card or USSD**, not "Debit card · •••• 4821", Bank transfer and Komtru Wallet: a saved card and a wallet do not exist on the platform (the card is entered in Paystack's checkout). Bank transfer is the first and default (F-024).
- **Fee card** lists trade reference, item price, Buyer Protection Fee and total to pay from the fee snapshot, for the reference's "Trade amount / Delivery / Total to protect"; the seller's delivery charge is paid outside Komtru protection (F-024) and so is not a line of the protected total. The protected-funds note and the buttons ("Continue to payment", "Cancel") follow the reference.
