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

## Review (2026-11-09, Sonnet) — open items for the fixer

Saved at the review phase by the build manager (weekly usage reserve). Next: fixer.

MUST-FIX

1. `infrastructure/postgres/review.ts:99-113`: the 30-day rejection counter races. Concurrent rejections either fire twice or never fire (`=== 2`). Take `pg_advisory_xact_lock(hashtext('trust:rejections:'||userId))` before counting, or give the event a unique key per user and window.
2. `infrastructure/postgres/review.ts:65` with `services/review.service.ts:155-166`: when `firstUserId` is null, a case is created without a flag, so `decideReview` can decide a duplicate through the plain queue with no dual approval. For CAC this is a real gap, because the unique index is per user. Block on the `duplicateIdentity` fact, or always create the flag.
3. Tests: exactly-2 firing under concurrency; a third rejection not firing; `parkForReview` redelivery idempotency (one case, one flag, one event); CLEAR_DUPLICATE approval replay, expiry and payload mismatch (an approval for flag A used on flag B, and one used twice).

SHOULD-FIX 4. `duplicate.service.ts:96-173`: call `consumeApproval` first in the CLEARED branch; test that a failed consume leaves the state unchanged. 5. `duplicate.service.ts:103-117`: an ESCALATED flag can be resolved by the same actor. Enforce the escalated owner or senior role, and test it. 6. `review-effects.ts:210-218`: confirm the level dropped by `releaseFirstOwner` for CAC versus NIN/BVN, and re-check the first account's current state before revoking. 7. `review.ts:106-109`: count with `decidedAt >= now() - 30d` and exclude the current request id explicitly. 8. `review.service.ts:104`: the list `total` must use the same joined query as `items`. 9. Migration 0042: make the T-039 erasure scrub cover `duplicate_identity_flags.identifier_hash`, and document the user ids that have no FK. 10. `admin.routes.ts:120-131`: document or test that CLEAR_DUPLICATE needs both `verification.override` and `duplicate_flag.resolve`. Verify that `retryable: true` mutating POSTs replay the stored result. 11. `review.service.ts:277`: put `userId` in the LEVEL override payload.

## Review fixes applied (2026-11-09, Opus)

All eleven items are fixed, each with a test that fails without it.

1. Rejection counter: `publishRejected` takes `pg_advisory_xact_lock(hashtext('trust:rejections:'||userId))` before counting, so the second of two concurrent rejections counts after the first commits. Test drives two transactions through a barrier; with the lock removed it fires 0 times.
2. Null `firstUserId`: a case with `duplicateIdentity` true and no flag now refuses `decideReview` (409), deny by default. Such a request cannot be decided from the queue until a senior handles it outside; the product rule for resolving a flag-less duplicate is left to the owner. (CAC cannot reach this today: `run-business-check` always has an owner.)
3. Tests added: concurrent exactly-2, third rejection quiet, window edge and other-user isolation, job redelivery (one case, one flag, one detection event), `parkForReview` twice, flag-less duplicate, CLEAR_DUPLICATE spent, expired, payload mismatch, and an approval for flag A used on flag B.
4. `consumeApproval` now runs first in the CLEARED branch; tests assert a refused consume leaves flag, request, case, decisions, level and events untouched.
5. A flag ESCALATED by actor X cannot be resolved by X unless X holds SUPER_ADMIN or COMPLIANCE_OFFICER; otherwise the case is reassigned to another reviewer (the escalated owner), who resolves it. Judgement call recorded for the owner: "senior role" is taken as those two roles.
6. `releaseFirstOwner`: CAC drops level 3 to 2 only when the first account's business facts no longer earn level 3; NIN/BVN drop to 1 only when identity facts no longer earn 2. `revokeLevel` locks the user and is a no-op if already at or below the target. The released hash is read from the conflicting request's own row, not the flag.
7. Count uses `decided_at >= now() - 30 days`, excludes the current request id, and adds it explicitly.
8. Queue `total` uses the same joins as `items` (test with an orphan case).
9. Erasure: new `erasure.ts` plus subscriber `trust.on-account-anonymised` (on `identity.account.anonymised`) blanks `identifier_hash` and `resolution_notes` on every flag naming the user; idempotent. No migration change was needed (migration lock untouched). The three user-id columns without a foreign key are documented in the schema file. Not covered, outside this ticket: `nin_verifications`/`bvn_verifications` hashes are not scrubbed by T-039 either.
10. Documented in `admin.routes.ts` and tested: CLEAR_DUPLICATE needs `verification.override` to ask and `duplicate_flag.resolve` to carry out. Verified `retryable: true` routes go through the platform idempotency gate (`mount.ts`, `idempotency.ts`, covered by `test/platform/http/idempotency.int.test.ts`), which stores and replays the first result.
11. LEVEL override payload now includes `userId`.
