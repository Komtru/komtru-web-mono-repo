# Kumtru — Module 16: Reporting & Analytics

**Implementation specification**
Version 0.1 · 20 August 2026 · Status: Draft for engineering review

---

## 0. How to read this document

Several modules already assume this one exists as their audience: M11 flagged `notification.sent` as feeding "Analytics (M16, once specced)," M12's reputation events and M13's risk events both name it as a consumer. This module is where those numbers become dashboards and scheduled reports — GMV, trade completion rate, dispute rate trends, KYC funnel drop-off, seller reputation distribution.

The one rule this module holds itself to, because it's the module most tempted to break it: **never become a second operational database.** Everything here is derived, scheduled, and disposable — if every table in this schema were dropped and rebuilt from the domain modules' own data, nothing outside M16 would notice or lose anything.

---

## 1. Scope

### In scope

| Area | Contents |
|---|---|
| Metric definitions | Versioned, named calculations — what "GMV" or "dispute rate" actually means |
| Scheduled aggregation | Periodic jobs computing metrics into summary tables, not live queries per dashboard load |
| Dashboards | Read surfaces over the aggregated data |
| Report generation | Scheduled or on-demand exports for stakeholders |

### Explicitly out of scope (owned elsewhere)

| Belongs to | Not here |
|---|---|
| Every domain module | The actual transactional data — M16 reads it (from replicas, never the primary write path), never owns or mutates it |
| Audit & Compliance (M15) | Provable history and legal retention — M16 is business insight, not legal record; a number here can be recomputed and changed as definitions improve, which M15's records must never do |
| Administration (M14) | Staff access control — M16's dashboards sit behind M14's role checks like everything else in the admin surface |

> **Boundary note:** M15 answers "what happened, provably, forever." M16 answers "what's the business doing, right now, as a trend." The same underlying event (`dispute.resolved`, say) feeds both, but M15 stores an immutable pointer to the actual decision record, while M16 stores a number that gets added to a running aggregate and can be recomputed if the aggregation logic is later found to be wrong. Never let those two purposes share a table.

---

## 2. Core design decisions

### D1 — This module never writes to any domain schema, and reads only from replicas

M16 has no mutating endpoint that touches `trade`, `ledger`, `identity`, or any other domain schema — its own tables are the only things it writes to. Aggregation jobs read from read replicas (per Module 0's AWS RDS setup) specifically so a slow or expensive analytics query can never compete with operational trade throughput. A dashboard being slow is acceptable; a checkout being slow because someone ran a report is not.

### D2 — Metrics are pre-aggregated on a schedule, never computed live per dashboard load

`metric_snapshots` rows are written by BullMQ repeatable jobs (per Module 0 §5's cron pattern), not computed on the fly when an admin opens a dashboard. This is the same reasoning M9's D2 flagged as "the pragmatic version once this becomes a real query-volume concern" — for a reporting module, that concern is true from day one by definition, since dashboards are read-heavy and stakeholders expect them to load instantly.

### D3 — Every metric has a versioned, stored definition — not just code

`metric_definitions` holds a human-readable computation description and a version number for every metric this module produces. If "dispute rate" is redefined next quarter (say, to exclude disputes later found to be fraud-related per M13), old `metric_snapshots` rows keep the version they were computed under, so a report pulled up a year from now can still be understood correctly rather than silently reinterpreted against today's definition.

### D4 — Aggregate tables never carry personally identifying data

`metric_snapshots` stores counts, sums, and rates — never a user's name, email, or any directly identifying field. If a stakeholder needs row-level drill-down behind a number, that query goes to the source module directly, gated by M14's role checks and logged by M15's `compliance_access_log` (M15 §2 D4) — it never lives pre-joined and waiting in a reporting table where access controls would need to be re-implemented a second time.

---

## 3. Database schema (PostgreSQL 15+)

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS analytics;
SET search_path TO analytics, public;
```

### 3.1 Metric definitions (D3)

```sql
CREATE TABLE metric_definitions (
  code              text NOT NULL,
  version           integer NOT NULL,
  description       text NOT NULL,
  computation_notes text NOT NULL,
  unit              text NOT NULL,   -- 'NGN_MINOR'|'COUNT'|'RATE_0_1'
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (code, version)
);
```

### 3.2 Metric snapshots (D2, D4)

```sql
CREATE TABLE metric_snapshots (
  id              bigserial PRIMARY KEY,
  metric_code     text NOT NULL,
  metric_version  integer NOT NULL,
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  value           numeric NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (metric_code, metric_version)
    REFERENCES metric_definitions (code, version)
);

CREATE INDEX metric_snapshots_code_period_idx
  ON metric_snapshots (metric_code, period_start DESC);
```

### 3.3 Scheduled reports

```sql
CREATE TABLE scheduled_reports (
  code            text PRIMARY KEY,
  description     text NOT NULL,
  cron_expression text NOT NULL,
  recipient_emails text[] NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE report_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code     text NOT NULL REFERENCES scheduled_reports(code),
  triggered_by    text NOT NULL,   -- 'SCHEDULE'|'MANUAL'
  file_ref_id     uuid,   -- soft ref to M20, the generated export
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  status          text NOT NULL DEFAULT 'RUNNING'   -- 'RUNNING'|'COMPLETED'|'FAILED'
);

CREATE INDEX report_runs_code_idx ON report_runs (report_code, started_at DESC);
```

---

## 4. Seed metrics (illustrative, not exhaustive)

```
GMV_DAILY               sum of settled trade amounts, per day
TRADE_COMPLETION_RATE   completed / (completed + cancelled), rolling 30d
DISPUTE_RATE             disputes opened / completed trades, rolling 30d
DISPUTE_RESOLUTION_TIME_MEDIAN   dispute opened_at to decided_at, days
KYC_FUNNEL_DROPOFF        verification_requests started vs. reaching a level, per stage
SELLER_REPUTATION_DISTRIBUTION   histogram of reputation_profiles.score buckets
NOTIFICATION_DELIVERY_RATE    sent / queued, per channel, rolling 7d
```

---

## 5. Events consumed

Unlike M15's deliberately unbounded subscription (M15 §4), M16 mostly ignores the live event bus — its aggregation jobs run on a schedule against replica data rather than reacting to individual events, per D2. The exception is a small set of high-value real-time counters (e.g. today's trade count for an ops dashboard) that may increment directly off `trade.settled` and similar events for freshness — everything else waits for the next scheduled aggregation run.

## 6. Events emitted

| Event | Payload | Consumed by |
|---|---|---|
| `analytics.metric_computed` | metricCode, periodStart, periodEnd, value | Ops dashboards |
| `analytics.report_generated` | reportCode, runId, fileRefId | Notifications (to recipients) |

---

## 7. API surface

```
GET    /admin/analytics/dashboard
GET    /admin/analytics/metrics/:code/history     query by period range
POST   /admin/analytics/reports/:code/run-now
GET    /admin/analytics/reports/:code/runs
```

---

## 8. What I would specify next

Continuing M1 §20's list: **Configuration (M17)** — the settings/content layer that M11 §1, M13 §2, and M14 §0 have all already assumed exists.
