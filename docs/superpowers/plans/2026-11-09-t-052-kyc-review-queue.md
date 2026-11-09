# T-052 — Duplicate identity detection and KYC review queue

Spec: M6 §6.7, §6.8, §7, §9, §10, §11. Depends on T-050, T-037, T-107 (all done).

## What exists already

- The identity and CAC jobs detect a duplicate (`applyDuplicateIdentity`, `applyDuplicateBusiness`), park the request in
  `MANUAL_REVIEW` and publish `trust.verification.duplicate_identity_detected`. Nothing persists a flag and nothing works the review.
- `admin_action_approvals` (T-037) already carries `VERIFICATION_OVERRIDE`; the owning module spends it with `consumeApproval`.
- The universal case model (T-107) has `IDENTITY` and `KYB` case types and a rule-based advisory.

## Design

1. **No separate `kyc_review_queue` table.** The case index _is_ the queue (T-107, "index, not copy"). Every request parked in
   `MANUAL_REVIEW` registers a case in the same transaction: `IDENTITY` for NIN, BVN, liveness, address, document and social proof;
   `KYB` for CAC and business bank name-match. Subject is `verification_request` / request id. Facts are small non-PII scalars the
   advisory reads (`duplicateIdentity`, `nameMatch`, `registryMatch`, ...). The advisory gets one new rule per type for duplicates.
2. **Migration 0042** adds `trust.duplicate_identity_flags` (M6 §6.7) with `request_id` (unique) so a flag links to the request and a
   redelivered job cannot write two. `first_user_id <> conflicting_user_id` stays a CHECK.
3. **Duplicate flag lifecycle** (`duplicate.service.ts`): `OPEN -> CONFIRMED_DUPLICATE | CLEARED_FALSE_POSITIVE | ESCALATED`.
   Nothing is ever decided automatically. Confirming rejects the second claim (`DUPLICATE_IDENTITY`). Clearing releases the
   identifier from the first account and approves the second; because that moves an identity between accounts and revokes the first
   account's level, it requires an approved `VERIFICATION_OVERRIDE` (dual approval). Escalating just records the status.
4. **Review queue** (`review.service.ts`): list/detail (with advisory), assign (= `takeCase`), decide APPROVE/REJECT. Decide records the
   case decision (`decideCase`), moves the request, evaluates levels, closes the case and publishes `trust.verification.review_decided`.
   A flagged request cannot be decided here; it goes through its flag.
5. **`verification.override`** (`review.service.ts`): request opens a `VERIFICATION_OVERRIDE` approval (payload `{direction, toLevel}`);
   a different holder approves through the existing `/admin/approvals/:id/approve`; the requester then executes, which spends the
   approval with `consumeApproval` and writes the level change (`KYC_ANALYST` actor, provider `MANUAL`). No single-actor path exists.
6. **Repeated rejection**: every `trust.verification.rejected` publish goes through one helper that, after publishing, counts the user's
   `REJECTED` requests in the last 30 days and, when the count has just become exactly 2, publishes
   `trust.verification.repeated_rejection` (outbox). T-100 will consume it; no ticket is built here.
7. **HTTP** (`http/admin.controller.ts`, STAFF scope): `GET /admin/kyc/queue`, `GET /admin/kyc/queue/:requestId`,
   `POST /admin/kyc/queue/:requestId/assign`, `POST /admin/kyc/queue/:requestId/decide`, `GET /admin/kyc/duplicate-flags`,
   `POST /admin/kyc/duplicate-flags/:id/resolve`, `POST /admin/kyc/overrides`, `POST /admin/kyc/overrides/:approvalId/execute`.

## Tests (first)

Domain units (case type mapping, facts, override bounds, window rule), schema/route tests, and `KOMTRU_INFRA_TESTS=1` integration tests
for: flag + case written with the park, no auto approve/reject, decide approve/reject, flag resolution incl. dual approval, override
refusing without approval, and the repeated-rejection event on the second rejection only.

## Owner decisions pending

Defaults chosen where the spec is silent (none involve money):

1. Clearing a duplicate flag (releasing an identifier from the first account) needs dual approval via `VERIFICATION_OVERRIDE`;
   confirming a duplicate needs only `duplicate_flag.resolve`. The first account is dropped to level 1 when its identifier is released.
2. `verification.override` may grant levels 2 and 3 only (level 4 is "enhanced due diligence", granted by no code path) and may revoke
   down to level 1 (M6 owns levels 2-4 and nothing below).
3. The auto-opened support event fires when the count of `REJECTED` requests in a rolling 30 days becomes exactly 2, across all
   verification types for the user (not per type), once per crossing (a third rejection does not re-fire). Expired-by-sweep requests do not count.
4. An analyst's APPROVE of a `FUZZY_MATCH` bank match marks the request approved but does not grant level 3: level 3 still requires
   an `EXACT` match (`businessFacts`). Whether an analyst may promote a fuzzy match is a trust-policy call.
5. Review decisions carry a policy citation; default `M6 §6.8` (or `M6 §7` for duplicates) when the analyst supplies none.
6. A rejection from the queue uses `REVIEW_DECLINED`; a confirmed duplicate uses `DUPLICATE_IDENTITY` (both new rejection codes).
7. Case SLAs and priority: `HIGH` for duplicates, `NORMAL` otherwise, SLA from T-107's `SLA_HOURS` table.
8. Approvals expire after 24 h (T-037's `APPROVAL_TTL_HOURS`), unchanged.
