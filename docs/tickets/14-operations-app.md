# Epic 14 — `operations-app` (ops.komtru.com, TrustOps console)

Same definition of done as Epic 13, applied to desktop and tablet reference frames. Every decision screen uses `ui-kit`'s `DecisionPanel`: advisory box → "a human decides, always" divider → actions → policy-cite footer. Park is a case type inside the unified console (master prompt §3).

---

### T-140 — Console scaffold, shell and staff auth

- **Screens:** NAV, TO-PA9 (tablet rail), staff login, MFA, staff invitation acceptance
- **Depends on:** T-017, T-037, T-038
- **Acceptance criteria:** sidebar per P0-01 navigation (Work Queue, Trades, Disputes, Identity/KYB, Fraud & Risk, Park Hubs, Parcels/Custody, Payments/Settlement, Trust Graph, Audit/Trust Trail, Policies, Reports); items hidden by permission; `STAFF` scope enforced by middleware.

### T-141 — Work queue and universal case

- **Screens:** P0-01, P0-02, P1 (mobile check-in)
- **Depends on:** T-140, T-107

### T-142 — Trade proposals

- **Screens:** N1, N2
- **Depends on:** T-141, T-062

### T-143 — Disputes

- **Screens:** Z6, dispute queue, appeal decision (no separate reference beyond Z6; same case layout)
- **Depends on:** T-141, T-081

### T-144 — Identity review

- **Screens:** none in the reference; KYC queue, duplicate-identity flags
- **Depends on:** T-141, T-052

### T-154 — Merchant certification review

- **Screens:** AC10, plus the merchant application queue (no separate reference; reuses the Fraud Signals data-table pattern)
- **Depends on:** T-141, T-055
- **Acceptance criteria:** sidebar item "Merchant Applications" with a count of items awaiting review; queue sorted by SLA risk, filterable by status and category; detail on the AC10 case layout with the documents viewable inline, the CAC lookup and bank name-match results, the applicant's verification level and trade history, and a `DecisionPanel` offering approve, request changes (pick the documents or fields) and reject, each needing a reason; decisions refresh the queue in real time; visible only with `merchant.application.view`, and actions only with `merchant.application.decide`.

### T-145 — Fraud signals and restrictions

- **Screens:** AC9, AC9b
- **Depends on:** T-141, T-101

### T-146 — Settlement operations

- **Screens:** P0-06, payout retry, refund approvals, reconciliation discrepancies
- **Depends on:** T-141, T-076

### T-147 — Park applications, registration and lifecycle

- **Screens:** PH7, TO-PA1, TO-PA2, TO-PA3, TO-PA4, TO-PA6, TO-PA6B, TO-PA10 (both variants), TO-PA11
- **Depends on:** T-141, T-091
- **Notes:** deviations from the reference per design C23: TO-PA6B, TO-PA10 and TO-PA11 drop bank and account-number fields, TO-PA2 drops the payout row from the evidence matrix, TO-PA3 drops the payout checklist item, and TO-PA4 drops "available fees".
- **Notes on location:** TO-PA6 uses the catalog city picker with an "Add city" action for staff holding `geo.manage`.

### T-148 — Park network and custody

- **Screens:** TO-PA7, TO-PA8, P0-04, P0-05, P0-07, TO-PA5
- **Depends on:** T-147, T-095
- **Coverage:** TO-PA7 gains state and city filters and a coverage summary: serviceable cities, cities with hubs in onboarding, and unmet Park demand by city.

### T-149 — Logistics companies and packages

- **Screens:** none in the reference; m2 §9 Companies and Packages tabs, built in the console design language
- **Depends on:** T-140, T-087

### T-150 — Directory, roles and approvals

- **Screens:** none in the reference; customers and staff directory, user detail with masked PII and audited reveal, role grants with dual approval, approvals queue, impersonation start
- **Depends on:** T-140, T-103

### T-151 — Support tickets console

- **Screens:** none in the reference; queues, ticket detail with internal notes visually separated from customer messages, assignment, SLA
- **Depends on:** T-140, T-100

### T-152 — Audit and compliance

- **Screens:** none in the reference; audit timeline, data subject requests, retention policies, compliance access log
- **Depends on:** T-140, T-104

### T-153 — Overview, configuration, notifications and analytics

- **Screens:** TO1; the rest have no reference screen: settings and feature flags, a read-only fees panel showing the live fee file version and values with a note that fees change by editing `config/fees.yaml`, Trade Standards, notification templates and dead-letter queue, analytics dashboards and report runs
- **Depends on:** T-140, T-048, T-049, T-045, T-105

### T-155 — Location catalog management

- **Screens:** none in the reference; built in the console design language
- **Depends on:** T-140, T-046
- **Acceptance criteria:** sidebar item "Locations" for staff with `geo.manage`; states list with city counts and Park coverage counts; per-state city table with add, rename and deactivate, each needing a reason; a city-requests queue showing requester counts per requested name, with add, merge into an existing city, or reject; changes reach customer dropdowns within the cache invalidation window (tested); every action recorded in the admin action log.
