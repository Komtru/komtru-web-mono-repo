# DE2 — Seller Needs More Time (T-118)

- **Reference:** `docs/design-reference/Komtru — UI Living Master v2.html` line 4799 — Delivery Extension — Mobile Web
- **Built:** http://localhost:3128/trade/0190b0a0-0000-7000-8000-000000000204
- **Frame:** mobile, 340px reference frame; compared at 340 × 660
- **Differing pixels:** 23,115 of 224,400 (10.30%)
- **Side by side:** `DE2.png` (reference · built · heat map) — **heat map:** `DE2.diff.png`

## Deviations

<!-- One line per deviation the heat map shows: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**Shell chrome and the stand-in.** The built screen sits in `AppShell` (shot with `--content main`) and its actions are in the page flow above the real tab bar, where the reference pins them in a sticky footer; the tab bar and the moved buttons light the foot of the heat map. The shot ran against the production build and a canned stand-in for the platform (trade ids mapped to states, one proxy adding the sealed session cookie), so names, amounts, dates and photos are illustrative.

**Real differences (intended, and why)**

- **Built into the trade overview, not its own screen.** The buyer meets the request where they already are, under "Your funds are protected", as a section with the reason and both dates. The accept and decline buttons follow the rows.
- **The reference's "decline makes this eligible for a refund once the original deadline passes" is worded as what the platform does:** the original date stands. A buyer is never offered a refund control (F-030); if nothing is shipped by the date, the platform refunds on its own.
- The seller's name is in the section heading.
