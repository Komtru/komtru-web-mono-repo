# CWT-S15 — Resolution — Case Status & Settlement (T-196)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 11128 — Trade Workspace — Supporting Screens
- **Built:** http://localhost:3931/trade/0190b0a0-0000-7000-8000-000000000504/dispute/status
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,563 of 224,400 (10.50%)
- **Side by side:** `CWT-S15.png` (reference · built · heat map) — **heat map:** `CWT-S15.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Scenario:** `dispute-mediation`, buyer, `/trade/<id>/dispute/status`. Re-measured this run with the case in mediation; the earlier 9.80% was measured with the case in evidence collection and is superseded.

- **Shell offset (standing).** The built screen sits under the app shell's Komtru bar (about 28px) and above the tab bar with its raised plus action; the reference frame draws neither, and its action is pinned (`.btn-sticky`) where the built one is in the page flow. Every line below the title therefore sits lower than in the reference, which is most of the heat map on every screen here. Not a defect of this screen.
- **Figures and codes.** ₦102,900.00, DIS-088244 against ₦195,000, DIS-88213, "Dispute · KMT-90428" (fixture). Stage reads "Awaiting a response" where the reference says "Evidence requested"; the reference is drawn one step later than the mediation fixture.
- **Strip.** The built screen adds "Auto-escalates to TrustOps in 47h if not mutually resolved"; the reference has none at this point.
- **Card line.** "Still protected — no funds have moved" against "Funds protected — no refund issued yet".
- **Buttons.** The reference overlays "Open dispute status", "Settle directly with the seller" and "Return to trade" on the step rail. The built screen offers "Compare the evidence", "Withdraw the dispute" (the opener, during mediation) and "Return to trade" in flow, below the rail. "Settle directly with the seller" points at F-034's screen, which does not exist yet. Intended (README).
- **Financial state.** Funds Protected / Refund Not issued / Seller payout Held: identical rows and values.
