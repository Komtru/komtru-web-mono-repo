# Kumtru — Module 15: Audit & Compliance

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Every module written so far already keeps its own append-only history — M8's ledger entries, M3's decision log, M6's verification-level changes, M14's admin action log, and more. This module does not replace any of them, and does not copy their data. What it adds is two things nothing else provides: a single searchable timeline that spans every module (§3.2), and the compliance workflows a Nigerian marketplace handling escrowed funds and KYC data actually needs — data-subject requests and retention policy, in line with the Nigeria Data Protection Regulation (NDPR).

The design instinct carried over from M14 §0's framing: Administration is *who can do what*, this module is *what actually happened, provably, and how long we're allowed to keep it*.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Cross-module audit timeline | A lightweight index over every module's own event stream — searchable by actor, target, module, date |
| Data subject requests | Access, export, and deletion requests, NDPR-aligned |
| Retention policy | Per-data-category retention rules, data-driven |
| Auditing the auditors | Logging staff access to sensitive compliance data itself |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Every domain module | The actual append-only records (ledger entries, decision logs, verification changes) — M15 indexes pointers to them, never copies or becomes a second system of record |
| Administration (M14) | Who staff are and what roles they hold — M15 consumes `admin.action_recorded` as one of many event sources |
| Reporting & Analytics (M16) | Business-metric dashboards and trend analysis — M15 is about provable history and legal obligation, not business insight |

> **Boundary note:** M15 never stores a full copy of a sensitive record — an `audit_event_index` row for a dispute decision points at `dispute_decision_log`'s row, it doesn't duplicate the rationale text. This matters for D3 (retention): if M15 held full copies, two systems would need to agree on when to purge instead of one.

---

## 2. Core design decisions

### D1 — The audit timeline is an index, not a second copy

`audit_event_index` stores enough to search and locate — module, source table, source row id, event type, actor, timestamp — never the full payload of the underlying record. Every module already emits a domain event for anything worth auditing (a discipline established as early as M10's D1 and M11's D1); M15 subscribes to literally all of them and writes one pointer row per event. This is the one place with genuinely no domain logic of its own — it's a subscriber to everyone else's already-established discipline.

### D2 — A deletion request is never a hard `DELETE` on financial or dispute-relevant records

NDPR gives users a right to request erasure, but Kumtru also has a legal obligation to retain trade, ledger, and dispute records for a minimum period regardless of a user's request (the same tension every escrow platform operating under financial regulation has to resolve). `data_subject_requests` of type `DELETE` always resolve to one of two outcomes, decided per data category against `retention_policies`: anonymization (the record stays, personally identifying fields are scrubbed) for categories under legal hold, or genuine deletion for categories with no such obligation (e.g. stale notification bodies, old session metadata). The request and its resolution are both logged — a user can always see what happened to their request, even when the answer is "retained per legal obligation, category X."

### D3 — Retention policy is per-category, data-driven, and defaults to indefinite for anything append-only and financially or legally consequential

`retention_policies` is a table, not a hardcoded rule per module — same instinct as M11's D5 templates-as-data and M13's D3 rules-as-data. The default posture: ledger entries (M8), dispute decisions (M3), verification-level changes (M6), and admin action logs (M14) retain indefinitely unless a policy row explicitly overrides it; operational logs (notification delivery attempts, session records) get a shorter default that a policy row can extend. Nothing purges by silent default — every category needs an explicit row.

### D4 — Staff access to another user's sensitive compliance data is itself an audited event

Pulling a data-subject export, or querying another user's full audit timeline, writes a `compliance_access_log` row — reason required, same posture as M14's impersonation logging (D3 there). The question "who looked at this person's data, and why" needs to always be answerable, including about the people whose job is answering it for everyone else.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS compliance;
SET search_path TO compliance, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE dsr_type AS ENUM ('ACCESS', 'EXPORT', 'DELETE');
CREATE TYPE dsr_status AS ENUM ('RECEIVED', 'IN_PROGRESS', 'FULFILLED', 'PARTIALLY_FULFILLED');
CREATE TYPE retention_action AS ENUM ('RETAIN_INDEFINITELY', 'ANONYMIZE_AFTER', 'DELETE_AFTER');
```

### 3.2 Cross-module audit index (D1)

```sql
CREATE TABLE audit_event_index (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  module        text NOT NULL,   -- 'identity'|'trade'|'ledger'|'disputes'|...
  source_table  text NOT NULL,
  source_id     text NOT NULL,
  event_type    text NOT NULL,   -- the domain event name, e.g. 'dispute.resolved'
  actor_type    text NOT NULL,   -- 'USER'|'ADMIN'|'SYSTEM'
  actor_id      uuid
);

CREATE INDEX audit_event_index_module_idx ON audit_event_index (module, occurred_at DESC);
CREATE INDEX audit_event_index_source_idx ON audit_event_index (source_table, source_id);
CREATE INDEX audit_event_index_actor_idx ON audit_event_index (actor_id, occurred_at DESC);
```

### 3.3 Data subject requests (D2)

```sql
CREATE TABLE data_subject_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  request_type    dsr_type NOT NULL,
  status          dsr_status NOT NULL DEFAULT 'RECEIVED',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  fulfilled_at    timestamptz,
  fulfilled_by_admin_id uuid,
  resolution_notes text   -- per-category outcome summary, D2
);

CREATE INDEX data_subject_requests_user_idx ON data_subject_requests (user_id);
CREATE INDEX data_subject_requests_status_idx ON data_subject_requests (status)
  WHERE status IN ('RECEIVED', 'IN_PROGRESS');
```

### 3.4 Retention policies (D3)

```sql
CREATE TABLE retention_policies (
  data_category     text PRIMARY KEY,   -- 'ledger_entries'|'notification_bodies'|...
  action            retention_action NOT NULL DEFAULT 'RETAIN_INDEFINITELY',
  after_days        integer,   -- required if action <> 'RETAIN_INDEFINITELY'
  legal_basis       text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT retention_after_days_required
    CHECK (action = 'RETAIN_INDEFINITELY' OR after_days IS NOT NULL)
);
```

### 3.5 Compliance access log (append-only, D4)

```sql
CREATE TABLE compliance_access_log (
  id                bigserial PRIMARY KEY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  admin_user_id     uuid NOT NULL,   -- soft ref to admin.admin_users(id), M14
  accessed_user_id  uuid NOT NULL,
  reason            text NOT NULL,
  access_type       text NOT NULL   -- 'AUDIT_TIMELINE_VIEW'|'DSR_EXPORT'|...
);

CREATE INDEX compliance_access_log_admin_idx
  ON compliance_access_log (admin_user_id, occurred_at DESC);
```

---

## 4. Events consumed

Deliberately unbounded, per D1: **every domain event from every module** is subscribed to and written as one `audit_event_index` row. This is the one module in the whole spec set where "events consumed" is not a finite list — it's structurally "all of them, forever," which is the entire point of the module.

## 5. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `compliance.dsr_received` | requestId, userId, type | Notifications, Admin (M14) queue |
| `compliance.dsr_fulfilled` | requestId, outcome | Notifications |
| `compliance.retention_policy_applied` | dataCategory, action, recordCount | Ops reporting |

---

## 6. API surface

```
GET    /admin/audit/timeline               filterable by module, actor, target, date range
POST   /admin/compliance/data-subject-requests
POST   /admin/compliance/data-subject-requests/:id/fulfill
GET    /admin/compliance/retention-policies
PUT    /admin/compliance/retention-policies/:category

# User-facing — a user can request their own data
POST   /account/data-requests               body: {type: ACCESS|EXPORT|DELETE}
GET    /account/data-requests
```

---

## 7. What I would specify next

Continuing M1 §20's list: **Reporting & Analytics (M16)**, then **Configuration (M17)** — the settings/content layer M11 §1 and M14 §0 both already assumed exists.
