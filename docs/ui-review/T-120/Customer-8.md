# Customer-8 — Dispute Status (T-120)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4164 — Customer (Buyer) — Mobile Web
- **Built:** http://localhost:3931/trade/0190b0a0-0000-7000-8000-000000000504/dispute
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 13,018 of 224,400 (5.80%)
- **Side by side:** `Customer-8.png` (reference · built · heat map) — **heat map:** `Customer-8.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Scenario:** `dispute-mediation`, buyer, `/trade/<id>/dispute` on the disputed trade (the route redirects nowhere; a buyer with a case is shown the status screen).

- **Shell offset (standing).** The built screen sits under the app shell's Komtru bar (about 28px) and above the tab bar with its raised plus action; the reference frame draws neither, and its action is pinned (`.btn-sticky`) where the built one is in the page flow. Every line below the title therefore sits lower than in the reference, which is most of the heat map on every screen here. Not a defect of this screen.
- **Figures and codes.** ₦102,900.00 and DIS-088244 (fixture) against ₦452,000 and KMT-88213. The amount is set in the mono face with kobo, as the ui-kit trade row does it everywhere.
- **Extra blocks.** The built screen adds the "Auto-escalates to TrustOps in 47h" strip, a Case list (case, issue, stage) and a Financial state list. The reference's Customer-8 has the rail only; those blocks are CWT-S15's, and one component serves both. Intended (CWT-S15 record).
- **Step rail.** Built titles are "You reported this issue / [seller] was notified / Awaiting the other side's response" with "Filed" as the detail on both done steps; the reference has "You filed this dispute / ... was notified" with a time ("Today, 3:12 PM") and "They have 24h to reply". The built clock is the platform's 48-hour mediation window ("47h left to reply"). The step details do not carry the case timeline's times yet. **Open, small:** `caseSteps` does not receive the timeline.
- **Tab bar** drawn by the shell; the reference frame has none.
