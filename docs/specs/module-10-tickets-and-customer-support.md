# Kumtru — Module 10: Tickets / Customer Support

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Three modules already assume this one exists and auto-open cases into it: M1 (session-reuse detection, account recovery), M6 (repeated KYC rejection), M11 (dead-lettered security notifications). This module is where those land, alongside every ordinary support conversation a user starts themselves.

The rule that matters most, carried over directly from the original architecture blueprint: **a ticket is not a dispute.** "I can't log in" is a support issue. "The camera I received isn't the camera I bought" is a financially consequential case that belongs in Disputes (M3). Conflating them means either support agents making financial decisions they shouldn't, or dispute reviewers drowning in password-reset requests.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Tickets | The case object — category, priority, status, assignment |
| Queues | General Support, Payments, KYC, Merchant Support, Logistics, Technical, Fraud, Compliance |
| Messages | Customer-visible conversation, kept strictly separate from internal notes |
| SLA | Per-queue response/resolution targets, breach tracking |
| Auto-opened tickets | The pattern M1/M6/M11 already rely on — an event-triggered ticket, not just a user-typed one |
| Reopening | A resolved ticket the user disagrees is actually resolved |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Disputes (M3) | Financially consequential cases — evidence, decisions, appeals, refund/release outcomes |
| Identity & Access (M1) | The actual account-recovery flow — M10 just hosts the human-review conversation around it |
| File & Evidence Management (M20) | Attachment storage — M10 stores references |

> **Boundary note, same shape as M6 §1's identity-vs-verification split:** a ticket answers *"is this person having a problem, and how do we help them?"* A dispute answers *"who owes whom money, and why?"* A ticket can reference a trade for context without being about the trade's financial outcome — "my payout hasn't arrived" is a ticket (routes to Payments queue, possibly escalates to M8) right up until it becomes a claim that money is owed that isn't showing up, at which point it may need to *become* or spawn a dispute. That handoff is a deliberate, visible action (§5), never an implicit reclassification.

---

## 2. Core design decisions

### D1 — Every ticket traces to either a user action or a triggering event

`tickets.source_event` is nullable but when set (e.g. `identity.session.reuse_detected`), it's how the ticket got created without anyone typing anything. This mirrors M11's D1 (every notification traces to an event) — the same discipline applied to auto-opened cases, so "why does this user have a ticket they never filed" always has an answer.

### D2 — Internal notes and customer messages are never the same table row

`ticket_messages.visibility` is `CUSTOMER_VISIBLE` or `INTERNAL_NOTE`, and the two render in completely different UI surfaces (consumer app vs. admin portal) — never a checkbox on a single unified thread that a tired agent could get wrong. An internal note is enforced at the write layer to never appear in any consumer-facing API response, not just hidden by a frontend flag.

### D3 — Queues carry their own SLA and default priority, not a global one

`ticket_queues.sla_hours` varies — a `FRAUD` queue ticket and a `GENERAL_SUPPORT` "how do I change my display name" ticket shouldn't share a response-time target. Escalation (a ticket approaching or past its SLA) is a scheduled sweep (BullMQ repeatable, per Module 0 §5), not something the agent has to notice themselves.

### D4 — Reopening is bounded, not infinite

A `CLOSED` ticket can be reopened by the original user within a fixed window (default 14 days) — after that, a new ticket referencing the old one is the right move, not an indefinitely-reopenable thread that never really closes.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS support;
SET search_path TO support, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE ticket_status AS ENUM (
  'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER',
  'WAITING_INTERNAL', 'RESOLVED', 'CLOSED', 'REOPENED'
);

CREATE TYPE ticket_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TYPE ticket_channel AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'SYSTEM_AUTO');

CREATE TYPE message_visibility AS ENUM ('CUSTOMER_VISIBLE', 'INTERNAL_NOTE');

CREATE TYPE message_sender_type AS ENUM ('CUSTOMER', 'AGENT', 'SYSTEM');
```

### 3.2 Queues

```sql
CREATE TABLE ticket_queues (
  code              text PRIMARY KEY,   -- 'GENERAL_SUPPORT'|'PAYMENTS'|'KYC'|...
  name              text NOT NULL,
  sla_first_response_hours integer NOT NULL,
  sla_resolution_hours     integer NOT NULL,
  default_priority  ticket_priority NOT NULL DEFAULT 'NORMAL'
);
```

### 3.3 Tickets

```sql
CREATE TABLE tickets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number     text NOT NULL UNIQUE,   -- 'TK-10492', human-facing
  user_id           uuid NOT NULL,   -- soft ref to identity.users(id)
  queue_code        text NOT NULL REFERENCES ticket_queues(code),
  category          text NOT NULL,
  priority          ticket_priority NOT NULL,
  status            ticket_status NOT NULL DEFAULT 'OPEN',
  channel           ticket_channel NOT NULL,
  assigned_agent_id uuid,

  -- Related-entity soft refs. All nullable; a ticket may reference none,
  -- one, or several of these depending on what it's about.
  related_trade_id       uuid,
  related_payment_id     uuid,
  related_shipment_id    uuid,
  related_dispute_id     uuid,

  source_event      text,   -- D1: null if the user filed this themselves

  created_at        timestamptz NOT NULL DEFAULT now(),
  first_response_due_at timestamptz NOT NULL,
  resolution_due_at      timestamptz NOT NULL,
  first_responded_at     timestamptz,
  resolved_at            timestamptz,
  closed_at              timestamptz,
  reopen_count           integer NOT NULL DEFAULT 0,
  reopenable_until       timestamptz   -- D4
);

CREATE INDEX tickets_user_idx ON tickets (user_id);
CREATE INDEX tickets_queue_status_idx ON tickets (queue_code, status);
CREATE INDEX tickets_assigned_idx ON tickets (assigned_agent_id)
  WHERE status IN ('ASSIGNED', 'IN_PROGRESS');
CREATE INDEX tickets_sla_breach_idx ON tickets (resolution_due_at)
  WHERE status NOT IN ('RESOLVED', 'CLOSED');
```

### 3.4 Messages (D2)

```sql
CREATE TABLE ticket_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_type     message_sender_type NOT NULL,
  sender_id       uuid,   -- null for SYSTEM
  visibility      message_visibility NOT NULL,
  body            text NOT NULL,
  attachment_refs uuid[] NOT NULL DEFAULT '{}',   -- M20 file references
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);
-- Enforced at the API layer: any endpoint serving the consumer app filters
-- visibility = 'CUSTOMER_VISIBLE' at the query level, never post-fetch.
```

### 3.5 Status changes (append-only)

```sql
CREATE TABLE ticket_status_changes (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  ticket_id    uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_status  ticket_status,
  to_status    ticket_status NOT NULL,
  actor_type   text NOT NULL,   -- 'CUSTOMER'|'AGENT'|'SYSTEM'
  actor_id     uuid,
  reason       text
);

CREATE INDEX ticket_status_changes_ticket_idx
  ON ticket_status_changes (ticket_id, occurred_at);
```

---

## 4. Seed queues

Matching the original blueprint's list, each needs its own SLA before launch (placeholder hours shown — a real number is an ops decision, not an engineering one):

```
GENERAL_SUPPORT    24h first response / 72h resolution
PAYMENTS           4h first response  / 24h resolution
KYC                24h first response / 48h resolution
MERCHANT_SUPPORT   24h first response / 72h resolution
LOGISTICS          12h first response / 48h resolution
TECHNICAL          24h first response / 72h resolution
FRAUD              1h first response  / 24h resolution
COMPLIANCE         24h first response / 5 business days
```

---

## 5. Ticket-to-dispute handoff

Per the boundary note in §1: a ticket that turns out to actually be a financial claim doesn't silently become a dispute. An agent (or the user, via an explicit "this is about money owed to me" action) triggers `POST /tickets/:id/escalate-to-dispute`, which creates a new M3 dispute record referencing the ticket, sets `tickets.related_dispute_id`, and moves the ticket to `WAITING_INTERNAL` while M3 takes over the financial decision. The ticket stays open as the support-conversation record; the dispute is the financial-decision record. Two objects, one link between them.

---

## 6. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `ticket.created` | ticketId, userId, queue, sourceEvent | Notifications |
| `ticket.assigned` | ticketId, agentId | Notifications (internal) |
| `ticket.sla_breached` | ticketId, queue | Ops alerting, Audit |
| `ticket.resolved` | ticketId | Notifications, Reputation (response-time input) |
| `ticket.reopened` | ticketId, reopenCount | Notifications, Ops (repeated reopens are a quality signal) |
| `ticket.escalated_to_dispute` | ticketId, disputeId | Notifications, Audit |

---

## 7. RBAC — this module's slice of M1's baseline

M1 §12 defines `SUPPORT_AGENT` and `SUPPORT_LEAD`. This module's permissions:

```
ticket.view
ticket.assign
ticket.resolve
ticket.reassign          -- SUPPORT_LEAD only, per M1's role table
ticket.escalate_to_dispute
```

---

## 8. What I would specify next

Continuing M1 §20's list: **Reputation (M12)**, then **Risk & Fraud (M13)**.
