# F-030 UI — cancel a trade and get a refund (T-119)

Backend is merged (T-066, T-075, migration 0049) and the api-client hooks exist
(`useCancellation`, `useTradeRefunds`, `useRequestCancellation`, `useApproveCancellation`,
`useDeclineCancellation`, `useCancelAsSeller`, `useCancelTrade`). This plan is the screens only. No backend change.

Screens: CT1, CT2, AR1 (Cancel a Trade), CR1, CR2, CR3, SC1, SC2 (Cancel After Funding), v2 master lines 4236-4450.

## The money rule

A screen never asserts a financial state it has not read for THIS trade.

- Every refund amount, the item/fee split and the fee treatment come from the refund row of
  `GET /trades/:id/refunds`. Nothing is added, subtracted or inferred (the Q4 fee rule is the ledger's).
- "Refund issued" is said only for a `PROCESSED` refund. `REQUESTED` and `PROCESSING` are "on its way";
  `FAILED` and `NEEDS_REVIEW` say the money is held, give the reference and the platform's `failureReason`.
  A `CANCELLED_REFUNDED` trade with no refund row says nothing about money.
- Buttons come from `GET /trades/:id/cancellation` `actions`, never from the route. A trade that is shipped,
  held, already refunded or already answered shows why, with no control.
- CT1 (unfunded) must not claim "no money has moved". For the buyer on `PENDING_PAYMENT` it reads the payment
  status first: `NONE` offers the cancel plainly; `AWAITING_PAYMENT` (a transfer may be on its way) needs an
  explicit "I have not sent any money" tick; `VERIFYING`, `CONFIRMED`, `UNDER_REVIEW`, `NOT_CONFIRMED` offer no
  cancel at all; an unreadable status offers none either. The seller cannot read it and is told only what the
  trade status proves.
- Approving a cancellation (CR2) and the seller's can't-fulfil (SC1) refund the buyer irreversibly, so each asks
  once in a sheet. No retry/remint-style action is ever the primary button.
- Not built (owner questions on the backend plan, or no data): CR2's 12-hour auto-approval and its countdown,
  "TrustOps holds a contested refund", "arrives within 2 hours", "report an issue for 24h after auto-release".
  The words do not promise them.

## Routes and states

| Route                                 | Screens                                                          | Driven by                                    |
| ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| `/trade/[id]/cancel`                  | CT1 (PENDING_PAYMENT), CR1 (buyer, FUNDED), SC1 (seller, FUNDED) | trade status, role, `cancellation.actions`   |
| `/trade/[id]/cancel-request`          | CR2                                                              | `actions.canRespond`, `request.status`       |
| trade overview, `CANCELLED`           | CT2                                                              | trade status                                 |
| trade overview, `CANCELLED_REFUNDED`  | CR3 (buyer approved), SC2 (seller cancelled), generic refund     | `useTradeRefunds`, `useCancellation`         |
| trade overview, `COMPLETED`/`SETTLED` | AR1                                                              | the activity feed's `INSPECTION_ELAPSED` row |
| trade overview, `FUNDED`              | notice that a request/refund is open, link to CR2                | `useCancellation`                            |

`workspace-state`: the `cancel-after-payment` "later" row becomes a live link; the pre-funding Withdraw button
links to CT1 instead of a bare confirm sheet.

## Steps (test first, commit after each green)

1. `src/trade/cancel/words.ts` pure copy and refund-state functions + tests.
2. CT1 + CT2 (with the payment guard).
3. CR1 and SC1 on `/cancel`, with the refusal states.
4. CR2 on `/cancel-request`.
5. Refund outcome (CR3, SC2, generic) replacing the unconditional `CANCELLED_REFUNDED` hero.
6. FUNDED notice, AR1, workspace-state links.
7. Routes, visual check evidence in `docs/ui-review/T-119/`, ticket docs, full verification.
