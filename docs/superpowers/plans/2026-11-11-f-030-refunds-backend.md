# F-030 Cancel a trade and get a refund — backend (T-075, T-066) implementation plan

**Tickets:** T-075 (`docs/tickets/08-ledger.md`) and T-066 (`docs/tickets/07-trades.md`), feature F-030.
The screens (T-119: CT1, CT2, AR1, CR1–CR3, SC1, SC2) are a parallel UI run; this one builds the
backend and the `shared-types` / `api-client` contracts they read.
**Branch:** `f-030-cancel-refund`. **Migration:** `0049_refunds_cancellations` (the one migration).

**Goal:** after funding, a buyer can ask to cancel before shipment and the seller approves or
declines; a seller who cannot fulfil cancels and the buyer is refunded at once; an overdue delivery
(DE3, already built) is refunded the same way. Every refund is decided in the ledger first, then
executed against the original charge through the provider's Refund API, and resolved only on the
provider's own record of the refund.

## What is reused, unchanged

- `postJournal(tx, …)` with keys namespaced by the thing replayed (`refund:<id>:decided`).
- T-074's primitives `escrowRefundLines`, `feeRefundLines`, `feeRecognitionLines`,
  `refundableOnFullRefundOf`, `releaseAmounts`, `assertSnapshotMatchesColumns`. T-074 asked T-075 to
  adopt its escrow-balance check as its own: the refund decision reads both liabilities inside the
  posting transaction and refuses unless each equals the snapshot.
- `trades.refund.requested` (T-064's seam, no amount) is the one intake. T-066 publishes it for an
  approved cancellation (`MUTUAL_AGREEMENT`) and a seller who cannot fulfil (`SELLER_CANNOT_FULFIL`);
  DE3 already publishes it (`DELIVERY_OVERDUE`).
- `REFUND_CANCELLATION: FUNDED → CANCELLED_REFUNDED` and both notifications already exist.
- The payout pattern (F-037): claim before send, settle on the provider's verify answer, poll with
  `moveToDelayed`, a five-minute backstop sweep, forward-only status trigger.

## Money rule (Q4) and postings

Design §12 Q4 and `config/fees.yaml`: _refunded on every full refund; retained on partial dispute
outcomes_. Read from the trade's frozen snapshot (`refundableOnFullRefundOf`), never the live file.

| When                         | Key                   | Lines                                                                                                                        |
| ---------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Decided, full, fee refunded  | `refund:<id>:decided` | Dr `USER_ESCROW_LIABILITY<trade>` item; Dr `BUYER_PROTECTION_FEE_LIABILITY<trade>` fee; Cr `PLATFORM_ESCROW_POOL` item + fee |
| Decided, full, fee retained  | `refund:<id>:decided` | Dr escrow item; Cr pool item; Dr fee liability fee; Cr `BUYER_PROTECTION_FEE_REVENUE` fee                                    |
| Decided, partial (item only) | `refund:<id>:decided` | Dr escrow X; Cr pool X (fee left standing, Q4 "retained on partial")                                                         |
| Provider says `failed`       | `refund:<id>:failed`  | Dr pool refunded total; Cr escrow item part; Cr fee liability fee part (the exact cash-out legs, reversed)                   |
| Provider says `processed`    | none                  | The pool was credited at the decision (M8 §7: the ledger records the decision; the provider executes it)                     |

The decision posts in the same transaction that writes the refund row and publishes
`ledger.payment.escrow_refunded`, which trades consumes to move `FUNDED → CANCELLED_REFUNDED`.

## Guards

- **Cumulative refunds never exceed the charge** — a `BEFORE INSERT OR UPDATE` trigger on
  `ledger.refunds` locks the `payment_attempts` row `FOR UPDATE` and refuses (`KT014`) when the sum of
  non-FAILED refunds against that attempt would exceed its `amount_minor`. The lock serialises
  concurrent refunds against one charge; tested with racing inserts.
- One live FULL refund per trade (partial unique index); a FAILED one frees the slot.
- The decision also locks the trade `FOR SHARE` (a transition waits), refuses unless the trade is
  `FUNDED`, has no active hold, its snapshot matches its columns, and both liabilities equal the
  snapshot. The charge reference comes from the trade's one SUCCEEDED attempt, never from a client.
- `ledger.guard_refund()`: identity, amounts, charge and decision journal frozen; status forward-only
  (`REQUESTED → PROCESSING | NEEDS_REVIEW`, `PROCESSING → PROCESSED | FAILED | NEEDS_REVIEW`,
  `NEEDS_REVIEW → PROCESSED | FAILED`); PROCESSED and FAILED final; provider refund id set once.
  No deletes.

## Execution

1. `ledger.process-refund` {refundId}, queued by the ledger's own subscriber to `escrow_refunded`.
   Claims `REQUESTED → PROCESSING` under the row lock, then calls `initiateRefund` once with the
   charge's provider reference and the decided total. Paystack's Refund API takes no client
   reference, so a call that fails or times out is **never re-sent** automatically: the refund stays
   `PROCESSING` with no provider id until a `refund.*` webhook names it, or the sweep moves it to
   `NEEDS_REVIEW` after an hour.
2. Resolution (job, webhook, sweep) fetches `GET /refund/:id` and decides on that answer only:
   `processed` → PROCESSED; `failed` → FAILED + the failure journal; a different amount or currency
   → NEEDS_REVIEW, nothing posts; still pending → poll (capped delay), and after 7 days NEEDS_REVIEW.
3. A `refund.*` webhook is matched on the provider refund id; failing that, on the original charge
   reference when exactly one in-flight refund for that charge has no provider id yet (it is attached,
   then verified).
4. `ledger.refund.completed` announces PROCESSED, FAILED and NEEDS_REVIEW.

## Trades side (T-066)

- `trade.cancellation_requests`: a buyer request (CR1: `CHANGED_MIND`, `FOUND_CHEAPER`,
  `ORDERED_BY_MISTAKE`) is `PENDING` until the seller approves (refund requested) or declines (CR2);
  a seller's can't-fulfil (SC1: `OUT_OF_STOCK`, `WRONG_PRICE`, `CANNOT_MEET_TIMELINE`, `OTHER`) is
  written `APPROVED` at once (SC2). One pending and one approved per trade.
- Routes: `GET /trades/:id/cancellation`, `POST /trades/:id/cancellation-request`,
  `POST /trades/:id/cancellation-request/:requestId/approve|decline`, `POST /trades/:id/cannot-fulfil`.
- Only while `FUNDED`, trade locked `FOR UPDATE`, no active hold. An approved request closes dispatch
  (`assertDispatchOpen`), so nothing ships into escrow that is being returned. A pending request lapses
  when the trade leaves `FUNDED` any other way (shipped, overdue refund).
- `ledger.payment.escrow_refunded` → `REFUND_CANCELLATION` with `cancellation_reason` from the event.
- Ledger routes: `GET /trades/:id/refunds` (either party) and `GET /me/refunds` (the buyer).

## Steps (each committed when green)

**Status (2026-11-11):** steps 1–8 are DONE and committed. The backend layer of F-030 is complete;
T-119 (the screens) is the parallel UI run.

1. Plan (this file).
2. Migration `0049`: `ledger.refunds` and its triggers, `trade.cancellation_requests`; lock and
   invariants; schema integration tests.
3. Pure refund domain (`domain/refunds.ts`): plan the decision lines and the failure lines, refund
   status mapping, mismatch check. Unit tests first.
4. `refund.service.ts`: the decision, against a real Postgres (balances, Q4 both ways, replays,
   concurrency, the cumulative trigger).
5. Paystack `verifyRefund`; `refundDispatch.service.ts`, `jobs/refund.job.ts`, webhook `refund.*`,
   the sweep; module wiring.
6. Trades: `cancellation.service.ts`, routes, the escrow-refunded subscriber, the dispatch guard.
7. Ledger read routes; `shared-types` refund and cancellation enums; `api-client` contracts and hooks.
8. Verification: lint, typecheck, tests (infra), `format:check`, `migration:safety`.

## Owner questions (defaults applied)

1. **CR2's "auto-approved if you don't [respond within 12h]"** is in the v2 reference only; no spec
   states it, and it would move money without the seller's consent. Default: **not built**. A pending
   request stays open until the seller answers, the trade ships (the request lapses), or DE3's
   delivery deadline refunds the buyer.
2. **CR2's "Contest — I've already shipped"** says contesting holds the refund for TrustOps. Default:
   contest is a plain **decline** with an optional note; no hold or case is opened.
3. **A refund the provider reports `failed`**: the money is reversed back into the trade's escrow and
   fee liabilities (the platform holds it and still owes it), the refund is FAILED and
   `ledger.refund.completed` says so; the trade stays `CANCELLED_REFUNDED`. **No automatic retry and
   no admin retry route yet** (M8 §10's dual-approval `payment.refund` is T-076/T-140 territory).
4. **An initiate call that fails or times out is never re-sent** (Paystack takes no client reference,
   so a resend could refund twice). Default: wait for a webhook to name it, else NEEDS_REVIEW after
   an hour. Confirm whether Paystack's list-refunds-by-transaction can be relied on to automate this.
5. **Refund pending cap:** 7 days at the provider, then NEEDS_REVIEW (Paystack documents no bound).
6. **`refundable_on_full_refund: false`** (not today's value) would recognise the fee as revenue in
   the refund decision journal, so no liability is left standing.
7. **Paystack's own processing fee is not refunded to the platform** (m8 §5); nothing posts for it
   yet — T-076's reconciliation will see the provider balance differ by that fee.
8. **A hold on the trade** refuses cancellation and can't-fulfil (409), and the ledger refuses a
   refund decision on a held trade as well. Nothing re-drives a refund after a hold is lifted
   (same open question as T-074's release).
9. **Partial refunds** are supported by the service (item money only, fee retained) but no route or
   caller uses them yet; T-080's dispute split posts its own journal and will need an
   execute-only entry point.

## As built

- `ledger.payment.escrow_refunded` {tradeId, refundId, journalEntryId, buyerUserId, reason, scope,
  amounts, buyerProtectionFeeTreatment} and `ledger.refund.completed` {outcome PROCESSED | FAILED |
  NEEDS_REVIEW}. Trades publishes `trades.cancellation.requested` and `trades.cancellation.responded`
  for CR2's notification; no notification plan is wired for them yet (T-068's job).
- The ledger subscribes to `trades.refund.requested` (`ledger.on-refund-requested`), so DE3's overdue
  delivery, which only published the event until now, is refunded end to end as well.
- Cancellation activity rows are written with `metadata.event` (`CANCELLATION_REQUESTED`,
  `CANCELLATION_APPROVED`, `CANCELLATION_DECLINED`, `CANCELLATION_LAPSED`, `SELLER_CANNOT_FULFIL`,
  `ESCROW_REFUNDED`) and are internal: adding them to the party feed needs new `TradeActivityKind`
  labels, which web-app-ui maps exhaustively, so that belongs with T-119.
- SQLSTATEs: `KT014` cumulative refund guard, `KT015` refund and cancellation-request guards.
- `funding.int.test.ts` now truncates `payment_attempts` with `CASCADE` (refunds reference it).
- A declined buyer request cannot be repeated on the same trade (default; listed below).

10. **A declined cancellation request cannot be asked again** on the same trade (default, to stop a
    buyer re-asking a seller who has answered). Confirm or allow one more.
