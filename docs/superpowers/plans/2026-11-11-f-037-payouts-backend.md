# F-037 Get paid out — backend (T-073) implementation plan

**Ticket:** T-073 (`docs/tickets/08-ledger.md`), feature F-037. The screens (T-124: Seller-6, AB5, AB6,
WF1, PR1) are a later cycle; this one builds the backend and the `api-client` contracts they read.
**Branch:** `f-037-payouts`. **Migration:** `0048_ledger_payouts`.

**Goal:** a seller can register a bank account that the provider has resolved, choose how they are
paid (manual, immediately, daily, weekly, monthly), withdraw their available balance, and see every
payout's outcome and receipt. Every kobo moves through `postJournal` and the account chart T-070 built.

## What is reused, unchanged

- `postJournal(tx, …)`, idempotency keys namespaced by the thing replayed (`payout:<id>:initiated`).
- `USER_PAYABLE<seller>` is what T-074's release credits; it is the seller's **available balance**,
  read with `accountBalance` (a `SUM`, never a stored number).
- `SETTLEMENT_CLEARING<payout>` is credit-normal (T-070): an in-flight obligation, not cash.
- `PLATFORM_ESCROW_POOL` is the provider balance; the cash leaves it only on the provider's success.
- The provider adapter (`initiateTransfer`, `resolveAccountName`, `createTransferRecipient`), reached
  only from `jobs/` (design §4.4). The bank list cache (T-071).
- T-051's `readBankNameMatch`, through the trust barrel.
- The fee file, through the config barrel: a new `snapshotPayoutFee()` beside `snapshotParkCashFee()`.
  Ledger code may not call `getFeeSchedule` (fee guard, design §6.5), so the payout freezes the fee and
  its schedule version on its own row, the way a trade freezes its fees.

## Postings

| When                                    | Key                     | Lines                                                                                                                          |
| --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Payout requested                        | `payout:<id>:initiated` | Dr `USER_PAYABLE<user>` amount; Cr `SETTLEMENT_CLEARING<payout>` amount − fee; Cr `PLATFORM_FEE_REVENUE` fee (omitted at zero) |
| Provider confirms success               | `payout:<id>:settled`   | Dr `SETTLEMENT_CLEARING<payout>` transfer; Cr `PLATFORM_ESCROW_POOL` transfer                                                  |
| Failed, or reversed before success      | `payout:<id>:reversed`  | Dr `SETTLEMENT_CLEARING<payout>` transfer; Dr `PLATFORM_FEE_REVENUE` fee; Cr `USER_PAYABLE<user>` amount                       |
| Reversed after success (money returned) | `payout:<id>:returned`  | Dr `PLATFORM_ESCROW_POOL` transfer; Dr `PLATFORM_FEE_REVENUE` fee; Cr `USER_PAYABLE<user>` amount                              |

After every terminal outcome the payout's clearing account is zero. That is asserted in the tests and
is what a reconciliation run can check per payout.

## Flow

1. **Account** (`POST /me/payout-accounts`): bank code from the cached list, ten-digit NUBAN. The row
   is written `PENDING_VERIFICATION` with the number encrypted (AES-GCM), masked to the last four and
   HMAC-hashed for de-duplication; a job then resolves the name with the provider, reads T-051's
   name-match verdict, creates the transfer recipient and marks it `VERIFIED` (or `FAILED` with a
   reason). The first verified account becomes the default. One default per user (partial unique
   index).
2. **Preference** (`PUT /me/payout-preferences`): any mode other than `MANUAL` is refused (409
   `PAYOUT_ACCOUNT_REQUIRED`) unless the user has a verified default account. The default account
   is the one destination for automatic payouts; it cannot be removed while a non-manual mode needs it.
3. **`executePayout(tx, deps, { userId, amountMinor, payoutAccountId?, trigger, … })`**: the one
   function that creates a payout. Under a per-user advisory lock it refuses a hold, an unverified
   account, an amount at or below the fee, or an amount above the available balance; it then inserts
   the payout row and posts the initiated journal in the caller's transaction.
4. **Dispatch** (`ledger.dispatch-payout` job): the one place `initiateTransfer` is called. The payout
   is claimed `REQUESTED → PROCESSING` before the call; a hold found at this point reverses it. The
   call's answer is recorded; `success`/`failed` settle at once, `pending` waits for the webhook or
   the verify job. A call that times out leaves the payout `PROCESSING`, never reversed: the provider
   may have sent the money.
5. **Resolution**: `transfer.*` webhooks and the `ledger.verify-payout` job both settle on the
   provider's **transfer verify** answer (`GET /transfer/verify/:reference`), never on a webhook body,
   exactly as charges are settled on the charge verify call. A verified amount that differs from the
   payout's transfer amount is `NEEDS_REVIEW`, and nothing posts.
6. **Triggers**: `POST /me/payouts` (MANUAL); a subscriber on `ledger.payment.escrow_released`
   (AUTO_IMMEDIATE, exactly the proceeds just credited, once per release journal); the daily
   `ledger.sweep-payouts-auto` schedule (AUTO_SWEEP: daily users every day, weekly users on Monday,
   monthly users on the 1st, all Africa/Lagos, the whole available balance, once per user per day).
   A sweep that skips a user for a missing account or a hold publishes `ledger.payout.sweep_skipped`.
7. **Backstop**: `ledger.sweep-payouts` every five minutes re-queues `REQUESTED` payouts whose dispatch
   never ran and verifies `PROCESSING` ones that have been quiet too long.

## Holds

`ledger.payout_holds` (`PAYOUT_HOLD`, `FULL_FREEZE`, time-boxed or open-ended, released by setting
`released_at`). T-101 (risk) does not exist yet, so the ledger owns the table and exports
`placePayoutHold`/`releasePayoutHold` for it. Both take the same per-user advisory lock that
`executePayout` takes, so a hold and a payout cannot interleave.

## Database guards (`0048`, hand-written below the generated part)

- `ledger.guard_payout()`: identity, amounts, reference and the initiated journal never change; status
  only moves forward (`REQUESTED → PROCESSING → SUCCEEDED | FAILED | REVERSED | NEEDS_REVIEW`,
  `SUCCEEDED → REVERSED`); a journal reference is set once. SQLSTATE `KT013`.
- Payout and account rows are never deleted (`ledger.reject_delete()`).
- CHECKs: the transfer amount is the amount minus the fee and positive; the reference is
  `payout-<id>`; each terminal status carries its journal; an auto-immediate payout names its source
  journal (unique), a sweep payout its sweep key (unique).

## Steps (each committed when green)

1. Plan (this file).
2. Schema and migration `0048`, lock and invariants updated; schema integration tests.
3. Pure domain (`domain/payouts.ts`): journal lines per outcome, sweep due-ness by Lagos date, the
   transfer-status mapping, preference validation. Unit tests first.
4. `snapshotPayoutFee` in config; `verifyTransfer` in the Paystack client (stub-server test).
5. Repositories and `payoutAccount`, `payoutPreference`, `payout` services; integration tests including
   concurrent withdrawals against one balance.
6. Jobs: verify account, dispatch, verify payout, the two sweeps; webhook ingest for `transfer.*`.
7. Routes under `/me/payout-accounts`, `/me/payout-preferences`, `/me/payouts`, plus `/payouts/banks`.
8. `api-client` contracts (`payouts.ts`) and `shared-types` payout enums.
9. Verification: lint, typecheck, test (forced), `format:check`, `migration:safety`.

## Owner decisions (defaults applied, listed for the RUN_LOG)

1. **Which revenue account earns the payout fee.** Default: `PLATFORM_FEE_REVENUE`. A separate account
   would cost a type rebuild (T-072's note). Moot while `payout_fee` is zero.
2. **A failed or reversed payout returns the fee as well as the amount.** WF1 says nothing was lost, so
   the default refunds the whole debit to the payable.
3. **Name match for payout accounts.** T-051 matches only against a CAC business name. Default: the
   account name is always the provider-resolved one (never typed); a T-051 `MISMATCH` on record for
   that account refuses it; an `EXACT` or `FUZZY_MATCH` is linked as `name_match_ref`; no record (every
   casual seller) is accepted on the provider's resolution alone. M6 §1 suggests matching the verified
   identity name; that needs a rule for comparing names that does not exist yet.
4. **AUTO_IMMEDIATE when the balance no longer covers the credit** (the seller withdrew in between):
   default skips, logged; no partial payout.
5. **Sweep time:** 09:00 Africa/Lagos, a working-hours slot after the 03:15 bank-list refresh.
6. **Minimum and maximum payout:** none beyond "more than the fee". Paystack's own transfer limits
   apply at the provider.
7. **A hold found at dispatch** reverses the payout, returning the money to the available balance,
   rather than leaving it queued indefinitely.
8. **Suspended or closed users:** no gate here beyond the hold table; a `FULL_FREEZE` is how risk
   stops one.
