# Epic 14 — `operations-app` (ops.komtru.com, TrustOps console)

Same definition of done as Epic 13, applied to desktop and tablet reference frames. Every decision screen uses `ui-kit`'s `DecisionPanel`: advisory box → "a human decides, always" divider → actions → policy-cite footer. Park is a case type inside the unified console (master prompt §3).

---

### T-140 — Console scaffold, shell and staff auth

- **Screens (v2):** OP-28, OP-33; staff login, MFA and staff invitation acceptance have no reference screen
- **Depends on:** T-017, T-037, T-038, T-190
- **Acceptance criteria:** sidebar per OP-01 navigation (Work Queue, Trades, Disputes, Identity/KYB, Fraud & Risk, Park Hubs, Parcels/Custody, Payments/Settlement, Trust Graph, Audit/Trust Trail, Policies, Reports); items hidden by permission; `STAFF` scope enforced by middleware.
- **Status:** Done (2026-11-07). Plan: `docs/superpowers/plans/2026-11-06-t-140-console-scaffold.md`. Review: 4 must-fix and 2 should-fix items fixed. Needs backend follow-ups: `GET /admin/me` (sidebar is empty until it exists) and staff-scoped MFA routes; the auth rate limiter is in-memory and must move to Redis before multiple instances.

### T-141 — Work queue and universal case

- **Screens (v2):** P1, OP-01, OP-02, OP-03, OP-04, OP-12, OP-19
- **Depends on:** T-140, T-107, T-190
- **Status:** Done (2026-11-07). Plan: `docs/superpowers/plans/2026-11-07-t-141-work-queue.md`. Review: 2 must-fix and 8 should-fix items fixed. Parts left undrawn until the backend exists: `GET /admin/me`, staff roster and capacity, queue aggregates, a staff trade read model, an alert inbox; no module calls `registerCase` yet, so queues are empty against a real backend.

### T-142 — Trade proposals

- **Screens (v2):** OP-10, OP-11
- **Depends on:** T-141, T-062, T-190

### T-143 — Disputes

- **Screens (v2):** OP-20, OP-21, OP-22; dispute queue and appeal decision use the same case layout
- **Depends on:** T-141, T-081, T-190

### T-144 — Identity review

- **Screens (v2):** OP-05, OP-06; KYC queue and duplicate-identity flags use the same case layout
- **Depends on:** T-141, T-052, T-190

### T-154 — Merchant certification review

- **Screens (v2):** OP-61; the merchant application queue reuses the Fraud Signals data-table pattern
- **Depends on:** T-141, T-055, T-190
- **Acceptance criteria:** sidebar item "Merchant Applications" with a count of items awaiting review; queue sorted by SLA risk, filterable by status and category; detail on the AC10 case layout with the documents viewable inline, the CAC lookup and bank name-match results, the applicant's verification level and trade history, and a `DecisionPanel` offering approve, request changes (pick the documents or fields) and reject, each needing a reason; decisions refresh the queue in real time; visible only with `merchant.application.view`, and actions only with `merchant.application.decide`.

### T-145 — Fraud signals and restrictions

- **Screens (v2):** OP-17, OP-18, OP-44, OP-45
- **Depends on:** T-141, T-101, T-190

### T-146 — Settlement operations

- **Screens (v2):** OP-13, OP-14, OP-34, OP-35, OP-50; payout retry, refund approvals and reconciliation discrepancies
- **Depends on:** T-141, T-076, T-190

### T-147 — Park applications, registration and lifecycle

- **Screens (v2):** OP-07, OP-08, OP-09; applicant status (PA7, PA8) is T-130
- **Depends on:** T-141, T-091, T-190
- **Notes:** deviations from the reference per design C23: the hub application and registration screens (OP-07, OP-08) drop bank and account-number fields, the payout row from the evidence matrix, the payout checklist item and "available fees".
- **Notes on location:** the hub application review (OP-08) uses the catalog city picker with an "Add city" action for staff holding `geo.manage`.

### T-148 — Park network and custody

- **Screens (v2):** OP-15, OP-16, OP-59, OP-60
- **Depends on:** T-147, T-095, T-190
- **Coverage:** All hubs (OP-09) gains state and city filters and a coverage summary: serviceable cities, cities with hubs in onboarding, and unmet Park demand by city.

### T-149 — Logistics companies and packages

- **Screens (v2):** OP-51, OP-67, OP-68, OP-69; Companies and Packages tabs (m2 §9) in the console design language
- **Depends on:** T-140, T-087, T-190

### T-150 — Directory, roles and approvals

- **Screens (v2):** OP-25, OP-26, OP-27, OP-29, OP-30, OP-31, OP-32; customers and staff directory, user detail with masked PII and audited reveal, role grants with dual approval, impersonation start
- **Depends on:** T-140, T-103, T-190

### T-151 — Support tickets console

- **Screens (v2):** OP-41, OP-42, OP-43; queues, ticket detail with internal notes visually separated from customer messages, assignment, SLA
- **Depends on:** T-140, T-100, T-190

### T-152 — Audit and compliance

- **Screens (v2):** OP-23, OP-24, OP-36, OP-37, OP-40, OP-52; data subject requests, retention policies, compliance access log
- **Depends on:** T-140, T-104, T-190

### T-153 — Overview, configuration, notifications and analytics

- **Screens (v2):** OP-38, OP-39, OP-49, OP-65, OP-66, OP-70, OP-71; the rest have no reference screen: settings and feature flags, a read-only fees panel showing the live fee file version and values with a note that fees change by editing `config/fees.yaml`, notification templates and dead-letter queue
- **Depends on:** T-140, T-048, T-049, T-045, T-105, T-190

### T-155 — Location catalog management

- **Screens (v2):** none; built in the console design language
- **Depends on:** T-140, T-046, T-190
- **Acceptance criteria:** sidebar item "Locations" for staff with `geo.manage`; states list with city counts and Park coverage counts; per-state city table with add, rename and deactivate, each needing a reason; a city-requests queue showing requester counts per requested name, with add, merge into an existing city, or reject; changes reach customer dropdowns within the cache invalidation window (tested); every action recorded in the admin action log.
