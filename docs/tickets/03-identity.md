# Epic 03 — Identity & access (M1)

Spec: `docs/specs/module-01-identity-and-user-management.md`. Decision C2 (design §5): staff, logistics and Park Agents are capabilities on one `users` row, separated by session scope.

---

### T-030 — Identity schema

- **Touches:** `src/modules/identity/infrastructure/postgres/schema/**`, migration `identity_*`
- **Depends on:** T-021, T-026
- **Acceptance criteria:**
  - Every M1 §5 table, enum, index and constraint, with `capability_type` holding `MERCHANT`, `MERCHANT_MEMBER` and `STAFF` (the opt-in `SELLER` capability is dropped, design §6.3), including: composite same-user FKs for primary email and phone (`ON DELETE SET NULL (column)`), verified-uniqueness partial indexes on normalised email and E.164 phone, the username format and pair `CHECK`s with the `::text` cast, `admin_role_assignments` four-eyes `CHECK`s and the dual-approval trigger, `session_scope` enum with `CONSUMER`, `STAFF`, `LOGISTICS`.
  - `identity_audit_log` is append-only: the trigger raises on update or delete and `komtru_app` lacks the privilege (both tested).
  - Integration tests prove: uppercase usernames rejected by the DB; one verified owner per email or phone under concurrent inserts; one primary per user; dual-approval roles cannot be inserted without an approver.
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-030-identity-schema.md`. All 22 M1 §5 tables live in an `identity` schema under `src/modules/identity/infrastructure/postgres/schema/`, pinned by a census test that asserts the exact set of tables, indexes, CHECKs, foreign keys and triggers. Enums deviate from M1 §5.1 exactly as this ticket directs: `capability_type` is MERCHANT / MERCHANT_MEMBER / STAFF (design §6.3) and `session_scope` gains LOGISTICS (design C2). `pgcrypto` is not created — `gen_random_uuid()` has been in `pg_catalog` since Postgres 13. **`drizzle.config.ts` changed:** its glob `./src/modules/*/schema.ts` did not reach this layout, so `./src/modules/*/infrastructure/postgres/schema/*.ts` was added alongside it. **`grantRuntimeAccess()` changed:** it now grants `komtru_app` USAGE (never CREATE) on `public`, which closes T-021's deferred "no USAGE on public for extensions" item. Without it the `citext` operators are invisible to the runtime role and `username = 'janedoe'` silently resolves to `text =`, missing `JaneDoe` while the unique index still fires — a wrong answer, not an error. Four hand-written migrations: `0004` the citext extension, `0007` the composite same-user keys (`ON DELETE SET NULL (column) DEFERRABLE INITIALLY DEFERRED`), `0009`/`0014` the dual-approval trigger, `0012` `appendOnly('identity.identity_audit_log')`. Beyond the spec, from review: `admin_role_self_approval` and `admin_action_self_approval` CHECKs, because M1 §5.7's four-eyes rule names only approver≠grantor and left the grantee free to approve their own elevation; the dual-approval trigger skips a row being revoked (it previously made an unapproved grant unrevokable by the app) and takes `FOR SHARE` on the role, with a second trigger refusing to set `requires_dual_approval` while unapproved live grants of that role exist; and every `DESC` index is `NULLS FIRST`, because drizzle's `.desc()` emits `NULLS LAST`, which `ORDER BY … DESC` cannot walk (measured: a Sort over the whole match set instead of an Index Scan under LIMIT). Errors a service can key on: `KT001` append-only, `KT002` dual approval. **For T-031/T-032/T-033:** the module barrel is `src/modules/identity/index.ts`; `user_emails.email_normal` and `user_phones.phone_e164` must be written from `normaliseEmail()` / `normalisePhone()` in `src/platform/identifiers.ts` — the database enforces E.164 format but cannot recompute `email_normal`, so an unnormalised write defeats the verified-uniqueness index.
- **Deferred:** no seed rows for `roles`, `permissions`, `role_permissions` or `reserved_usernames` (T-033, T-037); M1 §15 anonymisation and `user_addresses` are T-039 and T-042. Review minors left to the tickets that own the behaviour: `user_emails.email` and `email_normal` are unrelated columns, so a row pairing a victim's display address with an attacker's normalised one is accepted and `user_emails_email_idx` would then resolve the victim's address to it (T-032 must write both from one `normaliseEmail()` call); `users.primary_email_id` need not point at the row flagged `is_primary`, nor at a verified one (T-032); `user_phones.country_code` is NOT NULL while `normalisePhone()` returns it optionally for non-geographic E.164 numbers, and `phone_e164_format`'s `{7,14}` rejects a handful of valid short numbers (St Helena, Niue) — neither can receive an SMS OTP (T-032); `admin_role_active_unique` treats an expired but unrevoked grant as live, so a lapsed time-boxed grant blocks a regrant until `revoked_at` is set (T-037); `mfa_factors_one_default` lets a PENDING factor hold the default slot against an ACTIVE one (T-036); `mfa_factors.phone_id` and `sessions.parent_session_id` may cross users, as M1 §5.8 defines them (T-031, T-036); `KT001`/`KT002` are not exported as TypeScript constants (T-037 should add them when it first catches one); `verifyLockdown()` still asserts only negatives, so it does not positively prove the `public` USAGE grant took — a non-owner `GRANT` raises rather than degrading silently, and the grant is asserted in `test/db/roles.int.test.ts`.

### T-031 — Sessions, tokens and principal resolution

- **Touches:** `identity/domain/session/**`, `identity/services/{session,principal}.service.ts`, `identity/http/middleware.ts`
- **Depends on:** T-030, T-023
- **Acceptance criteria:**
  - EdDSA (Ed25519) access JWT, 10-minute TTL, carrying `sub`, `scp`, `epc`, `sid`; JWKS endpoint.
  - Opaque 256-bit refresh tokens stored as SHA-256, rotated on every use; replaying a consumed token revokes the whole family and publishes `identity.session.reuse_detected`.
  - Kill switch: `sessions_epoch` cached in Redis; suspension bumps the epoch, revokes all sessions and makes `/auth/refresh` re-check user status, all in one transaction (the M1 D5 test that catches the epoch-only bug).
  - `authenticate({ scope })` middleware applied at router level; the principal re-resolves roles and logistics membership on every request and caches nothing on the token.
  - Scope isolation suite: a token of each scope is rejected by routers of the other two scopes; a consumer refresh token can never mint a staff or logistics session.
  - TTLs: consumer 30 days sliding; staff 30-minute idle and 8-hour absolute (M1 C3); logistics uses the consumer TTLs unless the owner says otherwise.
- **Status:** Done (2026-10-06). Plan: `docs/superpowers/plans/2026-10-05-t-031-sessions.md`. EdDSA access tokens carry `sub`/`sid`/`scp`/`epc` and nothing else; everything that decides what a caller may do — scope, status, epoch, roles, permissions — is re-read from Postgres on every request by `resolvePrincipal`, in one indexed query. The `authenticate({ scope })` middleware the ticket names is **not** a per-router middleware: `defineRoute` is the only registration path, so `mountRoutes` enforces `route.scope` and `route.permission` for every route at once, which a router nobody remembers to wrap cannot match. The platform now owns the caller's shape (`src/platform/http/principal.ts`: `Actor`, `Principal`, `AuthFailure`) and identity fills it in; `idempotency.ts` and `rateLimit.ts` key on `actor.key`, the same `user:<uuid>` string as before. `KomtruModule` gained an optional `resolveActor` that at most one module may declare, and `src/modules/index.ts` became `createModules(deps)` because identity needs the process's connections before it can answer "who is calling". 401 means "refresh" (`UNAUTHENTICATED` / `TOKEN_EXPIRED` / `SESSION_REVOKED`, plus RFC 6750 `WWW-Authenticate`), 403 means "your credential is fine and the answer is still no" — a wrong-scope session must never be 401 or the api-client would refresh and then sign the user out of the app they are legitimately in. **The rotation-family integrity T-030 left open is enforced by the shape of one statement:** the child row is written by `INSERT … SELECT` in which `user_id`, `scope`, `family_id`, `amr` and `absolute_expires_at` are copied by Postgres from the parent and are never parameters, so no request body can move a session between users, scopes or families or extend the absolute deadline. **From review, the one real defect:** a family-wide revoke is a single `UPDATE`, and under READ COMMITTED its snapshot is taken when the statement starts — blocking on a row another transaction holds `FOR UPDATE` re-checks that row through EvalPlanQual but never re-scans for rows inserted meanwhile, so a rotation committing beside a revoke left its freshly minted child alive. The reuse alarm fired while the newest token still worked, and the same phantom defeated `revokeAllSessions`, so suspension leaked a session that could refresh into a token carrying the _new_ epoch — exactly the epoch-only kill switch bug M1 D5 names. Every write to one user's sessions now takes `pg_advisory_xact_lock` **before any row lock** (after it would deadlock a rotation against a revoke), with two tests that drive the interleaving deterministically by parking a rotation inside its open transaction. Also from review: `/auth/refresh` is `retryable: false`, because the idempotency gate stores a completed response as plaintext jsonb for 24 hours and this one carries both tokens — declaring it retryable would undo `sessions.refresh_token_hash` and hand a request-capturing attacker the child token with a 200 instead of tripping reuse detection; the epoch cache compares with `<` rather than `!==`, since `sessions_epoch` only increases and a cache entry left behind the database would otherwise 401 a valid token for a whole TTL; `req.ip` is checked with `net.isIP` before it reaches an `inet` column; and `assertRouteInvariants` now refuses a `permission` on a `PUBLIC` route, where it could never be checked. New config: `IDENTITY_SIGNING_KEY` (64 hex = a raw Ed25519 seed, which is what the live `.env` holds; the public half is derived, so there is no second variable to keep in sync), `IDENTITY_SIGNING_KEY_ID`, `IDENTITY_ACCESS_TOKEN_TTL_SECONDS`, `IDENTITY_TOKEN_ISSUER`, `IDENTITY_TOKEN_AUDIENCE`, `IDENTITY_EPOCH_CACHE_TTL_SECONDS`. `JWT_SECRET` is deliberately unused — EdDSA needs no shared secret. Dependency added: `jose` 6.2.12. No migration. **For T-032/T-037/T-039/T-086:** `createSession(tx, deps, input)` takes _your_ transaction so a login is atomic with its audit and device rows; the scope passed there is the only place a scope is ever chosen, and a refresh can never change it. Password change is `revokeAllSessions(tx, { userId, reason, exceptSessionId })`; suspension must do `bumpSessionsEpoch` + `revokeAllSessions` + the status change in one transaction, then `epochs.invalidate` after the commit (`applyKillSwitch` is the standalone version). `Principal.companyMembership` is carried on every request and is always `null` until T-086 supplies the `logistics_company_members` lookup to `createIdentityAuth`.
- **Deferred:** the consumer **absolute** TTL is 365 days — M1 pins only "30 days sliding" and the column is `NOT NULL`, so the number is this build's and is one constant in `domain/session/ttl.ts` for the owner to change. No grace window on a replayed refresh token: a benign cross-tab double-submit kills the family, which is what M1 D5 prescribes, but the mitigation belongs in T-017's route handler. Login routes (`/auth/{consumer,staff,logistics}/login`) are T-032's; `GET /me/sessions` and `DELETE /me/sessions/{id}` are not built by any ticket yet. JWKS publishes one key and has no rotation or overlap window. JWKS is served at `/v1/.well-known/jwks.json`, because `defineRoute` is the only way to register a route and every route mounts under `/v1`; the edge should alias the conventional root path. The `permission` check is a flat `has()` with no catalogue behind it until T-037. `resolvePrincipal` does not reject a session whose `consumed_at` is set — that is the refresh token's state, the access token beside it is bounded by its own 10-minute `exp`, and every revocation path revokes the whole family (endorsed in review, but it is the one place this ticket chose smoothness over the strictest reading of M1 §9.2). The per-IP budget on `/auth/refresh` is 300/min because Nigerian carrier-grade NAT makes one IP thousands of people; the per-token key is what bounds abuse, and neither bounds guessing (nothing needs to, at 256 bits).

### T-032 — Registration, OTP and password login

- **Touches:** `identity/services/{auth,otp,credential,contact}.service.ts`, `identity/http/auth.controller.ts`
- **Depends on:** T-031, T-045
- **Cannibalized:** `identity/domain/credential/hashing.ts`, `breach.ts` (T-001)
- **Acceptance criteria:**
  - Phone-first and email registration (HTML E2, E3), OTP challenges delivered through `notify` jobs (SMS via Termii, email via Mailjet), wrong-code state (E3b), login by email, phone or username (E4), forgot and reset password (AC2, AC3), change password revoking other sessions.
  - argon2id per the lifted parameters with transparent rehash; k-anonymity breach check behind `IDENTITY_BREACH_CHECK_ENABLED`.
  - Uniform failure responses: login latency for existing vs. non-existent users differs by less than 5ms over 1,000 samples; forgot-password responses are identical for known and unknown identifiers.
  - Rate limits per IP, per identifier and per device on every auth route; OTP verify attempts capped.
  - Terms acceptance captured at registration (TOS1) with versions; re-acceptance flow for updated terms (TOS2).
  - Events: `identity.user.registered`, `identity.email.verified`, `identity.phone.verified`, `identity.login.failed`.

### T-033 — Username system

- **Touches:** `identity/domain/username/**`, `identity/services/username.service.ts`
- **Depends on:** T-030
- **Cannibalized:** `identity/domain/username/skeleton.ts`, `reserved.ts` (T-001)
- **Acceptance criteria:**
  - Every M1 §17 username test: skeleton collisions (`dellstore`, `dell.store`, `dellst0re`, `de11st0re`, `dellstoree`), reserved words including confusable variants, cooldown, lifetime cap, active-trade block, 90-day quarantine with 30-day owner reclaim, historical username preserved on trades, anonymisation tombstone with 10,000 existing users.
  - Availability endpoint rate-limited at 20 per minute; suggestions on collision.
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-033-usernames.md`. Scope was usernames **and** the M1 §12 RBAC catalogue, which `src/platform/http/route.ts` already names as T-033's (`permission?: string` — "from the catalogue (T-033)") and which T-030 deferred here. Domain under `identity/domain/username/` (skeleton, reserved, policy, suggest) and `identity/domain/rbac/catalog.ts`; `identity/services/username.service.ts`; `identity/http/username.controller.ts` for the four §10.3 routes; `identityModule` registered in `src/modules/index.ts`. **No migration:** `KomtruModule` gains an optional `seed?: (db) => Promise<void>` hook, run by `pnpm db:migrate` after the migrations (and alone as a new `pnpm db:seed`), so the catalogue and the reserved namespace are reconciled from code on every deploy. It is idempotent, takes `pg_advisory_xact_lock` so two deploys cannot interleave, reconciles `role_permissions` downwards but never deletes from `reserved_usernames` (Trust & Safety owns that table at runtime), and writes `requires_dual_approval` in the INSERT because T-030's backfill trigger refuses the flip afterwards. The catalogue is `Record<PermissionCode, Record<RoleCode, Grant>>` with no `Partial`, so a 23rd permission is a **compile error** until it has a matrix row; `test/modules/identity/domain/rbac/matrix.test.ts` re-parses M1 §12.3's own markdown table and compares all 264 cells plus the counts (22 × 12, 105 grants, per-role totals) — both guards were exercised by temporarily adding `geo.manage` and confirming `tsc` and 14 cases fail. §12.3's footnotes are data (`TICKET_SCOPED_PII`, `READ_ONLY_TIME_BOXED`, `ADMIN_ACTION_APPROVAL`, `DOCUMENTED_USER_REQUEST`), and a conditional grant is a grant at the catalogue layer — T-037 enforces the condition. **Defects found in the cannibalized code** (`skeleton.ts`, `reserved.ts`): reserved matching folded only the candidate against the reserved word's canonical fold, so `@fiutterwave` was claimable beside a reserved `@flutterwave`; `BLOCKED_SUBSTRING_SEED` held literal words no skeleton can contain (`officialsupport` vs `oficialsuport`), so three of its four compound entries never fired; `collapseRuns` compared a code point against the last UTF-16 unit and never collapsed astral runs; and — found in review — the multigraph pass and the narrow-glyph pass are two independent axes, so a handle taking one substitution from each (`@adrn1n` for `admin`, `@vvailet` for `wallet`) matched neither fold. `skeletonVariants` now returns the closure of both passes in both orders: of 3,958 generated impersonations of the 89 seed words, 79 escaped before and 7 after (all one construction on `flutterwave`), with zero false positives over 67 plausible Nigerian handles.
- **Deferred:** **user-to-user confusable matching still compares the canonical fold only**, so `@delistore` is claimable beside `@dellstore` and `@iagosdeals` beside `@lagosdeals` — reserved words are better defended than storefronts, which is backwards. The honest fix is a `users.username_skeleton_narrow` column with its own UNIQUE index, which is a migration this batch forbids; a service-side scan would be a full table scan on a PUBLIC route and still a check-then-insert race, so the gap is documented at `holder()` in `username.service.ts` rather than papered over. **Needs its own ticket.** M1 §6.2's profanity and hate list is not seeded (locale-specific; belongs in `reserved_usernames` with `category = 'OFFENSIVE'` via T-037's `username.reserve`). §6.4's "notify all counterparties from the last 90 days" needs M3 trade data — `identity.username.changed` carries `from`/`to` and is the seam. `hasActiveTrade` and `hasCompletedTrades` are injected ports defaulting to `false` until T-061 supplies them, so the active-trade block and the verified-seller support gate are wired but inert. The cross-user quarantine race (A releases `@foo` as B claims it) spans two tables and cannot be an index; the cooldown and lifetime cap are serialised by `FOR UPDATE` on the caller's own row. Routes declare `scope` and read `ctx.actor` as `user:<uuid>`; T-031 supplies `resolveActor` and `authenticate({ scope })`, until which the three `/me` routes answer 401 to everyone.

### T-034 — Social login

- **Touches:** `identity/infrastructure/providers/{google,apple,facebook}.ts`, `identity/domain/social/linking.ts`, `identity/services/social.service.ts`
- **Depends on:** T-032
- **Acceptance criteria:**
  - Google, Apple and Facebook (design C17) with PKCE and signed single-use `state`.
  - The §7.4 linking decision tree rewritten from the old reference with full tests: never auto-link an unverified provider email; auto-link only when the target has no password, no other social identity, no passkey and no active MFA; otherwise step-up via `confirm-link`.
  - Apple first-callback email persisted and not nulled by later callbacks.
  - The synchronous code exchange is the documented exception in T-028, with timeout and circuit breaker; JWKS cached by a scheduled job.
  - Staff scope can never be obtained via social login (M1 C2).
  - **T-028:** the code exchange uses `providerRequest` wrapped in `createCircuitBreaker` from `src/platform/providers/`; the provider calls live in `identity/infrastructure/providers/<provider>.client.ts`, which only `identity/jobs/` and the one documented synchronous callback path may import.

### T-035 — Party lookup and invitations

- **Touches:** `identity/services/party.service.ts`, `identity/http/party.controller.ts`
- **Depends on:** T-033, T-032
- **Acceptance criteria:**
  - `PartyCard` is the only shape returned, and it includes `canBuy` (false for certified merchants, design §6.3); lookup by username, email or phone; typeahead (≥3 chars, prefix, max 8).
  - Anti-enumeration: identical shape and timing for a miss and for `discoverable_by_* = false`; per-user, per-device and per-IP limits.
  - Party invitations bind on verification (claim-on-verify) and publish `identity.party_invitation.claimed` and `.expired` for trades.

### T-036 — Devices, MFA and passkeys

- **Touches:** `identity/services/{device,mfa,passkey}.service.ts`
- **Depends on:** T-032
- **Acceptance criteria:**
  - Device registry with fingerprint and push token; TOTP enrol and activate (HTML TF1), recovery codes shown once (TF2), SMS OTP factor, WebAuthn passkeys, step-up for sensitive actions; removing a factor requires step-up.
  - MFA mandatory for any user holding a staff role (forced-setup state, M1 C4).

### T-037 — RBAC catalog, staff login and admin endpoints

- **Touches:** `identity/domain/rbac/{catalog,sod}.ts`, `identity/services/{rbac,approval,user}.service.ts`, `identity/http/admin.controller.ts`, `test/rbac/matrix.test.ts`
- **Depends on:** T-036
- **Acceptance criteria:**
  - One permission catalog for the whole platform: M1's 22 identity permissions plus every module's slice (trade, payment, payout, reconciliation, dispute, verification, duplicate flag, ticket, risk, logistics, park, cases, config, audit, analytics, growth, messaging moderation). Roles per M1 §12.1 plus `DISPUTE_LEAD` (M3) and `PARK_OPERATIONS` (owner can rename). Includes `geo.manage` and `merchant.application.view` / `merchant.application.decide`, the latter two granted to `SUPER_ADMIN`, `OPERATIONS_ADMIN` and `KYC_ANALYST`; the matrix counts are updated for them.
  - Exhaustive matrix test over every permission × every role from a single table; adding a permission without placing it fails CI, and the counts are asserted.
  - `POST /auth/staff/login` (password + MFA only), separate from consumer login.
  - Capability service with `canActAsBuyer(userId)`, false while an `ACTIVE` `MERCHANT` capability exists, exported from the identity barrel and unit-tested, including the rule that trades already in flight finish normally.
  - Self-dealing block at the permission layer (M1 C5), time-boxed role grants, dual approval for `FINANCE_ADMIN`, `SUPER_ADMIN`, `COMPLIANCE_OFFICER`, two-step actions through `admin_action_approvals` (MFA reset, forced username change, verification override, large refunds).
  - Admin endpoints per M1 §10.6, all paginated, each requiring a reason (400 without one) and writing an audit row.

### T-038 — Staff invitations

- **Touches:** `identity/services/staffInvitation.service.ts`, `identity/http/staffInvitation.controller.ts`
- **Depends on:** T-037
- **Acceptance criteria:**
  - Invite by email with role and expiry; the invitation stores a hashed lookup and an encrypted destination, never plaintext; acceptance requires OTP proof of the address; no `users` row is created before that proof.
  - Existing users gain the role on acceptance; new users register through the normal flow and the invitation binds on verification.
  - Same shape later reused by logistics member invitations (T-086).

### T-039 — Account lifecycle, recovery and NDPA hooks

- **Touches:** `identity/services/{lifecycle,recovery,ndpa}.service.ts`
- **Depends on:** T-037
- **Acceptance criteria:**
  - Status machine per M1 §9.1 (restrict, suspend, reinstate, lock, close, anonymise) with `identity.user.status_changed`; suspension screens data (AS1, AS2) available via `/me`.
  - Close account blocked while any trade is active (CA1, CA2).
  - Account recovery requests with human review above threshold; opens a support ticket via event.
  - Data export and erasure requests hand off to compliance (T-104); anonymisation procedure per M1 §15 including avatar tombstoning through files.

### T-042 — Saved delivery addresses

- **Touches:** `identity/services/address.service.ts`, `identity/http/me.controller.ts`, migration `identity_addresses`
- **Depends on:** T-030, T-046
- **Acceptance criteria:**
  - `user_addresses`: label, recipient name, recipient phone (E.164), street line, landmark, `state_id` and `city_id` (soft references to the catalog), default flag (one default per user, partial unique index), `archived_at`.
  - `GET /me/addresses` (paginated), `POST`, `PATCH`, archive, and make-default. The city must belong to the chosen state and be active (422 otherwise).
  - Addresses are archived, never deleted, because trades snapshot them.
  - `hasUsableAddress(userId)` exported for the trade gates in T-061.
