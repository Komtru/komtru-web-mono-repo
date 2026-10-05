# Epic 08 — Payments, escrow and ledger (M8 + m8 plan)

Decisions C4, C5, C8, C10, C11 (design §5). The ledger is authoritative; Paystack is checked against it, never the reverse.

---

### T-070 — Double-entry ledger core

- **Touches:** `src/modules/ledger/domain/journal.ts`, `ledger/infrastructure/postgres/**`, migration `ledger_core`
- **Depends on:** T-021, T-024
- **Acceptance criteria:**
  - Accounts per M8 §4 plus `BUYER_PROTECTION_FEE_REVENUE`. No Park accounts exist; the Park handling fee is cash between buyer and agent (design C23).
  - `postJournal(tx, entries)` rejects unbalanced entries; a deferred constraint trigger enforces balance at commit as well (both tested).
  - `ledger_entries` and journals append-only by trigger and grants; corrections are reversing journals.
  - Money is `bigint` kobo end to end; property tests on random balanced and unbalanced sets.
  - Balance queries per account and per owner, paginated history.

### T-071 — Provider adapter and Paystack

- **Touches:** `ledger/domain/providerAdapter.ts`, `ledger/infrastructure/providers/paystack/**`, `ledger/infrastructure/providerRegistry.ts`
- **Depends on:** T-028
- **Cannibalized:** `ledger/domain/providerAdapter.ts`, `paystack/client.ts`, `paystack/webhook.ts` (T-001)
- **Acceptance criteria:**
  - m8 §3 interface verbatim; registry with `providerForNewCharge()`; nothing imports the Paystack client except through the registry and jobs.
  - Webhook signature: HMAC-SHA512 of the raw body, fails closed without a secret, length-safe compare; fresh fixture tests with real signatures.
  - Bank list cached by a scheduled job; name resolution as a job.
  - No Subaccounts, Splits or Dedicated Virtual Accounts anywhere (a grep test guards the codebase).

### T-072 — Funding a trade

- **Touches:** `ledger/services/{charge,webhookIngest}.service.ts`, `ledger/http/{routes,webhookRoutes}.ts`
- **Depends on:** T-070, T-071, T-060, T-047
- **Acceptance criteria:**
  - `POST /trades/:code/payment/initiate` creates a `payment_attempts` row with our reference and the total (item price plus the buyer protection fee snapshotted on the trade, T-047) and returns what Paystack Inline needs; card, USSD and pay-with-transfer channels (V1, V2; decision C8).
  - `POST /webhooks/paystack` reads the raw body, verifies the signature, inserts into `payment_provider_webhooks` (unique per provider event) before anything else, returns 200 fast, and hands off to a job.
  - The job re-verifies via the transaction verify call, then posts: debit escrow pool, credit trade escrow liability (item) and fee liability; publishes `payment.escrow_funded`. Replayed webhooks never double-post (test).
  - Verifying and not-confirmed states (AB3, AB4) are derivable from `payment_attempts`.
  - Stock reservation event emitted for merchant (T-056).

### T-073 — Payout accounts, preferences and payouts

- **Touches:** `ledger/services/{payoutAccount,payoutPreference,payout}.service.ts`, `ledger/jobs/**`
- **Depends on:** T-072, T-051
- **Acceptance criteria:**
  - `payout_accounts` owned by users only, encrypted account number, masked display, provider recipient id, name-match reference from T-051, one default per owner.
  - `payout_preferences` modes `MANUAL`, `AUTO_IMMEDIATE`, `AUTO_DAILY`, `AUTO_WEEKLY` (Monday), `AUTO_MONTHLY` (1st), rejecting non-manual modes without a verified account.
  - `executePayout` is the only caller of `initiateTransfer`; it deducts `payout_fee` from the fee file (zero by default) as a separate journal line; manual withdraw (AB5), auto-immediate listener, and the daily sweep job (the scheduler exists from T-023, so the m8 plan's deferred sweep ships now).
  - Ledger: payable to settlement clearing on initiation, clearing to escrow pool on success, reversal on failure or reversal webhook; failed withdrawals surface for WF1; receipts for PR1.
  - Payout holds from risk (`PAYOUT_HOLD`) block execution.

### T-074 — Release and settlement

- **Touches:** `ledger/services/release.service.ts`
- **Depends on:** T-072
- **Acceptance criteria:**
  - On `trade.completed`: debit trade escrow liability, credit seller payable (item price minus the snapshotted seller or merchant commission), recognise the protection fee and any commission as revenue; publish `payment.escrow_released`. All amounts come from the trade's fee snapshot, never the live file.
  - On dispute resolution with amounts (T-080): split release and refund in one journal; amounts must sum to the escrowed item amount (second check after M3's trigger).
  - Holds on the trade block release (test).

### T-075 — Refunds

- **Touches:** `ledger/services/refund.service.ts`, `ledger/jobs/refund.job.ts`
- **Depends on:** T-072
- **Acceptance criteria:**
  - Refund API against the original charge reference, never client-supplied; full or partial; cumulative refunds per charge never exceed the charge (DB-backed guard, tested under concurrency).
  - Ledger posts the decision immediately; provider execution and `refund.*` webhooks resolve status; `refund.failed` returns the money to the platform's balance in the ledger.
  - Protection fee refund policy from the fee file's `refundable_on_full_refund`, read from the trade's snapshot.

### T-076 — Chargebacks, reconciliation and settlement operations

- **Touches:** `ledger/services/{chargeback,reconciliation}.service.ts`, `ledger/http/admin.controller.ts`
- **Depends on:** T-074, T-075, T-107
- **Acceptance criteria:**
  - Chargebacks per M8 §7 with a risk signal and a `PAYMENT_EXCEPTION` case.
  - Daily reconciliation job compares the escrow pool against provider settlements and records discrepancies; nothing auto-corrects.
  - Admin endpoints backing P0-06: protected total, pending release, refunds, exceptions, reconciliation runs; retry payout; refund approvals above a threshold through dual approval. All paginated and permission-gated.

### T-077 — Komtru Wallet top-up

- **Status:** Blocked on design §12 Q3
- **Depends on:** T-070
- **Acceptance criteria (default if Q3 is unanswered):** no wallet ledger; the AB7 screen ships in T-131 behind a disabled feature flag with no money movement. If the owner approves a wallet, this ticket is re-scoped with a `USER_WALLET` liability account and a licensing note before work starts.
