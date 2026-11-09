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
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-070-ledger-core.md`. The `ledger` schema holds `ledger_accounts`, `ledger_journal_entries` and `ledger_entries`, all three append-only via `appendOnly()` (migration `0018`). **The balance invariant is the database's, not a service's:** `ledger.assert_journal_balanced(uuid)` runs from two `DEFERRABLE INITIALLY DEFERRED` constraint triggers, one on each table (migration `0017`), raising `KT010` when a posting's debits differ from its credits or its line count differs from the `line_count` it declared, and `KT011` when a line's account is in another currency. `line_count` is what closes the line set — without it a later transaction could append a balanced pair to a posting that committed last week and the journal would still balance. Verified against a real Postgres rather than asserted: savepoint rollbacks, `SET CONSTRAINTS ALL IMMEDIATE` queue draining, `COPY`, `MERGE`, multi-row `INSERT … SELECT`, upserts, and `REPEATABLE READ`/`SERIALIZABLE` all fail closed. `ON CONFLICT … DO UPDATE` does **not** fire an AFTER INSERT trigger, so migration `0018` is load-bearing for the invariant and not merely an audit nicety; a regression test pins that coupling. **Account identity** is `account_key`, a `GENERATED ALWAYS … STORED` column (`NGN:USER_PAYABLE:<uuid>`) that no caller can write, with one UNIQUE index and a total `CASE` CHECK pinning which scope column each type carries; `resolveAccountId` is `ON CONFLICT DO NOTHING` plus a read, never a check-then-insert. The TypeScript `accountKey()` normalises its ref through `accountRefSchema` first, so an upper-case uuid out of a path parameter names the same account instead of reporting a confident zero balance. **Idempotency** is `idempotency_key`, NOT NULL UNIQUE with a namespace-shape CHECK; a replay returns the original posting with `posted: false`, and throws `IdempotencyKeyConflictError` if the replay's currency, line count or line multiset differs from what was originally posted. **Balances are never materialised** (design §5, conflict C5): `accountBalance`, `ownerBalances` and `trialBalance` are `SUM` aggregates over `ledger_entries`, so they cannot drift from the journal. **Deviation from M8 §5:** `SETTLEMENT_CLEARING` is credit-normal, not the "Asset (transitional)" §5's table calls it — §4's own postings credit it on payout initiation and debit it on confirmation, with `PLATFORM_ESCROW_POOL` credited only at confirmation, so between those two postings the cash has not left and the balance is an in-flight obligation. Classified from the postings, not from the table; **T-073 and T-074 must post it as a liability.** Three migrations: `0016_ledger_core` (drizzle-generated, nothing hand-written, so it regenerates from the schema `.ts` safely), `0017_ledger_balance_invariant` and `0018_ledger_append_only` (both `--custom`). **For T-071/T-072/T-074/T-075:** `postJournal(tx, input)` is the only way to write money and `idempotencyKey` is required — namespace it by the thing being replayed, not the attempt (`charge:<providerReference>`, `trade:<id>:release`, `payout:<id>:initiated`), and a webhook replay must reuse the key its first delivery used. Call it with the caller's own `tx` and `publish(tx, …)` the module's own event in that same transaction. Fees are never computed here: hand `postJournal` already-computed kobo from the trade's snapshot (design §6.5, T-047's `computeTradeFees`/`snapshotFees`) — no rate, cap or floor appears anywhere in the module. The `payment_provider` enum (`PAYSTACK`, `FLUTTERWAVE`) is declared in `0016` under the `ledger` schema; T-071 and T-072 import it from the barrel rather than declaring a second one.
- **Deferred:** No HTTP routes — T-072 adds them and registers the module in `src/modules/index.ts` (the ledger is a barrel only for now, as identity was before T-031). No reversal/correction helper: corrections are reversing journal entries, proven by test, and a named helper belongs with T-076's reconciliation. `trialBalance` scans `ledger_entries`; it is a reconciliation-time query, and T-076 owns making it incremental if volume demands it. No materialised balances — if the `SUM` ever becomes too slow the replacement is a rollup maintained by a trigger in the same transaction as the insert plus a job that recomputes it from the journal and alerts on a difference, never a column a service writes. A read-only `ledger.account_balances` view was considered and dropped: `grantRuntimeAccess()` only grants on `relkind IN ('r','p')`, so `komtru_app` would have had no `SELECT` on it — **that gap is worth closing on the platform side before any module ships a view.** Adding an account type later is a table rewrite, because the `account_key` generation expression must change and `ALTER COLUMN … SET EXPRESSION` is PG 18: T-077's `USER_WALLET`, if the owner approves it, should budget for that. The `idempotency_key` length is bounded in zod (200) but not by a DB CHECK.

### T-071 — Provider adapter and Paystack

- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-071-paystack.md`. The interface is m8 §3 verbatim; the Paystack implementation is split so `client.ts` holds every network call and is importable only from `ledger/jobs/`, while signature verification and payload parsing are pure siblings a request handler may call. `providerRegistry.ts` takes its adapters as an argument and `jobs/providers.ts` is the one file that imports the client, which keeps the registry the single lookup point without making it a provider client. The webhook route gets the exact bytes from an `express.json({ verify })` hook scoped to `/v1/webhooks/` (`platform/http/raw-body.ts`); nothing else about body parsing changes. `ModuleContext` gained `config`, `logger` and `redis`, because the platform reads a module's `queues` and `schedules` before calling `start`.
- **Deferred:** the webhook route itself, `payment_attempts` and webhook ingest (T-072); payout accounts, preferences and payouts (T-073); the ledger tables and `postJournal` (T-070); the socket push that delivers a resolved bank name to the browser (T-051) — the job returns the name and T-051/T-073 decide where it lands. `verifyCharge` is exported for T-072's re-check but is deliberately not an adapter method. OTP must be disabled on the Paystack integration (`POST /transfer/disable_otp` + `/disable_otp_finalize`) before any transfer succeeds: a one-time runbook step, not application code. Nothing here has run against a live Paystack account; every test runs against a local stub server, so the documented request and response shapes are unproven until the first real call — confirm the bank list's `use_cursor` paging and the refund payload field names first. Note for T-072: `parseWebhookEvent` throws `ApiError(400)` for a malformed payload, and m8 §8 still requires the route to answer Paystack 200 quickly, so catch it, record the delivery and return 200 rather than letting the status reach the provider.
- **Touches:** `ledger/domain/providerAdapter.ts`, `ledger/infrastructure/providers/paystack/**`, `ledger/infrastructure/providerRegistry.ts`
- **Depends on:** T-028
- **Cannibalized:** `ledger/domain/providerAdapter.ts`, `paystack/client.ts`, `paystack/webhook.ts` (T-001)
- **Acceptance criteria:**
  - m8 §3 interface verbatim; registry with `providerForNewCharge()`; nothing imports the Paystack client except through the registry and jobs.
  - Webhook signature: HMAC-SHA512 of the raw body, fails closed without a secret, length-safe compare; fresh fixture tests with real signatures.
  - Bank list cached by a scheduled job; name resolution as a job.
  - No Subaccounts, Splits or Dedicated Virtual Accounts anywhere (a grep test guards the codebase).
  - **T-028:** the network-calling file is `ledger/infrastructure/providers/paystack/client.ts`, importable only from `ledger/jobs/` (`komtru/provider-clients`); webhook verification and payload parsing stay in pure sibling files, and every request goes through `providerRequest`.

### T-072 — Funding a trade

- **Touches:** `ledger/services/{charge,webhookIngest}.service.ts`, `ledger/http/{routes,webhookRoutes}.ts`
- **Depends on:** T-070, T-071, T-060, T-047
- **Acceptance criteria:**
  - `POST /trades/:code/payment/initiate` creates a `payment_attempts` row with our reference and the total (item price plus the buyer protection fee snapshotted on the trade, T-047) and returns what Paystack Inline needs; card, USSD and pay-with-transfer channels (V1, V2; decision C8).
  - `POST /webhooks/paystack` reads the raw body, verifies the signature, inserts into `payment_provider_webhooks` (unique per provider event) before anything else, returns 200 fast, and hands off to a job.
  - The job re-verifies via the transaction verify call, then posts: debit escrow pool, credit trade escrow liability (item) and fee liability; publishes `payment.escrow_funded`. Replayed webhooks never double-post (test).
  - Verifying and not-confirmed states (AB3, AB4) are derivable from `payment_attempts`.
  - Stock reservation event emitted for merchant (T-056).
- **Build note (not a status line — the index owns those):** built on `t-072-funding`, not yet merged. Plan: `docs/superpowers/plans/2026-11-07-t-072-funding.md`, which lists every owner decision. **Decision 1 is settled: the buyer protection fee has its own account.** Funding posts three lines — debit `PLATFORM_ESCROW_POOL` the item plus the fee, credit `USER_ESCROW_LIABILITY<trade>` the item, credit `BUYER_PROTECTION_FEE_LIABILITY<trade>` the fee (no fee line when the fee is zero; a ledger line is strictly positive). The point of the second account is that the trade's escrow liability balance is then **exactly what the buyer could get back on the item**, so the refundable figure is read off the ledger rather than recomputed by subtracting T-047's fee snapshot in three different services. `BUYER_PROTECTION_FEE_LIABILITY` is credit-normal and scoped by trade, like the escrow liability it sits beside. Migrations: `0043_ledger_payments` (the attempt and webhook tables) and `0044_ledger_fee_liability_account` (the chart change).
- **For T-074:** at release, **debit `BUYER_PROTECTION_FEE_LIABILITY<trade>` and credit `BUYER_PROTECTION_FEE_REVENUE`** for the whole snapshotted fee, in the same journal as the item release. That is the only place the fee becomes revenue; it is unearned until then. The escrow liability holds the item alone, so the release debit against it is the item amount, not the buyer total.
- **For T-075:** `refundable_on_full_refund` from the trade's fee snapshot decides whether a refund **also reverses the fee liability** (debit `BUYER_PROTECTION_FEE_LIABILITY<trade>`, credit the pool, alongside the item reversal) or leaves it standing for T-074 to recognise. Either way the fee is a balance to be discharged, never a number to subtract: a trade whose fee liability is still non-zero after it ends is a reconciliation finding.
- **Adding the account type cost a table rewrite, as T-070 warned, and not in the shape T-070 expected.** `ALTER TYPE ... ADD VALUE` is legal inside a transaction but the value it adds cannot be _used_ until that transaction commits, and the drizzle migrator runs every pending migration in one — so extending `ledger_account_type` in place does not run at all, in any number of migration files. `0044` rebuilds the type instead (rename away, `CREATE TYPE` with the full label set, retype the column through text, drop the old one) and then drops and re-adds the generated `account_key` column. Dropping that column drops `ledger_accounts_key_unique` with it and drizzle's own generated output never puts it back, which would have left account identity unenforced; the migration recreates it explicitly. **T-077's `USER_WALLET` should budget for this exact sequence**, not for the simpler `ADD VALUE` the earlier note implied.
- **Status (2026-11-07): in progress** — implement, review and fix done (branch `t-072-funding`, 8 commits, migration 0040 `ledger_payments`, backend 3121 unit and 359 ledger infra tests green; plan `docs/superpowers/plans/2026-11-07-t-072-funding.md`); next: merge once the owner decides where the buyer protection fee sits between funding and release (default: a second credit line on the trade escrow liability); open review items: none (4 must-fix and 6 should-fix fixed).

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
  - Recognising the protection fee is **debit `BUYER_PROTECTION_FEE_LIABILITY<trade>`, credit `BUYER_PROTECTION_FEE_REVENUE`** (T-072). The escrow liability holds the item amount only, so the release debit against it is the item, not the buyer total.
  - On dispute resolution with amounts (T-080): split release and refund in one journal; amounts must sum to the escrowed item amount (second check after M3's trigger).
  - Holds on the trade block release (test).

### T-075 — Refunds

- **Touches:** `ledger/services/refund.service.ts`, `ledger/jobs/refund.job.ts`
- **Depends on:** T-072
- **Acceptance criteria:**
  - Refund API against the original charge reference, never client-supplied; full or partial; cumulative refunds per charge never exceed the charge (DB-backed guard, tested under concurrency).
  - Ledger posts the decision immediately; provider execution and `refund.*` webhooks resolve status; `refund.failed` returns the money to the platform's balance in the ledger.
  - Protection fee refund policy from the fee file's `refundable_on_full_refund`, read from the trade's snapshot. It decides whether the refund **also reverses `BUYER_PROTECTION_FEE_LIABILITY<trade>`** (T-072) or leaves it for T-074 to recognise as revenue; the fee is a balance to discharge, not a number to subtract from the item.

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
