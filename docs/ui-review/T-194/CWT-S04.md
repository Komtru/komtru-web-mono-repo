# CWT-S04 — Payment — Review & Confirm (T-194)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10919 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3123/trade/0190b0a0-0000-7000-8000-000000000001/fund
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 33,007 of 224,400 (14.71%)
- **Side by side:** `CWT-S04.png` (reference · built · heat map) — **heat map:** `CWT-S04.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer; the built screen sits in `AppShell` (brand row, mode switch, tab bar), `ScreenHeader` stands in for the drawn bar and the actions (`ActionStack`) sit in the page flow above the real tab bar, so the built shot is taller and every row below the header is offset. The shot walks the real screen in Chromium against `next dev`, with the platform's routes answered from canned data (TechEdge NG, iPhone 13 · 128GB), so names and amounts are illustrative. Amounts print with kobo (`₦195,000.00`) as the rest of the app does; the reference prints whole naira. The reference's `₦198,500` total is ₦195,000 + the ₦3,500 Buyer Protection Fee here, not ₦3,500 delivery.

**Real differences (intended, and why)**

- **Method reads "Bank transfer"** (the default choice) where the reference shows a saved card, and the fee rows are Amount, Buyer Protection Fee and Total where it shows Amount, Delivery, Total. The item card has no "KMT-90428 · TechEdge NG" sub line.
- **Amounts have one source.** Amount, Buyer Protection Fee and Total are all from the payment attempt once one exists and all from the trade's fee snapshot before, never mixed, so the lines add up to the total. The seller's delivery-charge disclosure from the choice step ("paid to the seller outside Komtru protection and not part of this total") is repeated under the fee card when the seller committed one.
- **This step is new to the funding flow.** F-024 went from the choice straight to the payment; the review sits between them and "Back" returns to the choice with the method kept. "Confirm & pay" opens Paystack's checkout (card) or the transfer step (bank transfer).
