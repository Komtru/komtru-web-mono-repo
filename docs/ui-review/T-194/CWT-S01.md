# CWT-S01 — Agreement — Accepted Terms (T-194)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 10861 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3123/trade/0190b0a0-0000-7000-8000-000000000001/agreement
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 26,074 of 224,400 (11.62%)
- **Side by side:** `CWT-S01.png` (reference · built · heat map) — **heat map:** `CWT-S01.diff.png`

## Deviations

**Shell chrome and the stand-in.** The reference draws a full-screen mobile frame with its own top bar and pinned footer; the built screen sits in `AppShell` (brand row, mode switch, tab bar), `ScreenHeader` stands in for the drawn bar and the actions (`ActionStack`) sit in the page flow above the real tab bar, so the built shot is taller and every row below the header is offset. The shot walks the real screen in Chromium against `next dev`, with the platform's routes answered from canned data (TechEdge NG, iPhone 13 · 128GB), so names and amounts are illustrative. Amounts print with kobo (`₦195,000.00`) as the rest of the app does; the reference prints whole naira. The reference's `₦198,500` total is ₦195,000 + the ₦3,500 Buyer Protection Fee here, not ₦3,500 delivery.

**Real differences (intended, and why)**

- **Delivery row** reads `Courier · ₦3,500.00` (the seller's committed charge) for the reference's `Courier · calculated`; the item card prints the price with kobo and carries no "Buyer · name" sub line (the platform sends the other party, shown in the strip below).
- **"Trade expiry · 6 hours from acceptance" is not drawn** (owner question O1). The reference's ticks, locked-terms note and both buttons are built.
