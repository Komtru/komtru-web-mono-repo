# CWT-S15 — Resolution — Case Status & Settlement (T-196)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11128 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3943/trade/0190b0a0-0000-7000-8000-000000000504/dispute/status
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 21,997 of 224,400 (9.80%)
- **Side by side:** `CWT-S15.png` (reference · built · heat map) — **heat map:** `CWT-S15.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**The screen renders; it is no longer the error state.** The `Functions cannot be passed directly to Client Components` crash is fixed, as for Y1. The 9.80% score now compares the case status with the reference.

- **Figures and codes.** Amount ₦102,900.00 (fixture) against ₦195,000 in the reference; header "Dispute · DIS-088244" against "KMT-90428"; case row "DIS-088244" against "DIS-88213". Fixture data, not changed.
- **Stage and steps.** The built rail is further on ("You reported this issue", "Tunde Bello was notified", "Awaiting the other side's response", "Evidence", "TrustOps decision"); the reference is at filing ("You filed this dispute", "Settle directly with the seller"). The fixture is in evidence collection. Not changed.
- **Card and banner.** The built card line reads "Still protected — no funds have moved" and adds an "Evidence closes in 72h" banner; the reference reads "Funds protected — no refund issued yet" with no banner.
- **Action button.** The reference overlays an "Open dispute status" button on the step rail. The built screen has no such button at this point in the scroll. Not changed.
- **Tab bar.** The built screen draws the Buy/Sell switch and the bottom tab bar; the reference frame draws neither. Shell chrome, not this screen.
