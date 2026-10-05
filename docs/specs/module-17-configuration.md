# Kumtru — Module 17: Configuration

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

This module has been referenced by name since Module 11: "the actual template content library and per-category defaults, once that module exists — M11 owns the delivery mechanism and the schema template content lives in [M17]." M13's rules and M10's queue SLAs made the same forward reference. Reading back through every module written so far turns up something else, too: a long list of numeric defaults quietly buried in design-decision prose — M10's 14-day reopen window, M3's 5-day evidence window and 7-day appeal window, M11's 5-attempt retry cap, M12's 14-day rating window, M14's 30-minute impersonation timeout. Every one of those is a number someone will eventually want to change without a code deploy. That's the other half of what this module is.

So M17 is two things, not one, and they need to stay separate: a **content-authoring layer** sitting on top of schemas other modules already own (M11's templates, M13's rules, M10's queues — M17 provides the edit surface, never a second copy of the data), and a **generic tunable-settings store** for the cross-cutting numeric/boolean defaults that don't belong to any one module.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Platform settings | Generic key-value store for tunable defaults (windows, retry caps, thresholds) |
| Feature flags | Capability rollout toggles (e.g. enabling the logistics-partner portal once a partner exists) |
| Content-authoring access | The admin UI/API layer over other modules' own content schemas |
| Change history | Append-only log of every setting/flag change |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Notifications (M11) | `notification_templates` itself — M17 is the edit surface, M11 is the schema and the send logic |
| Risk & Fraud (M13) | `risk_rules` itself — same relationship |
| Tickets (M10) | `ticket_queues` SLA values themselves — same relationship |
| Administration (M14) | Who's allowed to make a config change — M17's endpoints sit behind M14's role checks like every other admin surface |
| Audit & Compliance (M15) | The permanent record of changes — M17 emits the event, M15 indexes it |

> **Boundary note:** the test for "does this belong in M17's own tables" is whether the data already has a natural home in a domain module's schema. If it does (a template, a rule, a queue's SLA), M17 only provides access — duplicating it here would recreate the exact two-systems-of-truth problem M9's D2 and M12's D1 both warned against. If it doesn't — a bare number or boolean referenced only in prose across several modules' design decisions — that's what `platform_settings` and `feature_flags` are for.

---

## 2. Core design decisions

### D1 — Platform settings are a generic, namespaced key-value store, not per-module columns

`platform_settings` uses `(namespace, key)` as its identity — `namespace` is the owning module (`disputes`, `tickets`, `reputation`, ...), `key` is the specific setting (`evidence_window_days`, `reopen_window_days`, ...). This avoids a schema migration every time a new tunable default is identified, and keeps it unambiguous which module actually reads a given value at runtime.

### D2 — M17 never duplicates a content schema another module already owns

Templates stay in `notify.notification_templates`, rules stay in `risk.risk_rules`, queue SLAs stay in `support.ticket_queues`. M17's endpoints for editing these proxy through to the owning module's own write path (or, pragmatically, write directly to the owning schema under the same constraints that module's own code would enforce) — never a parallel copy that could drift out of sync with what the runtime actually reads.

### D3 — Every change is versioned and logged, because a silently changed constant is exactly the kind of thing that needs to be visible later

`config_change_log` is append-only and records old value, new value, who changed it, when. This feeds M14's `admin_action_log` and M15's `audit_event_index` the same way every other admin mutation does — dropping the dispute appeal window from 7 days to 1 day is a consequential platform decision and should be exactly as traceable as a manually-applied risk restriction.

### D4 — Feature flags are boolean-plus-rollout-note, not a general experimentation platform

`feature_flags` supports the concrete need already named in this spec set — e.g. M2 D4's "when the first real partner is onboarded" moment, where a capability that's been fully built needs a single switch to become visible — not A/B testing infrastructure, which is a different (and, at this stage, unneeded) problem.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS config;
SET search_path TO config, public;
```

### 3.1 Platform settings (D1)

```sql
CREATE TABLE platform_settings (
  namespace     text NOT NULL,
  key           text NOT NULL,
  value         jsonb NOT NULL,
  value_type    text NOT NULL,   -- 'INTEGER'|'BOOLEAN'|'STRING'|'DECIMAL'
  description   text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by_admin_id uuid,   -- soft ref to admin.admin_users(id), M14

  PRIMARY KEY (namespace, key)
);
```

### 3.2 Feature flags (D4)

```sql
CREATE TABLE feature_flags (
  code            text PRIMARY KEY,
  description     text NOT NULL,
  enabled         boolean NOT NULL DEFAULT false,
  rollout_note    text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_admin_id uuid
);
```

### 3.3 Change log (append-only, D3)

```sql
CREATE TABLE config_change_log (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  change_target   text NOT NULL,   -- 'SETTING'|'FLAG'
  namespace_or_flag_code text NOT NULL,
  key             text,   -- null for flag changes
  old_value       jsonb,
  new_value       jsonb NOT NULL,
  changed_by_admin_id uuid NOT NULL
);

CREATE INDEX config_change_log_target_idx
  ON config_change_log (namespace_or_flag_code, occurred_at DESC);
```

---

## 4. Seed settings (pulled from defaults already stated across this spec set)

```
disputes.evidence_window_days           = 5    (M3 D2)
disputes.appeal_window_days             = 7    (M3 D5)
tickets.reopen_window_days              = 14   (M10 D4)
reputation.rating_submission_window_days = 14  (M12 D2)
notifications.max_retry_attempts        = 5    (M11 D3)
administration.impersonation_timeout_minutes = 30  (M14 D3)
trades.unconfirmed_delivery_grace_hours = 48  (M7 D4/§6)
```

Moving these from module-level prose defaults into `platform_settings` rows is itself a small migration each owning module's engineering team should do when implementing — this table lists them here so the mapping from "design decision default" to "config row" is explicit and traceable back to its origin.

---

## 5. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `config.setting_changed` | namespace, key, oldValue, newValue | Administration (M14 action log), Audit (M15) |
| `config.feature_flag_toggled` | flagCode, enabled | Administration, Audit, all modules (runtime reads the flag) |

---

## 6. API surface

```
GET    /admin/config/settings/:namespace
PUT    /admin/config/settings/:namespace/:key
GET    /admin/config/flags
PUT    /admin/config/flags/:code
GET    /admin/config/change-log

# Content-authoring proxies (D2) — thin pass-throughs to the owning module
GET    /admin/config/templates                  → notify.notification_templates
PUT    /admin/config/templates/:key
GET    /admin/config/risk-rules                 → risk.risk_rules
PUT    /admin/config/risk-rules/:code
GET    /admin/config/ticket-queues               → support.ticket_queues
PUT    /admin/config/ticket-queues/:code
```

---

## 7. What I would specify next

Continuing M1 §20's list: **Referral & Growth (M18)**, then **Search (M19)**, and finally **File & Evidence Management (M20)** — the last module, and the one nearly every prior module has referenced as "M20 owns storage" without yet defining it.
