# Kumtru — Module 8: Payment, Escrow & Ledger

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Per M1 §20 and M7 §10, this is the third module in the priority chain and the one where a design mistake is most expensive to unwind — it's the only module in the platform that touches real money. Trade Management (M7) already assumes this module exists: it emits escrow action requests and expects ledger truth back. This document is that other half.

One rule above all others: **this module's own ledger is authoritative, not the payment provider's.** Paystack or Flutterwave's dashboard is a useful cross-check, never the source of truth for "what does Kumtru owe whom." See D1.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Double-entry ledger | The chart of accounts and every journal entry Kumtru posts |
| Payment collection | Buyer funding a trade via a provider adapter |
| Escrow holding | Representing held-but-unreleased funds as a liability, not a bank balance |
| Settlement / payout | Moving released funds to a seller's verified bank account |
| Refunds, partial refunds | Reversing a hold back to the buyer |
| Chargeback handling | Provider-side reversals and how they reconcile against Kumtru's ledger |
| Payout accounts | Seller bank account storage — the record M6's bank-name-match verifies against |
| Reconciliation | Comparing Kumtru's ledger against provider statements |
| Webhook idempotency | Provider webhook dedup and signature verification |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Trade Management (M7) | The state machine, when a trade is eligible to fund/complete/dispute |
| Trust & Verification (M6) | Bank-account **name-match** verification — M8 stores the account and pays it; M6 already confirmed the name on it matches the verified identity |
| Disputes (M3) | The dispute decision itself — M8 only executes the resulting refund or release once M3 decides |
| Reporting & Analytics (M16) | GMV, revenue dashboards — M8 is the source of truth those are computed from, not the reporting layer itself |

> **Boundary note on M7 vs. M8, restated because it's the one that matters most:** a trade's *state* (M7) and the *money* backing it (M8) are two different systems that agree only through events. M7 never writes a ledger entry. M8 never transitions a trade's status. If you find code in one module directly touching the other's tables, the module boundary has already failed.

---

## 2. Why there's no shortcut here

Researched specifically for this module: neither Paystack nor Flutterwave — the two dominant Nigerian payment processors — offer a native escrow or conditional-hold product. Both are collect-now/payout-later infrastructure: a standard checkout charge, and a separate Transfers API to pay someone out later. Their "Split Payments"/"Subaccounts" features split a payment *instantly at checkout*, which is the wrong primitive for escrow (the seller's cut shouldn't be determined and paid until the buyer confirms delivery, which is often days later). Practically: **Kumtru has to build the hold/escrow logic itself, on top of ordinary collections and transfers.** This isn't a corner someone cut — it's the actual state of Nigerian payment infrastructure in 2026, and it's exactly why the seed architecture doc's instinct — "Kumtru needs its own internal double-entry ledger" — was correct rather than optional.

One considered-and-rejected alternative worth naming: Nigeria has a couple of escrow-specific services (AtaraPay, EscrowPay) that could theoretically be integrated instead of building this ledger. Rejected because Kumtru's business *is* being a trust-and-escrow platform — outsourcing the escrow mechanism to a third party would mean outsourcing the part of the product Kumtru is actually differentiated on, plus taking on their fee structure and their outage risk as Kumtru's own.

---

## 3. Core design decisions

### D1 — Kumtru's ledger is authoritative

The provider (Paystack/Flutterwave) tells Kumtru "a payment of ₦50,000 succeeded" or "a transfer completed." Kumtru's own double-entry ledger is what answers "what does Kumtru owe the seller on trade KMT-92831 right now." These can and will drift apart briefly (a webhook delayed, a transfer still processing) — reconciliation (§8) exists specifically to catch and resolve that drift. The ledger is never rebuilt *from* the provider's records; it's checked *against* them.

### D2 — Every entry is part of a balanced journal entry, and nothing is ever mutated

Standard double-entry discipline: a `ledger_journal_entries` row groups two or more `ledger_entries` rows whose debits equal their credits. Once posted, an entry is never updated or deleted — a correction is a new, reversing journal entry, same as M1's audit log and M6's verification log are append-only. This is non-negotiable specifically here: an editable ledger is not a ledger.

### D3 — Provider adapter, Paystack primary, Flutterwave secondary

Same swappable-adapter pattern as M2 (logistics) and M6 (KYC): a `PaymentProviderAdapter` interface (`initiateCharge`, `verifyCharge`, `initiateTransfer`, `verifyTransfer`) with one implementation per provider. Paystack as the primary integration — well-documented, dominant in the Nigerian consumer market. Flutterwave wired in as a secondary adapter from day one so a Paystack outage or a pricing change doesn't strand payouts platform-wide. Split Payments/Subaccounts on either provider are explicitly **not used** for the escrow leg, per §2 — if a platform fee needs to be visible to the buyer at checkout, it's computed and displayed by Kumtru, then posted as an ordinary ledger entry at settlement time, not carved off by the provider mid-trade.

### D4 — Webhook idempotency is Kumtru's job, not the provider's

Paystack retries undelivered webhooks for up to 72 hours; Flutterwave explicitly documents that duplicate deliveries can happen and tells integrators to handle it themselves. Neither provider offers a dependable idempotency key. Every inbound webhook is logged to `payment_provider_webhooks` with a unique constraint on `(provider, provider_event_id)` before any processing happens — a replayed webhook hits the unique constraint, gets logged as a duplicate, and triggers no second ledger entry.

### D5 — Money is always a `bigint` in kobo, never a float

Same rule M7 already established for `amount_minor`. Restated here because it matters twice as much in the module that actually moves money: a floating-point rounding error in a ledger is a future reconciliation nightmare, not a cosmetic bug.

### D6 — M8 never touches M7's tables, and M7 never touches M8's

Coordination happens only through the event bus (Module 0 §4), matching the boundary M7 §2/D6 already committed to. M7 emits `trade.funded`; M8's handler posts the ledger entries and emits `payment.escrow_funded` back; M7's handler marks its own `escrow_action_requests` row complete. Neither module ever reaches into the other's schema directly, even though both live in the same physical database at this stage.

---

## 4. Chart of accounts and how a trade flows through it

| Account type | Nature | Scope |
|---|---|---|
| `PLATFORM_ESCROW_POOL` | Asset | One row — represents actual cash sitting in Kumtru's provider balance |
| `USER_ESCROW_LIABILITY` | Liability | One per trade — what Kumtru owes *into escrow* for that trade until it's released or refunded |
| `USER_PAYABLE` | Liability | One per seller — released funds owed to them, not yet paid out |
| `PLATFORM_FEE_REVENUE` | Revenue | One row — Kumtru's earned commission |
| `SETTLEMENT_CLEARING` | Asset (transitional) | One per in-flight payout — money that's left `USER_PAYABLE` but hasn't yet been confirmed as received by the seller's bank |

**Worked example — a ₦50,000 trade, 5% platform fee:**

```
1. Buyer funds the trade (M7: trade.funded)
     DEBIT  PLATFORM_ESCROW_POOL          50,000
     CREDIT USER_ESCROW_LIABILITY(trade)    50,000

2. Trade completes (M7: trade.completed) — release
     DEBIT  USER_ESCROW_LIABILITY(trade)    50,000
     CREDIT PLATFORM_FEE_REVENUE           2,500
     CREDIT USER_PAYABLE(seller)          47,500

3. Payout batch initiated to seller's verified bank account
     DEBIT  USER_PAYABLE(seller)          47,500
     CREDIT SETTLEMENT_CLEARING(payout)   47,500

4. Provider confirms the transfer landed
     DEBIT  SETTLEMENT_CLEARING(payout)   47,500
     CREDIT PLATFORM_ESCROW_POOL          47,500
```

**Same trade, refunded instead at step 2:**

```
2. Dispute resolves REFUNDED (M3 decision, M7: trade executes refund)
     DEBIT  USER_ESCROW_LIABILITY(trade)    50,000
     CREDIT PLATFORM_ESCROW_POOL          50,000
   (provider-side refund to the buyer's original payment method is
    initiated in parallel — see §7)
```

Every debit has a matching credit in every step. This is the property `ledger_journal_entries`/`ledger_entries` enforces structurally (§5.2) — an unbalanced journal entry is a bug, not a valid state.

---

## 5. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS ledger;
SET search_path TO ledger, public;
```

### 5.1 Enumerations

```sql
CREATE TYPE ledger_account_type AS ENUM (
  'PLATFORM_ESCROW_POOL', 'USER_ESCROW_LIABILITY', 'USER_PAYABLE',
  'PLATFORM_FEE_REVENUE', 'SETTLEMENT_CLEARING'
);

CREATE TYPE ledger_entry_direction AS ENUM ('DEBIT', 'CREDIT');

CREATE TYPE payment_provider AS ENUM ('PAYSTACK', 'FLUTTERWAVE');

CREATE TYPE payment_attempt_status AS ENUM (
  'INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED'
);

CREATE TYPE payout_status AS ENUM (
  'REQUESTED', 'BATCHED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED'
);

CREATE TYPE refund_status AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TYPE chargeback_status AS ENUM ('OPEN', 'EVIDENCE_SUBMITTED', 'WON', 'LOST');
```

### 5.2 Ledger — accounts, journal entries, entries

```sql
CREATE TABLE ledger_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type    ledger_account_type NOT NULL,
  owner_user_id   uuid,     -- soft ref to identity.users(id); null for platform-level accounts
  trade_id        uuid,     -- soft ref to trade.trades(id); set for USER_ESCROW_LIABILITY
  currency        text NOT NULL DEFAULT 'NGN',
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ledger_accounts_scope CHECK (
    (account_type = 'USER_ESCROW_LIABILITY' AND trade_id IS NOT NULL)
    OR (account_type <> 'USER_ESCROW_LIABILITY')
  )
);

CREATE UNIQUE INDEX ledger_accounts_platform_singleton
  ON ledger_accounts (account_type)
  WHERE account_type IN ('PLATFORM_ESCROW_POOL', 'PLATFORM_FEE_REVENUE');
CREATE UNIQUE INDEX ledger_accounts_trade_escrow_unique
  ON ledger_accounts (trade_id) WHERE account_type = 'USER_ESCROW_LIABILITY';
CREATE INDEX ledger_accounts_owner_idx ON ledger_accounts (owner_user_id);

CREATE TABLE ledger_journal_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id                 uuid,     -- soft ref to trade.trades(id)
  escrow_action_request_id uuid,     -- soft ref to trade.escrow_action_requests(id)
  description              text NOT NULL,
  posted_at                timestamptz NOT NULL DEFAULT now(),
  created_by               text NOT NULL   -- 'SYSTEM' | admin user id as text
);

CREATE INDEX ledger_journal_entries_trade_idx
  ON ledger_journal_entries (trade_id);

CREATE TABLE ledger_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  uuid NOT NULL REFERENCES ledger_journal_entries(id),
  account_id        uuid NOT NULL REFERENCES ledger_accounts(id),
  direction         ledger_entry_direction NOT NULL,
  amount_minor      bigint NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entries_amount_positive CHECK (amount_minor > 0)
);

CREATE INDEX ledger_entries_journal_idx ON ledger_entries (journal_entry_id);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, created_at);

GRANT INSERT, SELECT ON ledger_entries TO kumtru_app;
GRANT INSERT, SELECT ON ledger_journal_entries TO kumtru_app;

CREATE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only — post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_mutate
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_immutable();

-- D2's balance invariant, checked at the application layer on every write
-- (a deferred-constraint trigger summing per-journal-entry debits/credits
-- is the stronger version — implement once write volume justifies the
-- extra per-insert cost; application-level checks are the floor, not
-- the ceiling, for this specific table).
```

### 5.3 Payment collection

```sql
CREATE TABLE payment_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id           uuid NOT NULL,   -- soft ref to trade.trades(id)
  buyer_user_id      uuid NOT NULL,
  provider           payment_provider NOT NULL,
  provider_reference text,
  amount_minor       bigint NOT NULL,
  status             payment_attempt_status NOT NULL DEFAULT 'INITIATED',
  initiated_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at       timestamptz,
  failure_reason     text
);

CREATE INDEX payment_attempts_trade_idx ON payment_attempts (trade_id);
CREATE UNIQUE INDEX payment_attempts_provider_ref
  ON payment_attempts (provider, provider_reference) WHERE provider_reference IS NOT NULL;
```

### 5.4 Webhook log (D4)

```sql
CREATE TABLE payment_provider_webhooks (
  id                bigserial PRIMARY KEY,
  provider          payment_provider NOT NULL,
  provider_event_id text NOT NULL,
  event_type        text NOT NULL,
  payload           jsonb NOT NULL,
  signature_valid   boolean NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

CREATE UNIQUE INDEX payment_provider_webhooks_dedup
  ON payment_provider_webhooks (provider, provider_event_id);
CREATE INDEX payment_provider_webhooks_unprocessed_idx
  ON payment_provider_webhooks (received_at) WHERE processed_at IS NULL;
```

### 5.5 Payout accounts and payouts

```sql
CREATE TABLE payout_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL,
  bank_code             text NOT NULL,
  account_number_masked text NOT NULL,   -- display only
  account_number_enc    bytea NOT NULL,   -- envelope-encrypted, needed for transfer calls
  verified_name          text NOT NULL,     -- from M6's bank_account_name_matches
  name_match_ref         uuid,               -- soft ref to trust.bank_account_name_matches(id)
  is_default             boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  disabled_at            timestamptz
);

CREATE INDEX payout_accounts_user_idx ON payout_accounts (user_id);
CREATE UNIQUE INDEX payout_accounts_one_default
  ON payout_accounts (user_id) WHERE is_default AND disabled_at IS NULL;

CREATE TABLE payout_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for      timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'PENDING',
  total_amount_minor bigint NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

CREATE TABLE payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  payout_account_id  uuid NOT NULL REFERENCES payout_accounts(id),
  batch_id           uuid REFERENCES payout_batches(id),
  amount_minor       bigint NOT NULL,
  provider           payment_provider NOT NULL,
  provider_reference text,
  status             payout_status NOT NULL DEFAULT 'REQUESTED',
  requested_at       timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  failure_reason     text
);

CREATE INDEX payouts_user_idx ON payouts (user_id);
CREATE INDEX payouts_batch_idx ON payouts (batch_id);
CREATE INDEX payouts_pending_idx ON payouts (status)
  WHERE status IN ('REQUESTED', 'BATCHED', 'PROCESSING');
```

### 5.6 Refunds and chargebacks

```sql
CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id           uuid NOT NULL,
  amount_minor       bigint NOT NULL,
  reason             text NOT NULL,
  status             refund_status NOT NULL DEFAULT 'REQUESTED',
  requested_by       text NOT NULL,   -- 'SYSTEM' | 'M3_DISPUTE' | admin user id
  provider_reference text,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

CREATE INDEX refunds_trade_idx ON refunds (trade_id);

CREATE TABLE chargebacks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
  provider_reference text NOT NULL,
  amount_minor       bigint NOT NULL,
  status             chargeback_status NOT NULL DEFAULT 'OPEN',
  reason             text,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);

CREATE INDEX chargebacks_payment_idx ON chargebacks (payment_attempt_id);
CREATE INDEX chargebacks_open_idx ON chargebacks (status) WHERE status = 'OPEN';
```

### 5.7 Reconciliation

```sql
CREATE TABLE reconciliation_runs (
  id                bigserial PRIMARY KEY,
  provider          payment_provider NOT NULL,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  ledger_total_minor    bigint NOT NULL,
  provider_total_minor  bigint NOT NULL,
  discrepancy_minor     bigint NOT NULL,
  run_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_discrepancies (
  id                    bigserial PRIMARY KEY,
  run_id                bigint NOT NULL REFERENCES reconciliation_runs(id),
  reference             text NOT NULL,
  ledger_amount_minor   bigint,
  provider_amount_minor bigint,
  status                text NOT NULL DEFAULT 'OPEN',
  notes                 text
);

CREATE INDEX reconciliation_discrepancies_run_idx
  ON reconciliation_discrepancies (run_id);
```

---

## 6. Payout / settlement flow

```
Trade completes (M7: trade.completed)
        │
        ▼
M8 posts the release journal entry (§4 step 2) — USER_PAYABLE credited
        │
        ▼
Seller's payout is queued (not instant, by default — see below)
        │
        ▼
Next scheduled payout_batch picks it up
        │
        ▼
For each payout in the batch: initiateTransfer() via the seller's
default payout_account, provider = Paystack (primary) or Flutterwave
(if Paystack transfers are degraded — see D3)
        │
        ▼
Provider webhook confirms transfer completed
        │
        ▼
M8 posts the settlement journal entry (§4 step 4), payout.status = COMPLETED
        │
        ▼
Emit payment.payout_completed → Notifications, Reputation
```

**Why batched, not instant-on-completion:** every individual transfer costs money (₦10-50 per Paystack's published tiers) and batching lets Kumtru pick a sane cadence (e.g. twice daily) rather than paying a transfer fee and eating provider rate limits on every single completed trade. This is a default, not a hard rule — a `payout_batches` row scheduled for "now" is a valid way to model an eventual instant-payout tier for high-trust sellers, without changing the schema.

---

## 7. Refunds and chargebacks

A refund can originate from two places: M3 resolving a dispute as `RESOLVED_REFUNDED`, or M7 executing a pre-`FUNDED` cancellation that somehow still needs a provider-side reversal (edge case: a charge succeeded at the provider but the trade's own cancel logic already fired — reconciliation, §8, is what catches this specific race). Either way, `refunds.requested_by` records which one, and the ledger entry (§4's alternate step 2) posts before the provider-side refund call goes out — the ledger reflects Kumtru's *decision* to refund immediately; the provider call reflects executing it, and can fail/retry independently without the ledger being wrong about what Kumtru owes.

A chargeback is different in kind: it's the buyer's *bank* reversing a payment outside Kumtru's control, sometimes for a trade Kumtru already released and paid out on. This is the one case where Kumtru can end up owing money it's already paid a seller. `chargebacks` tracks it as its own record rather than folding it into `refunds`, because the resolution path is different — evidence submission to the provider/card network, a WON/LOST outcome outside Kumtru's control, and if LOST, a separate ledger entry clawing the amount back (against `PLATFORM_FEE_REVENUE` if the seller's payout can't be recovered, which is a real cost-of-doing-business line item worth surfacing to Reporting, M16).

---

## 8. Reconciliation

A scheduled job (BullMQ repeatable, per Module 0 §5) runs daily: sum `ledger_entries` against `PLATFORM_ESCROW_POOL` for the period, compare against the provider's own settlement report for the same period. A discrepancy doesn't auto-correct anything — it creates a `reconciliation_discrepancies` row and routes to `FINANCE_ADMIN` (M1's RBAC role) for manual review. Auto-correcting a ledger based on an external system's numbers would violate D1 outright.

---

## 9. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `payment.escrow_funded` | tradeId, amountMinor | M7 (completes the FUND request) |
| `payment.escrow_released` | tradeId, sellerId, netAmountMinor | M7, Reputation |
| `payment.escrow_refunded` | tradeId, buyerId, amountMinor | M7, Notifications |
| `payment.payout_completed` | payoutId, userId, amountMinor | Notifications, Reputation |
| `payment.payout_failed` | payoutId, reason | Notifications, Risk (repeated failures are a signal) |
| `payment.chargeback_opened` | chargebackId, tradeId | Risk (M13, high priority), Disputes (M3), Audit |
| `payment.reconciliation_discrepancy` | runId, discrepancyMinor | Ops alerting, Audit |

---

## 10. RBAC — this module's slice of M1's baseline

M1 §12 already defines `FINANCE_ADMIN` ("Refunds, settlement, reconciliation") with dual-approval to grant. This module's permissions:

```
payment.view
payment.refund              -- financial action, routes through M1's
                             -- admin_action_approvals dual-approval
payout.view
payout.retry
reconciliation.view
reconciliation.resolve
```

---

## 11. API surface

```
POST   /trades/:id/payment/initiate     starts a payment_attempt
POST   /webhooks/paystack                       provider webhook receiver
POST   /webhooks/flutterwave                    provider webhook receiver
GET    /trades/:id/payment/status

POST   /payout-accounts                          seller adds a bank account
GET    /payout-accounts
POST   /payout-accounts/:id/set-default

# Admin / FINANCE_ADMIN surface
GET    /admin/payouts
POST   /admin/payouts/:id/retry
GET    /admin/reconciliation/runs
POST   /admin/reconciliation/discrepancies/:id/resolve
POST   /admin/refunds/:id/approve            dual-approval per M1 §5.7
```

Webhook endpoints are the one place in this module that accepts unauthenticated-by-session traffic — they're authenticated by provider signature verification (Paystack's `x-paystack-signature`, Flutterwave's `flutterwave-signature`) instead, checked before the payload is trusted for anything, including the dedup insert in §5.4.

---

## 12. What I would specify next

Per M1 §20 / M7 §10: **Notifications & Communications (M11)** — three modules deep (M1, M6, M7) and now this one have all accumulated notification requirements without a formal spec defining delivery guarantees, retry behavior, or channel selection between Mailjet, Termii/Africa's Talking, and FCM/APNs. It's a thin module individually, but it's been an implicit dependency of everything so far.
