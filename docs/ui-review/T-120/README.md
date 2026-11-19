# F-032 — Disputes, buyer and seller (T-120)

> **The pixel comparison has not been run.** `pnpm visual-check` needs the production build behind a canned
> stand-in for the platform (trade ids mapped to states, a proxy adding the sealed session cookie), the way
> T-119's shots were taken. That stand-in is built per ticket and was not built in this run. Everything below
> is the deviation record, written from the reference and the built screens side by side; the generated stub
> with the differing-pixel counts is still owed, and `visualCheck` will write it above each `## Deviations`
> heading without disturbing what is there.

| Screen     | Route                          | Case state                          | Shot |
| ---------- | ------------------------------ | ----------------------------------- | ---- |
| Customer-7 | `/trade/[id]/dispute`          | `INSPECTION`, buyer, no case yet    | owed |
| Customer-8 | `/trade/[id]/dispute/status`   | `MEDIATION`, buyer                  | owed |
| H1         | `/trade/[id]/dispute/status`   | `DECIDED`, buyer, refund in full    | owed |
| H2         | `/trade/[id]/dispute/status`   | `DECIDED`, seller, same case        | owed |
| Y1         | `/trade/[id]/dispute/evidence` | `MEDIATION`, either side            | owed |
| AC6        | `/trade/[id]/appeal`           | `DECIDED`, inside the appeal window | owed |
| Seller-7   | `/trade/[id]/dispute`          | `MEDIATION`, seller                 | owed |
| Seller-8   | `/trade/[id]/dispute`          | `MEDIATION`, seller, responding     | owed |

## Deviations

<!-- One line per deviation: what differs, where, and whether it is intended.
     Everything below this comment survives the next run; everything above it is regenerated. -->

**The standing three.** The built screens sit in `AppShell` (shot with `--content main`), their actions are in the
page flow via `ActionStack` where the reference pins a `.btn-sticky`, and the `₦` glyph is missing from the Google
`latin` subset. All three are accepted across every ticket in this directory.

**Nothing is pre-selected on an intake form.** The reference marks a reason chosen on Customer-7, Y1, Seller-8 and
DI-01. None of these do. A dispute category is recorded on a financial case and drives a reviewer's queue; a person
who tapped through quickly should not discover they filed under a reason they never picked. Every one of these
screens keeps its button disabled until a choice is made.

**Customer-7 — four reason vocabularies, one enum.** The reference lists a different "What went wrong?" set on
Customer-7, DI-01, CWT-S14 and CWT-S17. DI-01's is canonical here, because DI-01 is the structured intake every
other screen funnels into. Two of its four options ("Arrived damaged" and "Not as described") file under the same
platform category, `ITEM_NOT_AS_DESCRIBED`, because M3 has no damage category — the distinction survives in the
buyer's own description, which is on the case. Parked for the owner.

**Customer-8 — the step rail is built from the case, not from a script.** The reference draws a fixed four-step
rail. The built rail is derived from the case's real status, so a dispute withdrawn during mediation shows no
greyed-out "TrustOps decision" step: a pending node is a promise that something is still coming, and for a
withdrawn case nothing is.

**Customer-8 — "They have 24h to reply" is the platform's own clock.** The reference hard-codes 24 hours. The
built line reads the window the platform says is running (`disputes.mediation_window_hours`, 48 by default) and
prints what is left of it. A screen that promised 24 hours while the sweep fired at 48 would be wrong twice a day.

**H1 and H2 — the asymmetry is kept exactly.** The buyer gets the outcome, the decision's reasoning and the
timeline; the seller gets the outcome, the Trust Profile effect and nothing else. H2's banner is recoloured to
`info` rather than `success`, per the reference, and is deliberately not `risk`: a corrective event painted red
reads as a punishment.

**H2 — no fulfilment percentage.** The reference prints "98.7% — Fulfilment, unaffected". The built screen says
"Unaffected / Your fulfilment rate" with no number: it has not read a Trust Profile, and the repo's standing rule
is that a screen never asserts a figure it did not get. The claim that matters — the event is `Corrective`, not
`Negative` — is the platform's own vocabulary and is shown as the reference writes it.

**Y1 — both panels are always drawn.** Where a side has added nothing the panel says "Nothing added yet" rather
than being omitted. An omitted panel reads as "they submitted nothing", which is an accusation the screen has no
standing to make: the truth may be that the trade never had dispatch photos.

**Y1 — thumbnails are counts.** The reference draws two image placeholders per panel. The built panel states how
many items are on the record. Rendering the media needs signed per-file URLs for `DISPUTE_EVIDENCE` /
`PRIVATE_CASE` grants, which is the evidence-viewer work in F-069/F-073; the count is the true thing available now.

**Y1 — "Partial settlement" is offered but refused.** Of the reference's three desired outcomes, two map to money
outcomes the platform has; a partial needs an amount, and splitting the escrow is F-034's mutual-settlement track.
Choosing it disables the button and says why, rather than sending an offer the screen cannot price.

**Y1 — "Full refund with return" and "Replacement item" are notes, not outcomes.** Q10's default: both are
recorded as the agreed note beside the money outcome they really are, with return shipping self-arranged. The
platform stores no return-logistics state and the screen claims none.

**Seller-7 — the quote is attributed and unedited.** The buyer's words are shown as written, with the reason
label beside them, and the screen takes no position on them.

**Seller-8 — the advisory claim is not shipped as written.** The reference's "Buyers who receive a clear,
evidence-backed response within a few hours are far more likely to accept a reshipment over escalating" is a
statistical claim about buyer behaviour that nothing in the platform measures. T-197's review history shows this
class of copy being rewritten. The built line says the true version: a clear, evidence-backed answer is what the
reviewer reads first. Parked for the owner.

**AC6 — the screen is only drawn where an appeal is really open.** Three reference buttons lead here. Reached on a
case that has not been decided, or one already appealed, the screen says which and offers no form.

**No Playwright e2e.** The repo has no app e2e harness; T-111 and T-192 both recorded the same and waived it.
Component tests with axe cover every screen (`apps/web-app-ui/test/dispute.test.tsx`).

## Judgement

**Not yet assessed.** The deviations above are deliberate and each is argued. The pixel pass is still owed, and
the ticket should not be called done until it has run.
