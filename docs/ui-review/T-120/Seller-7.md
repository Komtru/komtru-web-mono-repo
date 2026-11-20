# Seller-7 — Dispute Notice (T-120)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 5689 — Seller — Mobile Web
- **Built:** http://localhost:3931/trade/0190b0a0-0000-7000-8000-000000000504/dispute
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 33,903 of 224,400 (15.11%)
- **Side by side:** `Seller-7.png` (reference · built · heat map) — **heat map:** `Seller-7.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Scenario:** `dispute-mediation`, seller, `/trade/<id>/dispute`. Added this run: the seller persona sees the seller side of the disputed trade only in the dispute scenarios.

- **Shell offset (standing).** The built screen sits under the app shell's Komtru bar (about 28px) and above the tab bar with its raised plus action; the reference frame draws neither, and its action is pinned (`.btn-sticky`) where the built one is in the page flow. Every line below the title therefore sits lower than in the reference, which is most of the heat map on every screen here. Not a defect of this screen.
- **Fixed this run:** the item card showed the trade code ("KMT-88244-NG") as the item title and the escrow twice. It now names the item (JBL Flip 6), with the trade code and buyer beneath. Before the fix the same card read as a trade code, not a thing being traded.
- **Fixed this run:** "Respond with evidence" went to the evidence comparison (Y1). The reference sends it to Seller-8, "Your Response", and that screen was built but unreachable (no route, no test). It now has `/trade/<id>/dispute/respond` and the button goes there.
- **Strip copy.** "Auto-escalates to TrustOps in 47h if not mutually resolved" against "Respond within 24h — funds stay protected either way". The clock is the platform's, not the reference's 24h; the reference's seller-specific wording is not used. Intended; the owner may prefer the seller wording over the shared countdown line.
- **Price.** The built card prints ₦102,900.00 large in the mono face; the reference puts the price in the grey sub line. `ItemCard` (ui-kit) has a mandatory price slot, so this is the primitive's shape, shared with every ItemCard.
- **Quote.** Built text is the fixture's, in curly quotes ("reason: not as described"); the reference reads "reason: item doesn't match description".
