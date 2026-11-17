# F-040 Merchant certification: backend (T-055) and review screen (T-154) implementation plan

**Feature:** F-040 (`docs/tickets/FEATURE_MAP.md`). **Tickets built in this run:** T-055 (backend), T-154 (operations-app,
OP-61). **Not built, deliberately:** T-121 (SO1-SO5, BVR1, M2 in `apps/web-app-ui`), because another agent is live in that
app. The feature therefore ends this run as **Backend done, UI outstanding**. T-056 (listings, stock) is deferred out of the
MVP and is not built.
**Branch:** `f-040-merchant-cert`. **Migration:** one, `0050_merchant_applications`.

**Goal:** an account applies for merchant certification (draft, submit, changes requested, resubmit), staff review it as a
`MERCHANT_APPLICATION` case with the evidence matrix and a rule-based advisory, and a decision is one transaction.

## How it sits on the platform (what is reused, nothing reinvented)

| Need                              | Reused                                                                                                           | New                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Case, queue, SLA, decision record | `cases` barrel: `registerCase`, `syncCaseFacts`, `takeCase`, `decideCase`, `closeCaseForSubject`, `adviseOnCase` | MERCHANT_APPLICATION advisory rules for the evidence facts                       |
| Admin action log                  | `decideCase` already writes identity's audit log with reason and citation                                        | merchant-specific audit rows for certify/revoke                                  |
| MERCHANT capability               | identity `capability.service.ts` (owns `canActAsBuyer`)                                                          | `activateCapability` / `suspendCapability` / `revokeCapability`                  |
| CAC lookup                        | trust T-051 job and `submitBusinessCheck`                                                                        | one barrel function in trust: `requestBusinessEvidence` + `readBusinessEvidence` |
| Bank name-match                   | trust verdict, already attached to the applicant's `payout_accounts` row by T-073                                | read-only attach; see "Seams"                                                    |
| KYC documents                     | files `KYC_DOCUMENT`, `PRIVATE_OWNER`, `retrieveFile`, `file_access_log`                                         | reviewer role grant is honoured on a `KYC_DOCUMENT` (files)                      |
| Address, categories               | geo `getCitiesByIds`, config `listCurrentStandards`                                                              | -                                                                                |
| Applicant notified                | notify bindings and catalogue                                                                                    | one binding + template for `merchant.application.decided`                        |

## Backend design (`src/modules/merchant/`)

Schema `merchant`, tables:

- `merchant_applications`: status enum (`DRAFT`, `SUBMITTED`, `IN_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`, `REJECTED`),
  the form fields, `case_id` (the current submission's case), `submission_count`, outstanding `changes_requested`.
  **Partial unique index** on `user_id` where status is live (`DRAFT`, `SUBMITTED`, `IN_REVIEW`, `CHANGES_REQUESTED`).
- `merchant_application_documents`: one row per (application, document type), pointing at a files record.
- `merchant_application_events`: append-only status and decision log (trigger, migration).
- `merchant_profiles`: `user_id` PK, `certified_at`, `storefront_slug` unique, certification status.
- `merchant_badges`: the Verified Merchant badge, one live row per user (partial unique).

Services: `application.service` (draft, submit, resubmit, status), `review.service` (queue, detail, assign, approve,
request changes, reject), `certification.service` (the approval transaction, suspend, revoke), `evidence.service`
(matrix and case facts), `evidence.job` (CAC lookup, fact refresh).

Routes (all `defineRoute`): applicant `GET/PUT /merchant/applications/me`, `POST /merchant/applications/:id/submit`,
`POST /merchant/applications/:id/resubmit`; staff `GET /admin/merchant/applications` (paginated),
`GET /admin/merchant/applications/count`, `GET /admin/merchant/applications/:id`,
`POST .../:id/{assign,approve,request-changes,reject}`. Reads need `merchant.application.view`, writes
`merchant.application.decide`.

Approval is one transaction: decision (reason, citation, audit), status to `APPROVED`, MERCHANT capability `ACTIVE`,
`merchant_profiles` row with `certified_at` and slug, badge, case closed, `merchant.profile.certified` and
`merchant.application.decided` in the outbox. A failure anywhere rolls all of it back; a test proves it.

## Seams and owner decisions (recorded here, repeated in the final report)

1. **Reviewer access to a KYC document.** T-055 says `PRIVATE_OWNER` plus a reviewer grant. `files` today refuses a
   `PRIVATE_OWNER` file to staff and accepts grants only on `PRIVATE_CASE`. Changed narrowly: for category `KYC_DOCUMENT`
   a role grant is accepted and honoured for a STAFF session only. Every other `PRIVATE_OWNER` file is unchanged.
2. **Bank name-match is attached, not triggered.** Triggering it needs the plaintext account number, which M8 owns, and
   T-051 refuses it until the CAC check has passed. The applicant's own verification flow runs it (T-121/BVR1); the
   evidence job reads the verdict on the applicant's payout account. The CAC lookup _is_ triggered at submit.
3. **Event names.** The platform needs three segments, so the AC's `merchant.certified` is `merchant.profile.certified`
   and `merchant.certification_revoked` is `merchant.profile.certification_revoked` (the trust precedent).
4. **Resubmission** registers a new case under subject `<applicationId>:<n>` because a decided case is never reopened.
5. **Revoke and suspend** are services with the event, no HTTP route: the AC lists no staff endpoint for them.

## Test-first steps (one conventional commit after each green step)

1. Domain: status machine, document requirements, slug, evidence facts.
2. Schema, migration 0050, append-only trigger, one-live-application index.
3. Identity capability grant, suspend, revoke.
4. Files: KYC reviewer grant.
5. Trust: evidence barrel.
6. Cases: MERCHANT_APPLICATION advisory rules.
7. Applicant service: draft, submit (422 without CAC documents), resubmit.
8. Staff service: queue, detail (signed URLs, access log), decisions, the approval transaction, revocation.
9. Routes, module, registry, notify binding and copy.
10. api-client endpoints.
11. OP-61: queue, case layout, decision panel; nav and permissions; visual check under `docs/ui-review/T-154/`.
12. Status lines, regenerate the index, verify everything.

## OP-61 (operations-app)

Follows `apps/operations-app/src/identity/` (PeopleQueue, VerificationCase). A "Merchant Applications" tab on the
Identity / KYB section with the awaiting-review count, queue sorted by SLA risk and filterable by status and category,
detail on the AC10 case layout, documents inline, evidence matrix, applicant verification level and trade history, and a
`DecisionPanel` (approve, request changes by picking documents or fields, reject) that needs a reason and a policy
citation. Visible only with `merchant.application.view`, actions only with `merchant.application.decide`.
