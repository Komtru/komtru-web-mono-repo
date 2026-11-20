# F-032 — Disputes, buyer and seller (T-120)

> **The pixel comparison has been run** (2026-11-20) with `pnpm visual-check --walk <screen>` against the platform
> stand-in, for all eight screens below. The two scores recorded earlier (12.27% and 12.49%) were measured against
> the error card and are void; so are the 10.11% and 9.80% re-measures, which were taken with the case in evidence
> collection while the reference is drawn at mediation. Per-screen records, with the scenario each was shot in, are
> beside this file (`<screen>.md`); the PNGs and heat maps are generated beside them and not committed.

| Screen     | Route                          | Scenario (persona)                            | Differing pixels | Record          |
| ---------- | ------------------------------ | --------------------------------------------- | ---------------- | --------------- |
| Customer-7 | `/trade/[id]/dispute`          | `with-trades` (buyer, in inspection, no case) | 9.98%            | `Customer-7.md` |
| Customer-8 | `/trade/[id]/dispute`          | `dispute-mediation` (buyer)                   | 5.80%            | `Customer-8.md` |
| H1         | `/trade/[id]/dispute/status`   | `dispute-decided` (buyer)                     | 11.58%           | `H1.md`         |
| H2         | `/trade/[id]/dispute/status`   | `dispute-decided` (seller)                    | 7.37%            | `H2.md`         |
| Y1         | `/trade/[id]/dispute/evidence` | `dispute-mediation` (buyer)                   | 10.48%           | `Y1.md`         |
| AC6        | `/trade/[id]/appeal`           | `dispute-decided` (buyer)                     | 14.68%           | `AC6.md`        |
| Seller-7   | `/trade/[id]/dispute`          | `dispute-mediation` (seller)                  | 15.11%           | `Seller-7.md`   |
| Seller-8   | `/trade/[id]/dispute/respond`  | `dispute-mediation` (seller)                  | 11.18%           | `Seller-8.md`   |

**Reading the scores.** Every screen sits under the app shell's header bar, so all content is about 28px lower than
in the reference and its line boxes no longer overlap the reference's; that alone flags most text. Scores of 6% to
15% are therefore the same band as T-113's proven AC1, and what separates the screens is the written list, not the
number. The scenarios `dispute-mediation` and `dispute-decided` (and the seller's side of the disputed trade) are
new in the stand-in this run; see `docs/runbooks/visual-check.md`.

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

**Y1 — "Full refund with return" is a note, "Replacement item" is not offered.** Return is recorded as the agreed
note beside the money outcome it really is (Q10: return shipping is self-arranged); the platform stores no
return-logistics state and the screen claims none. Replacement is hidden, here and on Seller-8: its only fitting
outcome, `RELEASE_SELLER_FULL`, would release the whole escrow on a promise nothing enforces. It is F-034's track.

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

## Found and fixed by running it

- **Seller-8 was unreachable.** `SellerResponse` was built and exported and nothing routed to it; Seller-7's "Respond
  with evidence" went to the comparison (Y1) instead. Neither the 22 component tests nor the axe pass drew it, which is
  why nobody noticed. It now has `/trade/<id>/dispute/respond`, Seller-7's button goes there, and two tests cover it.
- **Seller-7 and DI-01 named the trade code as the item.** The item card's title was "KMT-88244-NG" with the escrow
  printed twice. It now names the item.
- **H1's timeline said a decided case was "awaiting the other side's response".** It now says the response window
  closed.

## Judgement

The eight screens render against the stand-in in the states the reference draws, with the data they should read. What
differs is documented line by line in each record, and falls into three groups:

1. **Intended and argued above** (reason vocabulary, nothing pre-selected, the step rail from the real status, the
   platform's own clocks, no invented figures, counts for thumbnails).
2. **Shell and data** (the header offset, fixture codes and amounts, the page being longer than the 660px frame).
3. **A real gap: three screens have no evidence uploader.** Customer-7 ("Add evidence photos"), Seller-8 ("Add
   supporting evidence") and AC6 ("Add new evidence") draw one in the reference and ship without. The file path exists
   (`uploadFile`, `FileDropzone`, `fileRefId` on `POST /disputes/:id/evidence`), but the open-dispute and appeal
   endpoints accept no files, so photos on those two would need either a contract change or a second step. Seller-8's
   "Add photos and compare" and Y1 are the way to add evidence today. **Owner's decision (2026-11-20): F-032 counts
   as Done without the uploader.** The uploader on these three screens is a follow-up.

Not touched: the dispute-withdrawal behaviour that leaves the trade in `DISPUTED` (a money question, in
`docs/manager/RUN_LOG.md`).
