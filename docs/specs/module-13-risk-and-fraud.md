# Kumtru — Module 13: Risk & Fraud

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

This module is the counterpart to Reputation (M12) that looks forward instead of backward. M12 answers "based on their history, do they follow through?" M13 answers "based on everything happening right now, is something wrong?" — session anomalies from M1, payment failures and chargebacks from M8, dispute-fault patterns from M12, repeated KYC rejection from M6. None of those modules decide what to do about a risk signal; they just emit it. This module is where the signals converge, get scored, and where — when the score crosses a line — a hold gets placed or a human gets a case to review.

The line this module draws deliberately: **flag and hold, don't silently ban.** Automated permanent account termination based on a score is not something v1 does (§2 D1) — a wrongly-flagged legitimate seller who gets silently and permanently locked out is a worse outcome than a fraud case that takes a day longer to resolve because a human looked at it.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Risk signals | Raw events ingested from other modules (login anomalies, payment failures, velocity) |
| Risk profile | A per-user aggregate score, computed from signals |
| Rules engine | Data-driven threshold rules (v1: simple conditions, not ML) that fire on signals |
| Restrictions | Trade holds, payout holds, full account freeze — time-boxed, reviewable |
| Fraud review queue | Human review case, same shape as M6's `kyc_review_queue` |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Trust & Verification (M6) | The actual identity check — M13 reads its duplicate-identity flags and rejection counts as signals |
| Payment & Ledger (M8) | Executing a payout — M13 only requests a hold; M8 enforces it before disbursing |
| Trade Management (M7) | Executing a trade state transition — M13 only requests a hold; M7 checks it as an eligibility gate, same pattern as its existing gate table (M7 §5) |
| Disputes (M3) | The financial dispute decision — a fraud case can escalate into one, same explicit-handoff pattern as M10 §5 |

> **Boundary note:** a risk signal is a fact ("this device has 4 accounts on it," "this card was declined 3 times in an hour"). A restriction is a decision made from facts. A dispute is a financial outcome. Keeping these three as separate objects — never collapsing "suspicious" straight into "banned" — is what keeps this module auditable when a false positive gets challenged, which will happen.

---

## 2. Core design decisions

### D1 — No fully automated permanent restriction in v1

Rules can auto-apply a *temporary, time-boxed* hold (e.g. `PAYOUT_HOLD` for 24h pending review) but never an indefinite `FULL_FREEZE` — that always requires a human decision recorded against `fraud_review_queue`. The exception is a hard blocklist match (sanctioned entity, previously confirmed fraud device fingerprint) — even then, the account is frozen pending review, not silently deleted.

### D2 — Every restriction traces to a rule or a reviewer, never to nothing

`account_restrictions.source_type` is `RULE` or `REVIEWER`, with the corresponding `source_id` populated. Mirrors M10's D1 and M11's D1 — the same discipline applied a third time: nothing punitive happens without an answer to "why."

### D3 — Rules are data, not code

`risk_rules` holds condition descriptions and thresholds as configuration, following M11's D5 pattern for templates. v1 rules are simple threshold checks evaluated in application code against `risk_signals` counts (e.g. "3+ `PAYMENT_DECLINED` signals for one user within 1 hour") — a real rules-engine DSL is future work, not a v1 requirement.

### D4 — The risk score is a routing signal, not a public number

Unlike M12's reputation score, `risk_profiles.score` is never shown to the scored user or any other user. It exists purely to prioritize the review queue and to gate the automated temporary holds in D1. Showing a risk score to the person it's about just teaches them what to change to evade it.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS risk;
SET search_path TO risk, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE restriction_type AS ENUM (
  'TRADE_HOLD', 'PAYOUT_HOLD', 'FULL_FREEZE'
);

CREATE TYPE restriction_source AS ENUM ('RULE', 'REVIEWER');

CREATE TYPE review_case_status AS ENUM (
  'OPEN', 'IN_REVIEW', 'CLEARED', 'CONFIRMED_FRAUD', 'ESCALATED'
);
```

### 3.2 Signals (append-only)

```sql
CREATE TABLE risk_signals (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  user_id       uuid NOT NULL,
  signal_type   text NOT NULL,   -- 'LOGIN_NEW_DEVICE_HIGH_VELOCITY'|'PAYMENT_DECLINED'|...
  source_event  text NOT NULL,   -- the domain event this was derived from
  detail        jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX risk_signals_user_idx ON risk_signals (user_id, occurred_at DESC);
CREATE INDEX risk_signals_type_idx ON risk_signals (signal_type, occurred_at DESC);
```

### 3.3 Risk profile

```sql
CREATE TABLE risk_profiles (
  user_id                uuid PRIMARY KEY,   -- soft ref to identity.users(id)
  score                  numeric(5,2) NOT NULL DEFAULT 0,   -- D4: internal only
  signal_count_30d        integer NOT NULL DEFAULT 0,
  last_recalculated_at    timestamptz NOT NULL DEFAULT now()
);
```

### 3.4 Rules (data, D3)

```sql
CREATE TABLE risk_rules (
  code            text PRIMARY KEY,   -- 'VELOCITY_PAYMENT_DECLINE'
  description     text NOT NULL,
  signal_type     text NOT NULL,
  window_minutes  integer NOT NULL,
  threshold_count integer NOT NULL,
  action_type     restriction_type NOT NULL,
  action_hours    integer NOT NULL,   -- how long the auto-applied hold lasts, D1
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE risk_rule_triggers (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  rule_code    text NOT NULL REFERENCES risk_rules(code),
  user_id      uuid NOT NULL,
  matched_signal_ids bigint[] NOT NULL
);

CREATE INDEX risk_rule_triggers_user_idx ON risk_rule_triggers (user_id, occurred_at DESC);
```

### 3.5 Restrictions

```sql
CREATE TABLE account_restrictions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  type           restriction_type NOT NULL,
  source_type    restriction_source NOT NULL,   -- D2
  source_id      text NOT NULL,   -- rule code or reviewer_id
  reason         text NOT NULL,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,   -- null = indefinite, only valid for REVIEWER-sourced
  lifted_at      timestamptz,
  lifted_by      uuid,

  CONSTRAINT restrictions_rule_must_expire
    CHECK (source_type <> 'RULE' OR expires_at IS NOT NULL)   -- D1
);

CREATE INDEX account_restrictions_user_active_idx
  ON account_restrictions (user_id) WHERE lifted_at IS NULL;
```

### 3.6 Fraud review queue (same shape as M6's kyc_review_queue)

```sql
CREATE TABLE fraud_review_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  status           review_case_status NOT NULL DEFAULT 'OPEN',
  opened_reason    text NOT NULL,
  triggered_by     text NOT NULL,   -- rule code or 'MANUAL'
  assigned_reviewer_id uuid,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution_notes text
);

CREATE INDEX fraud_review_queue_status_idx ON fraud_review_queue (status)
  WHERE status IN ('OPEN', 'IN_REVIEW');
```

---

## 4. Signal-to-restriction flow

```
Domain event (M1 login, M7 trade, M8 payment/chargeback, M6 rejection, M12 dispute-fault)
        │
        ▼
  risk_signals row inserted
        │
        ▼
  matching active risk_rules evaluated (window + threshold)
        │
   threshold met? ──NO──▶ recalculate risk_profiles.score, stop
        │
       YES
        │
        ▼
  risk_rule_triggers row inserted
        │
        ▼
  auto-apply time-boxed restriction (D1) — account_restrictions row,
  source_type = 'RULE', expires_at = now() + action_hours
        │
        ▼
  open fraud_review_queue case (status = OPEN, triggered_by = rule code)
        │
        ▼
  reviewer resolves: CLEARED (restriction lifted early) |
  CONFIRMED_FRAUD (reviewer applies indefinite restriction, D1) |
  ESCALATED (→ M3 dispute or M10 ticket, explicit handoff)
```

---

## 5. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `risk.signal_recorded` | userId, signalType | (internal, drives §4) |
| `risk.rule_triggered` | userId, ruleCode | Fraud review queue, Ops alerting |
| `risk.restriction_applied` | userId, type, sourceType, expiresAt | M7 (trade gate), M8 (payout gate), Notifications |
| `risk.restriction_lifted` | userId, type | M7, M8, Notifications |
| `risk.case_resolved` | userId, caseId, outcome | Reputation (M12, informational), Audit |

## 6. Events consumed

| Event (from) | Signal type recorded |
|---|---|
| `identity.session.reuse_detected` (M1) | `SESSION_REUSE` |
| `verification.level_revoked` (M6) | `KYC_REJECTED` |
| `payment.failed` / chargeback events (M8) | `PAYMENT_DECLINED` / `CHARGEBACK` |
| `trade.cancelled` (M7), high frequency | `CANCELLATION_VELOCITY` |
| `dispute.resolved` at-fault (M3, via M12) | `DISPUTE_FAULT` |

---

## 7. API surface

```
GET    /admin/risk/queue                    fraud_review_queue, filterable by status
POST   /admin/risk/queue/:id/assign
POST   /admin/risk/queue/:id/resolve        CLEARED | CONFIRMED_FRAUD | ESCALATED
POST   /admin/users/:id/restrictions        manual restriction (REVIEWER-sourced)
DELETE /admin/users/:id/restrictions/:id    lift early

# Internal, called by M7/M8 before allowing a state transition / payout
GET    /internal/risk/users/:id/active-restrictions
```

---

## 8. What I would specify next

Continuing M1 §20's list: **Merchant Management (M5)**, then **Logistics (M2)** and **Disputes (M3, full depth)** — the trio the seed blueprint groups as the remaining marketplace-mechanics modules.
