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
