# Epic 12 — Support, risk, reputation, administration, compliance, analytics, growth, cases, messaging

---

### T-100 — Support tickets (M10)

- **Touches:** `src/modules/support/**`, migration `support_*`
- **Depends on:** T-045, T-040, T-037
- **Acceptance criteria:**
  - Seeded queues with SLAs (M10 §4); tickets, messages with `CUSTOMER_VISIBLE` / `INTERNAL_NOTE` separated at the query level (a consumer endpoint can never return an internal note, tested at the SQL layer); append-only status log.
  - SLA sweep job publishes `ticket.sla_breached`; reopen within 14 days; escalate-to-dispute creates a dispute (T-080) and links both.
  - Auto-open tickets from `identity.session.reuse_detected`, `identity.account.recovery_requested`, repeated KYC rejection and dead-lettered security notifications, each with `source_event`.
  - Consumer endpoints for L1 and help ticket screens; attachments via files.

### T-101 — Risk and fraud (M13)

- **Touches:** `src/modules/risk/**`, migration `risk_*`
- **Depends on:** T-024, T-037, T-048
- **Acceptance criteria:**
  - Append-only signals from the M13 §6 events plus new ones (proposal velocity, PIN-mismatch patterns, flagged IMEI); rules as data; time-boxed rule-applied restrictions (the DB check forbids an indefinite rule-sourced restriction); reviewer restrictions.
  - `GET /internal/risk/users/:id/active-restrictions` used as a gate by trades (`TRADE_HOLD`), ledger (`PAYOUT_HOLD`) and merchant (`FULL_FREEZE`).
  - Fraud review items register as `FRAUD` cases (AC9, AC9b); risk score never exposed to the scored user.
  - Proposal-hold rule hook consumed by T-062.

### T-102 — Reputation and ratings (M12)

- **Touches:** `src/modules/reputation/**`, migration `reputation_*`
- **Depends on:** T-065, T-080
- **Acceptance criteria:**
  - Ratings both directions after `COMPLETED`/`SETTLED` within 14 days (AC5, SR1); one public response per rating (SR2).
  - Score computed only from counters (never writable), recalculated on events, with an append-only derivation log; disputes affect score only on resolved fault.
  - Public reputation and trust history reads for the Trust Passport (C6, J1, M1, P2-D5).

### T-103 — Administration: impersonation and admin action log (M14, adapted)

- **Touches:** `src/modules/admin/**`, shared admin-route middleware
- **Depends on:** T-037
- **Acceptance criteria:**
  - Staff roster and role grants live in identity (decision C2); this module provides impersonation and the cross-module action log only.
  - Impersonation is read-only, reason-required, auto-expires (30 minutes, config), shows a banner in the consumer app, and is visible in the user's own activity.
  - Every admin route writes one `admin_action_log` row with reason through shared middleware; a registry test fails if an admin route opts out.

### T-104 — Audit and compliance (M15)

- **Touches:** `src/modules/compliance/**`
- **Depends on:** T-024, T-103, T-040
- **Acceptance criteria:**
  - Subscribes to every outbox event type and writes one pointer row each to `audit_event_index` (a test fails if a published event type has no subscription).
  - Data subject requests (access, export, delete) with per-category outcomes; deletion never hard-deletes financial or dispute records.
  - Retention policies as data, executed by a scheduled job that requests tombstoning through files.
  - `compliance_access_log` for staff access to another user's sensitive data, with a required reason.

### T-105 — Reporting, analytics and seller insights (M16)

- **Touches:** `src/modules/analytics/**`
- **Depends on:** T-074, T-102
- **Acceptance criteria:**
  - Versioned metric definitions, snapshots written by scheduled jobs through a read-only connection (replica-ready), no PII in aggregates.
  - Seed metrics (M16 §4) plus Park network metrics consumed by T-095.
  - Seller insights endpoints for AN1/AN2 (trend, category breakdown) and the ops overview (TO1).

### T-106 — Referral and growth (M18)

- **Touches:** `src/modules/growth/**`
- **Depends on:** T-074, T-101
- **Acceptance criteria:** referral codes, attribution on registration, qualification on the referee's first `trade.settled`, reward requests to the ledger (never direct credits), voiding on risk restrictions, promo codes with redemption limits. Reward amounts in config.

### T-107 — Universal case model, work queue and advisory

- **Touches:** `src/modules/cases/**`, migration `cases_*`
- **Depends on:** T-037, T-024
- **Acceptance criteria:**
  - `cases` index (types `DISPUTE`, `KYB`, `IDENTITY`, `FRAUD`, `CUSTODY`, `PAYMENT_EXCEPTION`, `TRADE_PROPOSAL`, `PARK_HUB_APPLICATION`): subject reference, owner, priority, SLA clock, state, evidence requests, reassignment with reason, decisions. Owning modules keep their own records and register into this index (M15's "index, not copy").
  - Work queue endpoints for P0-01 (my work, unassigned, escalated, SLA at risk) and the universal case read model for P0-02, paginated and filterable.
  - `advisory` interface returning a suggestion plus rationale, labelled "AI-suggested — not a decision"; v1 is rule-based per case type (Q9 default). A decision can never be recorded by the advisory path (test).
  - Every decision writes the trust trail, the admin action log and a policy citation.

### T-108 — Trade messaging

- **Touches:** `src/modules/messaging/**`, migration `messaging_*`
- **Depends on:** T-061, T-027, T-040
- **Acceptance criteria:**
  - Conversations scoped to a trade (or a pre-trade enquiry from a seller profile, MC1); messages with attachments in the `CHAT_ATTACHMENT` pool; inbox list (AC7), unread counts, realtime delivery and resync on reconnect.
  - Only parties (and staff on an open case) can read; report or block a user (I4) stops new messages.
  - Paginated history; rate limits on sends.
