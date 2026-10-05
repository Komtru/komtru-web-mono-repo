# Kumtru — Module 14: Administration

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Nearly every module written so far has an admin-facing API surface — M6's KYC review queue, M10's ticket queues, M13's fraud review queue, M3's dispute reviewers — each assuming staff accounts, roles, and permissions exist without specifying where. This module is where they're specified. It's intentionally a thin, cross-cutting layer: it doesn't duplicate any module's own admin logic, it provides the staff-identity and role-assignment substrate every other module's admin endpoints already assume.

Three modules sit close to this one and need a clear line drawn between them, same as every prior module pairing in this spec set: **M14 (this module)** is who staff are and what they're allowed to touch. **M15 (Audit & Compliance, next)** is the permanent record of what actually happened platform-wide and the compliance tooling built on top of it. **M17 (Configuration, not yet specced)** is the editable settings and content data itself (feature flags, SLA thresholds, template content) that staff use M14's access to reach. Administration is the *who and what-can-they-do*; Audit is the *what happened*; Configuration is the *data they're allowed to edit*.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Staff accounts | `admin_users` — a separate identity space from consumer accounts |
| Role assignment | Cross-module role grants (`SUPPORT_AGENT`, `DISPUTE_REVIEWER`, `KYC_REVIEWER`, etc.) in one place |
| Impersonation | Time-boxed, fully logged "view as user" for support debugging |
| Admin action log | A generic, append-only record every module's admin endpoint writes to |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Audit & Compliance (M15) | The platform-wide compliance view, retention policy, data-subject requests — M14 feeds it raw action data, doesn't analyze it |
| Configuration (M17) | The actual editable settings/content — M14 grants the access, M17 holds the data |
| Every domain module (M6, M10, M13, M3, ...) | What a given role is *permitted to do within that module* — each module defines its own role's permission list (e.g. M10 §7, M3 §8); M14 only tracks *who currently holds which role* |

> **Boundary note:** this module answers "is this staff member who they claim to be, and which roles do they currently hold?" It deliberately does not re-specify what each role can do — that would duplicate logic that already lives correctly in M6, M10, M13, M3, and every future module with an admin surface. Permission *lists* stay with the domain; the *roster* of who holds them lives here.

---

## 2. Core design decisions

### D1 — Admin accounts are a separate identity space from consumer accounts

`admin_users` is its own table, not a flag on M1's `users`. A compromised consumer account can never reach admin surface area by construction — there's no role check that could be bypassed, because there's no code path connecting the two tables at all. Staff who are also platform users (rare, but possible) hold two separate accounts, deliberately.

### D2 — One place answers "what can this person do," across every module

`admin_role_assignments` is a single cross-module join table: `admin_user_id`, `role_code` (`SUPPORT_AGENT`, `DISPUTE_LEAD`, `KYC_REVIEWER`, `PLATFORM_ADMIN`, ...), which module the role applies to, who granted it, when. A given module's endpoints still check for their own specific role codes (M10 checks `SUPPORT_AGENT`, M3 checks `DISPUTE_REVIEWER`) — M14 doesn't intercept those checks, it's just the one place a platform admin looks to answer "what does this person currently hold," rather than querying eight module schemas separately.

### D3 — Impersonation is time-boxed, reason-logged, and never invisible to the affected user

An impersonation session (`impersonation_sessions`) requires a reason at start, auto-expires (default 30 minutes), and is fully logged. The impersonated user's own account-activity view (M1) surfaces that a support session occurred — never silently. This is the same instinct as M1's session-reuse detection: nothing significant happens to a user's account without the user being able to find out.

### D4 — Every admin action that mutates state outside the console itself is logged in one generic table

`admin_action_log` is written to by every module's admin endpoint (M3's decide-dispute, M13's manual restriction, M6's manual KYC override, etc.) — not a replacement for each module's own append-only history tables (M8's ledger, M3's decision log), but a single cross-module index of "what did staff do and when," which is exactly what M15's compliance tooling needs to build reports from without querying every schema individually.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS admin;
SET search_path TO admin, public;
```

### 3.1 Enumerations

```sql
CREATE TYPE admin_user_status AS ENUM ('ACTIVE', 'SUSPENDED');
```

### 3.2 Staff accounts and role assignments

```sql
CREATE TABLE admin_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  full_name       text NOT NULL,
  status          admin_user_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_role_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   uuid NOT NULL REFERENCES admin_users(id),
  role_code       text NOT NULL,   -- 'SUPPORT_AGENT'|'DISPUTE_REVIEWER'|... (D2)
  granted_by      uuid NOT NULL REFERENCES admin_users(id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

CREATE INDEX admin_role_assignments_user_idx
  ON admin_role_assignments (admin_user_id) WHERE revoked_at IS NULL;
CREATE INDEX admin_role_assignments_role_idx
  ON admin_role_assignments (role_code) WHERE revoked_at IS NULL;
```

### 3.3 Impersonation (D3)

```sql
CREATE TABLE impersonation_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   uuid NOT NULL REFERENCES admin_users(id),
  target_user_id  uuid NOT NULL,   -- soft ref to identity.users(id)
  reason          text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,   -- default started_at + 30 min
  ended_at        timestamptz
);

CREATE INDEX impersonation_sessions_admin_idx ON impersonation_sessions (admin_user_id);
CREATE INDEX impersonation_sessions_target_idx ON impersonation_sessions (target_user_id);
```

### 3.4 Admin action log (append-only, D4)

```sql
CREATE TABLE admin_action_log (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  admin_user_id   uuid NOT NULL REFERENCES admin_users(id),
  action_code     text NOT NULL,   -- 'DISPUTE_DECIDED'|'RESTRICTION_APPLIED'|...
  target_type     text NOT NULL,   -- 'dispute'|'user'|'listing'|...
  target_id       uuid NOT NULL,
  detail          jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX admin_action_log_admin_idx ON admin_action_log (admin_user_id, occurred_at DESC);
CREATE INDEX admin_action_log_target_idx ON admin_action_log (target_type, target_id);
```

---

## 4. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `admin.role_granted` | adminUserId, roleCode, grantedBy | Audit (M15) |
| `admin.role_revoked` | adminUserId, roleCode | Audit |
| `admin.impersonation_started` | sessionId, adminUserId, targetUserId, reason | Notifications (to target user's activity log), Audit |
| `admin.impersonation_ended` | sessionId | Audit |
| `admin.action_recorded` | actionCode, targetType, targetId, adminUserId | Audit — this is M15's primary ingestion feed |

---

## 5. API surface

```
POST   /admin/staff
POST   /admin/staff/:id/suspend
POST   /admin/staff/:id/roles              grant — D2
DELETE /admin/staff/:id/roles/:roleCode    revoke
GET    /admin/staff/:id/roles

POST   /admin/impersonation/start          body: {targetUserId, reason} — D3
POST   /admin/impersonation/:id/end
GET    /admin/action-log                   filterable by admin, target, date range
```

---

## 6. What I would specify next

Continuing M1 §20's list: **Audit & Compliance (M15)** — the natural next module, building directly on this one's `admin_action_log` feed and every prior module's append-only history tables, then **Reporting & Analytics (M16)**.
