# Seller-8 — Submit Evidence (T-120)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 5711 — Seller — Mobile Web
- **Built:** http://localhost:3931/trade/0190b0a0-0000-7000-8000-000000000504/dispute/respond
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 25,097 of 224,400 (11.18%)
- **Side by side:** `Seller-8.png` (reference · built · heat map) — **heat map:** `Seller-8.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Scenario:** `dispute-mediation`, seller, `/trade/<id>/dispute/respond`. **This route did not exist before this run:** `SellerResponse` was built and never reached; the screen could not be checked, and no seller could have seen it. Wired and tested this run.

- **Shell offset (standing).** The built screen sits under the app shell's Komtru bar (about 28px) and above the tab bar with its raised plus action; the reference frame draws neither, and its action is pinned (`.btn-sticky`) where the built one is in the page flow. Every line below the title therefore sits lower than in the reference, which is most of the heat map on every screen here. Not a defect of this screen.
- **Strip.** An "Auto-escalates in 47h" strip sits above the page; the reference has none on this screen.
- **Advisory block.** The reference's dashed indigo "Before you respond" block carries the unmeasured "buyers are far more likely to accept a reshipment" claim; the built block says the true version in a solid note banner. Intended (README, Seller-8).
- **Evidence uploader.** The reference draws "Evidence (packing slip, stock photos, etc.)" with an "Add supporting evidence" drop zone. The built screen has none and offers "Add photos and compare" (to Y1) instead. **Real gap, not changed:** same reason as Customer-7.
- **Textarea.** Built is empty with an "Explain your side" placeholder and the button disabled until it has words; the reference shows a filled example.
- **Proposed resolution.** Built labels "Proposed resolution (optional)" and offers one option, "Full refund" (outcome `REFUND_BUYER_FULL`, the whole escrow to the buyer), none selected. The reference's "Reship the correct color, no extra cost" is **not offered**: its only fitting outcome, `RELEASE_SELLER_FULL`, would release the whole escrow to the seller on a promise nothing enforces. Replacement is F-034's track. Y1's buyer-side "Replacement item" still carries that mapping (design Q10) and is flagged to the owner.
