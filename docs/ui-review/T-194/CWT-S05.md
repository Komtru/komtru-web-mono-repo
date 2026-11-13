# CWT-S05 — Payment — Processing (T-194)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10937 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3123/trade/0190b0a0-0000-7000-8000-000000000001/fund
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 33,505 of 224,400 (14.93%)
- **Side by side:** `CWT-S05.png` (reference · built · heat map) — **heat map:** `CWT-S05.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer; the built screen sits in `AppShell` (brand row, mode switch, tab bar), `ScreenHeader` stands in for the drawn bar and the actions (`ActionStack`) sit in the page flow above the real tab bar, so the built shot is taller and every row below the header is offset. The shot walks the real screen in Chromium against `next dev`, with the platform's routes answered from canned data (TechEdge NG, iPhone 13 · 128GB), so names and amounts are illustrative. Amounts print with kobo (`₦195,000.00`) as the rest of the app does; the reference prints whole naira. The reference's `₦198,500` total is ₦195,000 + the ₦3,500 Buyer Protection Fee here, not ₦3,500 delivery.

**Real differences (intended, and why)**

- **The body is F-024's AB3 loader and its copy** ("Checking with Paystack, usually under 30 seconds, occasionally up to 2 minutes") joined to the reference's caption; the reference's rows are all drawn, from the platform's read of the attempt (the provider status is "Processing" while the platform verifies).
- **"Check status" reads the platform's payment state again** and asks nothing of Paystack. The shot starts under the app header, so the reference's bare top (no title bar) differs by the "Fund & Protect" header the built screen keeps.
