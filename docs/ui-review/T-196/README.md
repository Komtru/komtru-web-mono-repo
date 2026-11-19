# F-032 — Trade workspace resolution and issue reporting (T-196)

> **The pixel comparison has not been run**, for the reason given in `docs/ui-review/T-120/README.md`: the
> canned platform stand-in these shots need is built per ticket and was not built in this run. The deviation
> record below is written; the generated stub is owed, and `visualCheck` will write it above each
> `## Deviations` heading without disturbing what is there.

| Screen  | Route                          | Case state                         | Shot |
| ------- | ------------------------------ | ---------------------------------- | ---- |
| DI-01   | `/trade/[id]/issue`            | case just opened, buyer            | owed |
| CWT-S14 | `/trade/[id]/dispute`          | `INSPECTION`, buyer, no case yet   | owed |
| CWT-S15 | `/trade/[id]/dispute/status`   | `MEDIATION`, either side           | owed |
| CWT-S16 | `/trade/[id]/dispute`          | multi-item order (not in platform) | owed |
| CWT-S17 | `/trade/[id]/dispute/item`     | multi-item order (not in platform) | owed |
| CWT-S18 | `/trade/[id]/dispute/status`   | mixed order (not in platform)      | owed |
| SP-M23  | `/trade/[id]/dispute/withdraw` | `MEDIATION`, opener                | owed |

## Deviations

<!-- One line per deviation: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**The standing three.** `AppShell` chrome, `ActionStack` in flow rather than the reference's sticky footer, and the
missing `₦` glyph in the Google `latin` subset.

**CWT-S14 and Customer-7 are one screen.** They differ in the reference only in that CWT-S14 shows three term rows
above the question. The built screen draws those rows from the trade the platform answered with, so it is the same
component from either entry point and the two cannot drift.

**CWT-S14 — "Inspection · Active · 48h minimum" is not drawn.** That row is the inspection window's, and this
screen has not read it. The rows it does draw — the trade code, the agreed amount and "Funds: Protected" — are all
the trade's own answer.

**DI-01 — it reviews the report rather than asking again.** The reference's graph is CWT-S14 → "Continue to issue
review" → DI-01 → "Continue to evidence". By the time a person reaches DI-01 the previous screen has opened the
case, so a second "What went wrong?" picker here would ask the same question twice and store the second answer.
The built screen shows what was filed, with the platform's banner about what a report does and does not guarantee,
and sends them on to evidence.

**CWT-S16, CWT-S17 and CWT-S18 — the multi-item order does not exist in the platform.** A trade is one item; the
orders module is not built and `Dispute.orderId` is always null. Every sentence these three screens would
otherwise draw is a claim about money and fulfilment nothing can back: "Item 2 / 2", "The iPhone 13 Pro is not
affected", "This item's funds: Protected", "Confirmed · released" per item, "The rest of the order is not held
up". The repo's standing rule is that a screen never asserts a financial state it has not read for that trade, so
each of the three says plainly that multi-item orders are not in the app yet and offers the whole-trade report,
which is the one true thing available. CWT-S18's per-item payment table is not drawn at all. The structure is in
place for the order read when F-069/F-073 lands.

**CWT-S15 — "Settle directly with the seller" is not offered.** The reference points it at RX-12, which is
F-034's mutual-settlement screen. The built screen offers "Compare the evidence", which is where an offer is
actually made today, and the withdrawal where the platform allows one.

**CWT-S15 — the financial state rows are the three the platform knows.** "Funds: Protected", "Refund: Not issued",
"Seller payout: Held" are all true for the whole time a case is open, and are not read per-trade figures. No
amount is restated beside them.

**SP-M23 — the route is `/trade/<uuid>/dispute/withdraw`.** The reference writes `/trades/<code>/dispute/withdraw`,
the only dispute screen on the trade-code scheme. The app addresses every trade sub-route by uuid; one screen on a
different scheme would be the only place in the app where a trade code appears in a path.

**SP-M23 — "41h left" on the inspection step is not drawn.** The inspection window belongs to the trade and this
screen has not read it. The step says the true general thing — the window keeps running where the trade still has
one — without a number.

**SP-M23 — it is offered only to the person who opened the case, and only during mediation.** The reference
presents the screen unconditionally. The platform allows the withdrawal only from `MEDIATION` and only to the
opener; reached otherwise, the screen says which and offers no button.

**No Playwright e2e.** As T-120: the repo has no app e2e harness, and T-111 and T-192 both waived it. Component
tests with axe cover these screens in `apps/web-app-ui/test/dispute.test.tsx`.

## Judgement

**Not yet assessed.** The pixel pass is owed. The three multi-item screens are the ones to look at hardest: they
are honest placeholders rather than built screens, and whether that is acceptable for the ticket is the owner's
call, not this run's.
