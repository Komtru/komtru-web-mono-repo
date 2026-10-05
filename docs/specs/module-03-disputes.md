# Kumtru — Module 3: Disputes

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

**Depth note:** per Emmanuel's ruling on 2026-08-20, this module is specified at full implementation depth — alongside Trade Management (M7), Payment & Ledger (M8), and Trust & Verification (M6) — because a wrong decision here moves real money.

---

## 0. How to read this document

Every module written so far eventually points here. M7's state machine has a `DISPUTED → UNDER_REVIEW → RESOLVED_REFUNDED/RESOLVED_RELEASED` branch it doesn't resolve itself — this module is what drives those transitions. M8's ledger has a documented refund path it doesn't decide when to take — this module is what tells it to. M9's snapshot pricing exists specifically so a dispute evaluates against what was actually agreed, not what a listing says today. M2's provenance-tagged shipment timeline exists specifically to serve as evidence here. M10 drew an explicit, deliberate line — "a ticket is not a dispute" — and built one crossing point (`POST /tickets/:id/escalate-to-dispute`) into this module. M13 can escalate a fraud case into one. This is the module all of that converges on, so it's worth being precise about what it does and does not decide.

**What this module decides:** given a trade with money sitting in escrow and two parties who disagree about something, who gets what, and why — recorded permanently, reviewable, appealable once. **What it does not decide:** the trade's eligibility to be disputed in the first place (M7's inspection-window gates already answered that), or how the money actually moves once a decision is made (M8 executes it).

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Dispute cases | The case object — category, status, parties, linked trade |
| Evidence collection | Structured submission window, both parties, references to M20 files |
| Review and decision | Assignment to a reviewer, constrained outcome types, rationale |
| Appeals | One bounded appeal window, reviewed by a different, more senior role |
| Decision execution handoff | Emitting the event M7/M8 act on — never touching the ledger directly |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Trade Management (M7) | Dispute *eligibility* (the inspection-window gate, M7 §5) and the trade's own state machine — M3 drives M7's transitions via events, never writes to `trades` directly |
| Payment & Ledger (M8) | Actually moving money — M3's decision is a instruction, M8's journal entries are the execution, following the same event-only boundary M7↔M8 already established |
| Tickets (M10) | The support conversation around a dispute — M10 hosts the human back-and-forth before/around escalation; M3 hosts the financial case itself |
| File & Evidence Management (M20) | Evidence file storage — M3 stores references |
| Risk & Fraud (M13) | Whether a party's dispute-fault pattern is itself suspicious — M13 reads M3's outcomes as a signal, doesn't feed into the decision |

> **Boundary note, continuing the chain from M7 §1, M8 §2, M9 §1, M10 §1:** a dispute is the one object in this system that is simultaneously about trust (was the seller honest?), fulfillment (did the item show up?), and money (who keeps it?) — which is exactly why it's specified last and full-depth: it's the module every earlier boundary decision was drawn to keep *out of*.

---

## 2. Core design decisions

### D1 — A dispute is created through exactly one of two converging paths, never a third

**Path A — direct filing:** within M7's inspection window, a buyer or seller files a dispute, which transitions the trade to `DISPUTED` (M7's own state machine) and emits `trade.disputed`. M3 listens and creates the case.

**Path B — ticket escalation:** a support agent or the user, via M10's `POST /tickets/:id/escalate-to-dispute`, calls M3 directly to create the case, which emits `dispute.opened`; M7 listens and transitions itself into `DISPUTED` if it isn't already there.

Both paths converge on the same `disputes` row shape and the same review process — M3 never branches its logic on which door a case came through. What matters is that a dispute never exists without a trade that is, or immediately becomes, `DISPUTED` in M7's state machine; the two systems cannot disagree about whether a trade is under dispute.

### D2 — Evidence collection has a fixed window, applied equally to both parties

`disputes.evidence_deadline_at` (default: opened_at + 5 days) is the same for buyer and seller — there's no asymmetry in how long each side gets to make their case. Evidence submitted after the window requires the assigned reviewer to explicitly reopen collection (logged, not silent) rather than being auto-accepted or auto-rejected.

### D3 — The reviewer role is distinct from a support agent, and distinct from the case's own parties

`DISPUTE_REVIEWER` and `DISPUTE_LEAD` (appeals only, D5) are RBAC roles separate from `SUPPORT_AGENT`/`SUPPORT_LEAD` (M10 §7) — mirrors M10's own boundary that a ticket-handling agent facilitates but never decides a financial outcome. A reviewer can never be a party to the dispute they're deciding (enforced at the assignment layer, not just convention).

### D4 — Decision outcomes are a constrained, validated set — never a free-form amount

```
REFUND_BUYER_FULL        buyer gets 100% back
REFUND_BUYER_PARTIAL     buyer gets a specified amount, seller keeps the rest
RELEASE_SELLER_FULL      seller gets 100%, escrow releases in full
RELEASE_SELLER_PARTIAL   seller gets a specified amount, buyer gets the rest
```

A partial outcome requires both `amount_to_buyer_minor` and `amount_to_seller_minor` (kobo, per M7/M8/M9's bigint convention) and a check constraint that the two sum to the trade's total escrowed amount — a reviewer cannot submit a decision that loses or invents money. M3 validates the arithmetic; M8 is still the system of record that actually executes it and would reject a mismatched instruction independently — two checks, not one, on money movement.

### D5 — One appeal window, decided by a different and more senior reviewer

A `DECIDED` dispute has a fixed appeal window (default 7 days) during which either party may appeal once. An appeal is reviewed exclusively by `DISPUTE_LEAD` — never the original `DISPUTE_REVIEWER`, removing any incentive or ability to simply re-affirm one's own decision. After the appeal is decided (uphold or overturn), the case is `CLOSED` and final — there is no second appeal. An unappealed decision closes automatically when its window lapses.

### D6 — Every decision is permanent, append-only history — nothing about a closed dispute is editable

`dispute_decision_log` never gets an `UPDATE`. If an appeal overturns the original decision, that's a *new* log row referencing the same dispute, not a correction of the old one. The same immutability discipline as M8's ledger entries and M6's verification-level changes, applied here because a dispute decision is exactly the kind of record that gets challenged, audited, or referenced in a later dispute about the same two parties.

---

## 3. Dispute state machine

```
                    trade.disputed (M7, Path A)
                    or dispute.opened (M3 itself, Path B)
                                │
                                ▼
                  OPEN_EVIDENCE_COLLECTION
                   (both parties submit evidence — D2)
                                │
                    evidence_deadline_at reached
                    (or both parties mark done early)
                                │
                                ▼
                          UNDER_REVIEW
                   (assigned to a DISPUTE_REVIEWER — D3)
                                │
                      decision recorded (D4)
                                │
                                ▼
                            DECIDED  ───────────────┐
                                │                    │ emits dispute.resolved
                       appeal window open (D5)       │ M7: → RESOLVED_REFUNDED /
                                │                     │      RESOLVED_RELEASED
                  ┌─────────────┴─────────────┐       │ M8: executes refund/release
                  │                           │      ▼
           no appeal filed              appeal filed
           within window                     │
                  │                           ▼
                  │                      APPEALED
                  │                           │
                  │                  assigned to DISPUTE_LEAD
                  │                           │
                  │                 APPEAL_UNDER_REVIEW
                  │                           │
                  │                decision: UPHOLD | OVERTURN
                  │                           │
                  └─────────────┬─────────────┘
                                ▼
                             CLOSED   (final — no further appeal)
```

---

## 4. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS disputes;
SET search_path TO disputes, public;
```

### 4.1 Enumerations

```sql
CREATE TYPE dispute_status AS ENUM (
  'OPEN_EVIDENCE_COLLECTION', 'UNDER_REVIEW', 'DECIDED',
  'APPEALED', 'APPEAL_UNDER_REVIEW', 'CLOSED'
);

CREATE TYPE dispute_category AS ENUM (
  'ITEM_NOT_RECEIVED', 'ITEM_NOT_AS_DESCRIBED', 'PAYMENT_ISSUE',
  'SELLER_UNRESPONSIVE', 'BUYER_UNRESPONSIVE', 'OTHER'
);

CREATE TYPE dispute_creation_path AS ENUM ('DIRECT_FILING', 'TICKET_ESCALATION');

CREATE TYPE decision_outcome AS ENUM (
  'REFUND_BUYER_FULL', 'REFUND_BUYER_PARTIAL',
  'RELEASE_SELLER_FULL', 'RELEASE_SELLER_PARTIAL'
);

CREATE TYPE decision_type AS ENUM ('ORIGINAL', 'APPEAL');
CREATE TYPE appeal_outcome AS ENUM ('UPHOLD', 'OVERTURN');
```

### 4.2 Disputes

```sql
CREATE TABLE disputes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id            uuid NOT NULL,   -- soft ref to trade.trades(id)
  order_id            uuid,            -- soft ref to orders.orders(id), M9
  buyer_user_id       uuid NOT NULL,
  seller_user_id      uuid NOT NULL,
  category            dispute_category NOT NULL,
  status              dispute_status NOT NULL DEFAULT 'OPEN_EVIDENCE_COLLECTION',
  creation_path       dispute_creation_path NOT NULL,   -- D1
  source_ticket_id    uuid,   -- soft ref to support.tickets(id), set for TICKET_ESCALATION
  opened_by_user_id   uuid NOT NULL,
  opened_reason       text NOT NULL,
  total_escrow_minor  bigint NOT NULL,   -- snapshot from M8 at open time, for D4's check

  evidence_deadline_at   timestamptz NOT NULL,
  assigned_reviewer_id   uuid,
  decided_at             timestamptz,
  appeal_deadline_at     timestamptz,
  appeal_filed_at        timestamptz,
  assigned_appeal_lead_id uuid,
  closed_at              timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT disputes_escrow_positive CHECK (total_escrow_minor > 0)
);

CREATE UNIQUE INDEX disputes_one_active_per_trade
  ON disputes (trade_id) WHERE status <> 'CLOSED';
CREATE INDEX disputes_status_idx ON disputes (status);
CREATE INDEX disputes_reviewer_idx ON disputes (assigned_reviewer_id)
  WHERE status IN ('UNDER_REVIEW', 'APPEAL_UNDER_REVIEW');
```

### 4.3 Evidence (D2)

```sql
CREATE TABLE dispute_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id        uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  submitted_by_user_id uuid NOT NULL,
  file_ref_id       uuid,   -- soft ref to M20, nullable if text-only
  note              text,
  submitted_after_deadline boolean NOT NULL DEFAULT false,
  submitted_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dispute_evidence_has_content
    CHECK (file_ref_id IS NOT NULL OR note IS NOT NULL)
);

CREATE INDEX dispute_evidence_dispute_idx ON dispute_evidence (dispute_id, submitted_at);
```

### 4.4 Decision log (append-only, D6)

```sql
CREATE TABLE dispute_decision_log (
  id                    bigserial PRIMARY KEY,
  dispute_id            uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  decision_type         decision_type NOT NULL,
  decided_by_user_id    uuid NOT NULL,
  outcome               decision_outcome NOT NULL,
  amount_to_buyer_minor  bigint NOT NULL,
  amount_to_seller_minor bigint NOT NULL,
  appeal_outcome         appeal_outcome,   -- set only when decision_type = 'APPEAL'
  rationale              text NOT NULL,
  decided_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT decision_log_amounts_nonnegative
    CHECK (amount_to_buyer_minor >= 0 AND amount_to_seller_minor >= 0)
);

CREATE INDEX dispute_decision_log_dispute_idx
  ON dispute_decision_log (dispute_id, decided_at);

-- Immutability, same pattern as M8's ledger_entries and M6's
-- verification_level_changes:
CREATE OR REPLACE FUNCTION disputes.forbid_decision_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'dispute_decision_log rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispute_decision_log_no_update
  BEFORE UPDATE OR DELETE ON dispute_decision_log
  FOR EACH ROW EXECUTE FUNCTION disputes.forbid_decision_log_mutation();

GRANT INSERT, SELECT ON dispute_decision_log TO kumtru_app;
```

### 4.5 Status change log

```sql
CREATE TABLE dispute_status_changes (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  dispute_id    uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  from_status   dispute_status,
  to_status     dispute_status NOT NULL,
  actor_type    text NOT NULL,   -- 'BUYER'|'SELLER'|'REVIEWER'|'SYSTEM'
  actor_id      uuid
);

CREATE INDEX dispute_status_changes_dispute_idx
  ON dispute_status_changes (dispute_id, occurred_at);
```

---

## 5. Decision validation (D4)

```sql
-- Application-layer check performed before any dispute_decision_log insert
-- (a DB-level constraint can't easily reach across to disputes.total_escrow_minor
-- without a trigger; the trigger version is the production-correct approach):

CREATE OR REPLACE FUNCTION disputes.validate_decision_sums_to_escrow()
RETURNS trigger AS $$
DECLARE
  v_total bigint;
BEGIN
  SELECT total_escrow_minor INTO v_total
  FROM disputes WHERE id = NEW.dispute_id;

  IF (NEW.amount_to_buyer_minor + NEW.amount_to_seller_minor) <> v_total THEN
    RAISE EXCEPTION
      'decision amounts (%, %) do not sum to escrowed total (%)',
      NEW.amount_to_buyer_minor, NEW.amount_to_seller_minor, v_total;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispute_decision_log_validate_sum
  BEFORE INSERT ON dispute_decision_log
  FOR EACH ROW EXECUTE FUNCTION disputes.validate_decision_sums_to_escrow();
```

---

## 6. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `dispute.opened` | disputeId, tradeId, category, creationPath | M7 (transitions to `DISPUTED` if not already), Notifications, Audit |
| `dispute.evidence_submitted` | disputeId, submittedBy | Notifications (to the other party) |
| `dispute.evidence_window_closed` | disputeId | Ops (routes to reviewer queue) |
| `dispute.assigned` | disputeId, reviewerId | Notifications |
| `dispute.resolved` | disputeId, outcome, amountToBuyer, amountToSeller | M7 (→ `RESOLVED_REFUNDED`/`RESOLVED_RELEASED`), M8 (executes refund/release), Reputation (M12, dispute-fault input), Notifications |
| `dispute.appealed` | disputeId, filedBy | Notifications, Ops (routes to `DISPUTE_LEAD` queue) |
| `dispute.appeal_resolved` | disputeId, appealOutcome | M7, M8 (only if `OVERTURN` changes the money movement), Notifications |
| `dispute.closed` | disputeId | Reputation, Risk & Fraud (M13), Audit |

## 7. Events consumed

| Event (from) | Effect |
|---|---|
| `trade.disputed` (M7) | Path A case creation — D1 |
| `ticket.escalated_to_dispute` (M10) | Confirms Path B case creation already performed via direct API call; this event is for downstream awareness (Audit) rather than triggering creation itself |

---

## 8. RBAC — this module's slice of M1's baseline

```
dispute.view
dispute.submit_evidence         -- buyer/seller, own dispute only
dispute.assign                  -- DISPUTE_LEAD
dispute.decide                  -- DISPUTE_REVIEWER, not the case's own party (D3)
dispute.appeal                  -- buyer/seller, own dispute only, within window
dispute.decide_appeal           -- DISPUTE_LEAD only, never the original reviewer (D5)
```

---

## 9. API surface

```
# Internal, called by M7's DISPUTED transition and by M10's escalation endpoint
POST   /internal/disputes                  creates a case — D1

GET    /disputes/:id
GET    /disputes/:id/timeline
POST   /disputes/:id/evidence               buyer/seller
POST   /disputes/:id/appeal                 buyer/seller, within appeal_deadline_at

# Reviewer / admin
GET    /admin/disputes/queue
POST   /admin/disputes/:id/assign
POST   /admin/disputes/:id/decide           body: outcome, amounts, rationale — D4
POST   /admin/disputes/:id/appeal-decide    body: appealOutcome, amounts (if OVERTURN), rationale
```

---

## 10. What I would specify next

This closes the full-depth trio (Trade, Payment & Ledger, Trust & Verification, Disputes) and the marketplace-mechanics group (Merchant Management, Logistics, Disputes). Continuing M1 §20's list: **Administration (M14)**, then **Audit & Compliance (M15)** — the operational-control layer that every module's admin-surface endpoints so far have assumed exists.
