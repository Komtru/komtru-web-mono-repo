# T-037 plan: RBAC catalog, staff login and admin endpoints

Test first, commit after each green step. No migration is expected: `admin_role_assignments`
(with `expires_at` and the dual-approval trigger), `admin_action_approvals` and the audit table
already exist from T-030, and the catalogue reaches the database through `seedIdentityCatalogue`.

## Steps

1. **Catalogue.** Extend `domain/rbac/catalog.ts` to 14 roles (add `DISPUTE_LEAD`, `PARK_OPERATIONS`)
   and 70 permissions (M1's 22 plus the module slices, `geo.manage`, `merchant.application.*`).
   Taken from the wip branch (`f5bc7c4`): the role and permission shape and the M7, M8, M3, M6, M10
   rows, re-verified against the specs. Added here: the risk, logistics, park, cases, config,
   compliance, analytics, growth and moderation slices the wip lacked, and non-empty M7 rows.
   Matrix test: one inline 70 x 14 table, counts asserted, plus a parse of M1 section 12.3 from the
   spec file so the first 22 rows are compared with the spec itself, not a transcription.
2. **Separation of duties.** `domain/rbac/sod.ts`: self-dealing (C5), conditional-grant checks,
   dual-approval role list, two-step action registry. Pure, unit-tested.
3. **Capability service.** `canUserActAsBuyer(db, userId)` over the existing pure rule, exported from the
   barrel (the name `canActAsBuyer` is already the pure status function trades delegates to).
4. **Staff login.** `POST /auth/staff/login` and `POST /auth/staff/mfa/verify`: password then a
   second factor, STAFF scope, a live role required, challenge bound to its scope so a consumer
   `mfaToken` cannot open a staff session.
5. **Services.** `rbac.service` (time-boxed, dual-approved grants and revokes), `approval.service`
   (request, approve, reject, consume), admin functions in `user.service`.
6. **Admin endpoints** per M1 section 10.6 in `http/controllers/admin.controller.ts`: paginated,
   reason required (400 without), one audit row each, integration-tested.
7. **Verify** lint, typecheck, identity tests (unit and infra), `migration:safety`, prettier.

## Outcome

No migration: the existing tables, constraints and triggers carried every rule. Catalogue 14 roles,
70 permissions, 214 grants (asserted in `CATALOGUE_COUNTS` and the matrix test).

## Open questions (deny-by-default choices made where no spec answers)

1. **Slices with no named holder.** Specs name permissions for trade, payment, payout, reconciliation,
   dispute, verification, duplicate flag, ticket (and `logistics.manage`, `park.manage`) but give
   holders only for some. Risk, park, cases, config, compliance, analytics, growth and moderation
   permissions were invented here (names and holders), as narrow as the M1 role descriptions allow.
   `geo.manage` is held by `SUPER_ADMIN` and `OPERATIONS_ADMIN` only. `payment.view`/`payout.*`/
   `reconciliation.*` are `FINANCE_ADMIN` only. `config.manage` is `SUPER_ADMIN` only. Owner to confirm.
2. **New roles' baseline.** `DISPUTE_LEAD` and `PARK_OPERATIONS` hold `user.view` and `user.search` (M1's
   "every role" rows) and nothing else from M1's 22.
3. **Staff without MFA.** `POST /auth/staff/login` rejects (uniform 401) a staff member with no enrolled
   second factor instead of opening a forced-setup session; they enrol through a consumer session first.
4. **Identity challenge.** M1 note 3's challenge with the user is an attestation on approve
   (`identityChallengeConfirmed`), recorded in the audit row. Nothing verifies it.
5. **Ticket-scoped grants.** `TICKET_SCOPED_PII` and `DOCUMENTED_USER_REQUEST` need M10 tickets; until a
   caller can supply one, `SUPPORT_AGENT` and `SUPPORT_LEAD` are refused PII and account closure.
6. **Large refunds.** M8 sets no "large" threshold, so every `payment.refund` is two-step.
7. **Reads need a reason.** M1 section 10.6 says every `/admin/*` call, so GETs take `?reason=`.
8. **Status endpoint.** Only restrict, suspend and reinstate; closing and anonymising are T-039's.
9. **Linked accounts.** Device and IP links only; payout-instrument links wait for M8.
10. **Dual-approval roles** are granted through a `ROLE_GRANT` approval (second `SUPER_ADMIN`), since
    the trigger refuses a row without `approved_by`. The very first `SUPER_ADMIN` still needs a seed.
11. **Barrel name.** `canActAsBuyer` on the barrel stays the pure status function trades imports; the
    `userId` form is `createCapabilityService(...).canActAsBuyer(userId)`.

## Owner decisions pending

Defaults applied after the security review. Each is deny-by-default and stays until the owner rules.

1. **Q1, narrower grants.** `moderation.act` is not held by `SUPPORT_LEAD`; `trade.dispute_escalate` is
   not held by `DISPUTE_REVIEWER`. `payout.retry` and `reconciliation.resolve` are two-step
   (`PAYOUT_RETRY`, `RECONCILIATION_RESOLVE` in `TWO_STEP_ACTIONS`) like refunds. Counts are now 212
   grants (SUPPORT_LEAD 18, DISPUTE_REVIEWER 7).
2. **Q3, no factorless staff.** A role grant is refused (409) for a user with no active second factor.
   This is in `insertAssignment`, so approvals and the break-glass script are held to it too.
3. **Q4, challenge evidence.** Approving an MFA reset needs `identityChallengeRef` (a ticket or call id,
   3 to 120 characters), recorded in the audit row. A bare boolean is gone.
4. **Q7, reason transport.** `X-Admin-Reason` is accepted beside `?reason=` and the body member.
5. **Self-action.** Every permission except `user.view`, `user.search`, `session.view`, `audit.view` and
   `role.view` refuses `subject === actor`.
6. **Staff targets.** When the subject holds a live staff role, only a `SUPER_ADMIN` may restrict,
   suspend, reinstate, close, revoke sessions, force-reset the password, request or approve an MFA
   reset or a forced handle change. `role.revoke` is exempt (the offboarding path).
7. **The subject** may neither approve nor reject an approval aimed at them.
8. **C6.** A grant with no `expiresAt` gets now plus 365 days, in the verdict and so in the row and the
   `ROLE_GRANT` payload. Never NULL.
9. **SUPER_ADMIN cap.** At most two live holders, counted under an advisory lock in `insertAssignment`.
10. **`consumeApproval`** now needs the exact payload (key order ignored), the requester as consumer, and
    a requester who still holds the permission.
11. **`canActAsBuyer(userId)`** has no in-flight flag. It is false for a non-ACTIVE user and for an
    ACTIVE merchant. The in-flight exception stays in the trades module, which does not call it for a
    trade it is continuing.
12. **Linked accounts** need `risk.view` (SUPER_ADMIN, OPERATIONS_ADMIN, COMPLIANCE_OFFICER,
    FRAUD_ANALYST), and the IP link looks back 90 days.
13. **`statusReason`** is shown only to roles holding `user.view_pii` or a status-change permission.
14. **One login budget.** `/auth/login` and `/auth/staff/login` share their per-identifier counter
    (`identifierBucket: 'password-login'`); each keeps its own IP and device budget.
15. **Denial audit.** Approve and reject refusals, self-grant and distinct-approver refusals, and the
    mount layer's scope and permission 403 on STAFF routes all write a DENIED row. The mount layer
    gained an optional `onDenied` hook that identity implements (`onAccessDenied` on the module).

## Break-glass: creating the first SUPER_ADMINs

The API cannot create the first SUPER_ADMIN (it needs a holder of `role.grant`). The path is a script:

```
pnpm --filter @komtru/backend-api db:bootstrap-super-admins -- --confirm-break-glass \
  --user <uuid> [--user <uuid>] --granted-by <uuid> --approved-by <uuid> --reason "<why>"
```

- Run by an operator with `POSTGRES_DIRECT_URL` (the owner), after `pnpm db:migrate`.
- The people to elevate must exist, be ACTIVE and have enrolled MFA (sign in as a consumer and enrol first).
- `--granted-by` and `--approved-by` are two other existing users who witness it; the database needs
  four distinct people on a dual-approval row.
- It refuses if any live SUPER_ADMIN assignment exists, takes the same lock as every SUPER_ADMIN write,
  gives each elevation the default one-year expiry, and writes one `SUPER_ADMIN_BOOTSTRAPPED` audit row
  per person naming the witnesses.
- Once two SUPER_ADMINs exist, everything else goes through the API.
