# T-030 Identity Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The whole of M1 §5 — every table, enum, index and constraint — exists in its own `identity` Postgres schema, with the invariants that money and impersonation depend on (one verified owner per address, one primary per user, same-user primary pointers, four-eyes role grants, an audit log that cannot be rewritten) enforced by the database rather than by application code.

**Architecture:** Drizzle `pgSchema('identity')` declarations live under `src/modules/identity/infrastructure/postgres/schema/`, one file per cluster of tables, re-exported through a barrel and through the module's `index.ts`. `drizzle-kit generate` produces the tables, enums, checks and partial indexes; the four things drizzle cannot express — the `citext` extension, the composite same-user foreign keys with `ON DELETE SET NULL (column)`, the dual-approval trigger, and `appendOnly('identity.identity_audit_log')` — go in `--custom` migrations immediately after the generated migration that creates the objects they attach to. No service ever does check-then-insert: every concurrency-sensitive rule is a partial unique index.

**Tech Stack:** drizzle-orm 0.45 (`pgSchema`, `pgEnum`, `customType`, `check`, partial `uniqueIndex`), drizzle-kit 0.31, node-postgres, Postgres 16, Vitest 5 with the per-worker template-clone harness (`test/support/db.ts`).

**Spec:** M1 §5 (and §6.3, §9.1, §11, §12) in `docs/specs/module-01-identity-and-user-management.md`; design §4.2 and §6.3 in `docs/superpowers/specs/2026-10-05-komtru-platform-design.md`; ticket T-030 in `docs/tickets/03-identity.md`.

## Global Constraints

- Everything lives in the `identity` schema. Nothing lives in `public` except the `citext` extension's own objects. Same-schema foreign keys are real with explicit `onDelete`; cross-schema references (`avatar_file_id` → M20, `ticket_id` → M10, `evidence_refs` → M20, `context_id` → M7) are plain `uuid`/`uuid[]` with no `REFERENCES`.
- `capability_type` is `('MERCHANT', 'MERCHANT_MEMBER', 'STAFF')`. The opt-in `SELLER` capability of M1 §5.1 is **dropped** (design §6.3: any account can sell; `MERCHANT` is the certified, sell-only capability).
- `session_scope` is `('CONSUMER', 'STAFF', 'LOGISTICS')` — M1 §5.1 lists only the first two; the third is design C2 (logistics staff are a capability on the same `users` row, separated by session scope) and is required by ticket T-031.
- The runtime role is `komtru_app`, not the spec's `kumtru_app`. Grants are never hand-written in a migration: `grantRuntimeAccess()` (T-021) runs after every migrate and recognises append-only tables by their `komtru_append_only` trigger.
- `pgcrypto` is **not** created: `gen_random_uuid()` has been in `pg_catalog` since Postgres 13, and an extension nobody needs is an extension nobody patches.
- Concurrency-sensitive invariants are partial unique indexes in the database, never check-then-insert in a service (design §4.4).
- `src/platform/identifiers.ts` (T-026) is authoritative for _producing_ `user_emails.email_normal` (provider dot/plus folding) and `user_phones.phone_e164` (E.164 via libphonenumber-js). The database is authoritative for _enforcing_ them: the partial unique indexes cover `email_normal` and `phone_e164`, and `phone_e164_format` rejects anything that is not E.164. The database cannot recompute `email_normal`, so there is no CHECK on it — a caller that writes an unnormalised value defeats the index, and that is the one rule T-032 must respect.
- TypeScript 6 strict, ESM with `.js` import extensions, plain exported functions. Comments are sparse and explain _why_.
- Integration tests are `*.int.test.ts` under `test/modules/identity/infrastructure/postgres/`, inside `describe.runIf(infraEnabled)` with `useTestDatabase()`.

## Review Focus

1. `citext` columns compared by `komtru_app` must fold case. `REVOKE ALL ON SCHEMA public FROM PUBLIC` (migration 0001) leaves the runtime role without `USAGE` on `public`, so `username = 'janedoe'` silently resolves to `text =` and every case-insensitive lookup misses while the unique index still fires — a wrong answer, not an error (Task 1).
2. Deleting a `users` row that has both a primary email and a primary phone must succeed: `user_emails.user_id` cascades from `users` while `users.primary_email_id` points back at `user_emails`, and only `DEFERRABLE INITIALLY DEFERRED` makes that cycle resolvable (Task 4).
3. Two transactions verifying the same address at the same time must not both commit. The partial unique index has to be the thing that stops the second one (Task 3).
4. `users.primary_email_id` set to another user's email row must be rejected — a simple FK on the column alone would accept it, which is how a password reset gets sent to an attacker (Task 4).
5. The dual-approval trigger must fire on `UPDATE` as well as `INSERT`: clearing `approved_by` after the grant is the obvious way around a BEFORE INSERT-only guard (Task 5).

---

### Task 1: `citext` available to the runtime role

**Files:**

- Modify: `apps/backend-api/src/db/roles.ts` (`grantRuntimeAccess`)
- Create: `apps/backend-api/drizzle/0004_identity_citext.sql` (via `pnpm --filter @komtru/backend-api db:generate --custom`)
- Modify: `apps/backend-api/drizzle/meta/_journal.json` (tag `0004_identity_citext`)
- Test: `apps/backend-api/test/db/roles.int.test.ts`

**Interfaces:**

- Produces: the `citext` type and operators in `public`, visible to `komtru_app`. No new exported symbols.

- [ ] **Step 1: Write the failing tests** — append to the `runtime role` describe in `test/db/roles.int.test.ts`:

```ts
it('lets the runtime role resolve the citext type and its operators', async () => {
  const { rows } = await t.app().query<{ same: boolean }>(`SELECT 'Alice'::citext = 'alice'::citext AS same`);
  expect(rows[0]?.same).toBe(true);
});

it('gives the runtime role USAGE on public without CREATE', async () => {
  const { rows } = await t.app().query<{ usage: boolean; create: boolean }>(
    `SELECT has_schema_privilege('komtru_app', 'public', 'USAGE') AS usage,
            has_schema_privilege('komtru_app', 'public', 'CREATE') AS create`,
  );
  expect(rows[0]).toEqual({ usage: true, create: false });
});
```

- [ ] **Step 2: Run `cd apps/backend-api && KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/db/roles.int.test.ts`** — expect FAIL (`type "citext" does not exist`, and `usage: false`).
- [ ] **Step 3: Create the custom migration and the grant.** `pnpm --filter @komtru/backend-api db:generate --custom`, rename the emitted file to `drizzle/0004_identity_citext.sql`, update its `tag` in `drizzle/meta/_journal.json`, and put `CREATE EXTENSION IF NOT EXISTS citext;` in it with a header saying why the extension lives in `public` (its operators must be in the default `search_path`, or a `citext = citext` comparison degrades to `text =`). In `grantRuntimeAccess()`, next to the database-level grants, add `GRANT USAGE ON SCHEMA public TO ${role}` with a comment stating the same reason; `public` stays in `SYSTEM_SCHEMAS` so nothing else about it changes, and `verifyLockdown()` still proves `CREATE` is absent.
- [ ] **Step 4: Run the same command** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): make citext usable by the runtime role`

---

### Task 2: The `identity` schema, its column types and its enumerations

**Files:**

- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/columns.ts`
- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/enums.ts`
- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/index.ts`
- Create: `apps/backend-api/src/modules/identity/index.ts`
- Modify: `apps/backend-api/drizzle.config.ts`
- Create: `apps/backend-api/drizzle/0005_identity_enums.sql` (via `db:generate`)
- Create: `apps/backend-api/test/modules/identity/infrastructure/postgres/support.ts`
- Test: `apps/backend-api/test/modules/identity/infrastructure/postgres/enums.int.test.ts`

**Interfaces:**

- Produces, from `columns.ts`:
  - `identity` — `pgSchema('identity')`
  - `citext` — `customType<{ data: string }>` with `dataType: () => 'citext'`
  - `bytea` — `customType<{ data: Buffer; driverData: Buffer }>` with `dataType: () => 'bytea'`
- Produces, from `enums.ts` (every one declared on `identity`, so the type lands in the module schema): `userStatus`, `verificationLevel`, `capabilityType`, `capabilityStatus`, `socialProvider`, `mfaFactorType`, `mfaFactorStatus`, `otpPurpose`, `otpChannel`, `sessionScope`, `deviceStatus`, `invitationStatus` — labels exactly as in M1 §5.1, with the two Global-Constraints deviations.
- Produces, from `test/.../support.ts`:
  - `sqlState(query: Promise<unknown>): Promise<string>` — the `SQLSTATE` of a rejected query, or `'no error'` (copy the helper used in `test/db/platform-events.int.test.ts`).
  - `enumLabels(owner: pg.Pool, name: string): Promise<string[]>` — labels of `identity.<name>` in `enumsortorder`.
  - `insertUser(pool: pg.Pool, overrides?: Record<string, unknown>): Promise<string>` — inserts a minimal `identity.users` row (generated `public_id`) and returns its `id`. Added in Task 3 once `users` exists; declared here so later tasks know the name.

- [ ] **Step 1: Write the failing test** `enums.int.test.ts`:

```ts
it.each([
  [
    'user_status',
    ['PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'LOCKED', 'CLOSED', 'ANONYMISED'],
  ],
  [
    'verification_level',
    ['UNVERIFIED', 'CONTACT_VERIFIED', 'IDENTITY_VERIFIED', 'BUSINESS_VERIFIED', 'ENHANCED'],
  ],
  ['capability_type', ['MERCHANT', 'MERCHANT_MEMBER', 'STAFF']],
  ['capability_status', ['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']],
  ['social_provider', ['GOOGLE', 'APPLE', 'FACEBOOK']],
  ['mfa_factor_type', ['TOTP', 'SMS_OTP', 'EMAIL_OTP', 'PASSKEY', 'RECOVERY_CODE']],
  ['mfa_factor_status', ['PENDING', 'ACTIVE', 'REVOKED']],
  [
    'otp_purpose',
    [
      'REGISTRATION',
      'LOGIN',
      'PHONE_VERIFICATION',
      'EMAIL_VERIFICATION',
      'PASSWORD_RESET',
      'MFA_CHALLENGE',
      'SENSITIVE_ACTION',
      'ACCOUNT_RECOVERY',
    ],
  ],
  ['otp_channel', ['SMS', 'EMAIL', 'WHATSAPP', 'VOICE']],
  ['session_scope', ['CONSUMER', 'STAFF', 'LOGISTICS']],
  ['device_status', ['ACTIVE', 'TRUSTED', 'BLOCKED', 'RETIRED']],
  ['invitation_status', ['PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED']],
])('creates identity.%s with the spec labels in order', async (name, labels) => {
  expect(await enumLabels(t.owner(), name)).toEqual(labels);
});

it('has no SELLER capability', async () => {
  expect(await enumLabels(t.owner(), 'capability_type')).not.toContain('SELLER');
});
```

- [ ] **Step 2: Run `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/modules/identity`** — expect FAIL (empty label arrays: the types do not exist).
- [ ] **Step 3: Write `columns.ts` and `enums.ts`, extend the drizzle-kit glob, generate.** `drizzle.config.ts`'s `schema` array must gain `'./src/modules/*/infrastructure/postgres/schema/*.ts'` — the existing `'./src/modules/*/schema.ts'` does not reach these files; say so in a comment and in the ticket status line. `index.ts` re-exports `./columns.js` and `./enums.js` (and each later task's file); `src/modules/identity/index.ts` re-exports the schema barrel, which is the only way other modules may reach these tables (the `komtru/module-boundaries` ESLint rule). Then `pnpm --filter @komtru/backend-api db:generate`, rename the emitted file to `0005_identity_enums.sql`, update its `tag`, and read it: it must contain `CREATE SCHEMA "identity";` and twelve `CREATE TYPE` statements and nothing else.
- [ ] **Step 4: Run the same command** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): add the identity schema and its enumerations`

---

### Task 3: `users`, `user_profiles`, `user_emails`, `user_phones`

**Files:**

- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/users.ts`
- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/contacts.ts`
- Modify: `.../schema/index.ts`
- Create: `apps/backend-api/drizzle/0006_identity_core.sql` (via `db:generate`)
- Modify: `apps/backend-api/test/modules/identity/infrastructure/postgres/support.ts` (add `insertUser`)
- Test: `apps/backend-api/test/modules/identity/infrastructure/postgres/users.int.test.ts`, `.../contacts.int.test.ts`

**Interfaces:**

- Consumes: Task 2's `identity`, `citext`, `userStatus`, `verificationLevel`.
- Produces: `users`, `userProfiles` (from `users.ts`); `userEmails`, `userPhones` (from `contacts.ts`). Columns exactly as M1 §5.2–5.4. `users.primaryEmailId` / `users.primaryPhoneId` are plain `uuid` here — the FKs arrive in Task 4. Constraints carried in drizzle: `users_username_format` (`CHECK (username IS NULL OR username::text ~ '^[a-z][a-z0-9._]{2,29}$')` — the `::text` cast is load-bearing, citext folds case in `~`), `users_username_pair`, `profile_bio_len`, `phone_e164_format` (`^\+[1-9][0-9]{7,14}$`). Indexes: `users_status_idx`, `users_created_at_idx` (DESC), `users_ver_level_idx`, `user_emails_verified_unique` (unique on `email_normal` `WHERE verified_at IS NOT NULL`), `user_emails_one_primary` (unique on `user_id` `WHERE is_primary`), `user_emails_user_idx`, `user_emails_email_idx`, `user_emails_id_user` (unique on `(id, user_id)`), and the four `user_phones_*` equivalents on `phone_e164`.

- [ ] **Step 1: Write the failing tests.** `users.int.test.ts`:

```ts
it('rejects an uppercase username in the database', …);            // 'JaneDoe' → 23514, users_username_format
it.each([['ab'], ['1jane'], ['jane-doe'], ['a'.repeat(31)]])('rejects %s', …);   // 23514
it('accepts a username with dots and underscores', …);             // 'jane.doe_01' inserts
it('rejects a username without a skeleton', …);                    // 23514, users_username_pair
it('rejects a skeleton without a username', …);                    // 23514, users_username_pair
it('treats usernames case-insensitively for uniqueness', …);       // 'janedoe' then 'JaneDoe' → 23505
it('finds a username case-insensitively', …);                      // WHERE username = 'JANEDOE' returns the row
it('rejects a duplicate public_id', …);                            // 23505
it('defaults status, verification_level and sessions_epoch', …);   // PENDING_VERIFICATION, UNVERIFIED, 1
it('caps a profile bio at 500 characters', …);                     // 501 chars → 23514, profile_bio_len
```

`contacts.int.test.ts`:

```ts
it('allows one primary email per user', …);                        // second is_primary row → 23505
it('allows many non-primary emails', …);
it('allows two unverified rows for the same normalised address', …);
it('allows only one verified owner of a normalised address', …);   // 23505
it('rejects a second verified owner inserted concurrently', …);    // two clients, BEGIN/INSERT both, commit order → one 23505
it('allows one primary phone per user', …);
it('allows only one verified owner of an E.164 number', …);
it('rejects a second verified owner of a number inserted concurrently', …);
it.each([['08012345678'], ['+0801234567'], ['+234'], ['+2348012345678901234']])('rejects %s as a phone', …);  // 23514
it('accepts a valid E.164 number', …);                             // '+2348012345678'
it('deletes a user\'s emails and phones with the user', …);        // ON DELETE CASCADE
```

The concurrent tests take two `pg.Client`s from `t.app()`, `BEGIN` on both, `INSERT … verified_at = now()` on both (the second blocks on the index), `COMMIT` the first, and assert the second rejects with `23505`.

- [ ] **Step 2: Run `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/modules/identity`** — expect FAIL (`relation "identity.users" does not exist`).
- [ ] **Step 3: Write `users.ts` and `contacts.ts`, add them to the barrel, generate `0006_identity_core.sql`, rename it, update the `tag`, and read it.** Confirm the generated SQL casts the username regex to `::text`, that both `*_verified_unique` indexes carry their `WHERE` clause, and that it creates no foreign key from `users` to `user_emails` or `user_phones`.
- [ ] **Step 4: Run the same command** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): add identity users, profiles and contact channels`

---

### Task 4: Composite same-user foreign keys for the primary contacts

**Files:**

- Create: `apps/backend-api/drizzle/0007_identity_same_user_fks.sql` (via `db:generate --custom`)
- Modify: `apps/backend-api/drizzle/meta/_journal.json`
- Modify: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/users.ts` (comment only: the FKs are custom SQL, so a reader of the drizzle table knows where to find them)
- Test: `apps/backend-api/test/modules/identity/infrastructure/postgres/primary-contacts.int.test.ts`

**Interfaces:**

- Consumes: Task 3's `users`, `user_emails`, `user_phones` and the `user_emails_id_user` / `user_phones_id_user` unique indexes.
- Produces: constraints `users_primary_email_fk` and `users_primary_phone_fk`, both `FOREIGN KEY (primary_*_id, id) REFERENCES user_*(id, user_id) ON DELETE SET NULL (primary_*_id) DEFERRABLE INITIALLY DEFERRED`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('accepts a primary email belonging to the same user', …);
it('rejects a primary email belonging to another user', …);        // 23503, users_primary_email_fk
it('rejects a primary phone belonging to another user', …);        // 23503, users_primary_phone_fk
it('nulls the pointer when the email row is deleted', …);          // DELETE the email → users.primary_email_id IS NULL, user still there
it('nulls the pointer when the phone row is deleted', …);
it('deletes a user that has a primary email and a primary phone', …);  // cascade + SET NULL cycle resolves
it('defers the check to commit', …);                               // in one tx: UPDATE users SET primary_email_id = $new, then INSERT the email row; COMMIT succeeds
```

- [ ] **Step 2: Run `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/modules/identity`** — expect FAIL (the cross-user insert is accepted).
- [ ] **Step 3: Write the custom migration.** `db:generate --custom`, rename to `0007_identity_same_user_fks.sql`, update the `tag`, and write the two `ALTER TABLE identity.users ADD CONSTRAINT …` statements separated by `--> statement-breakpoint`. The header explains what the spec's comment explains: a simple FK on `(primary_email_id)` would let user A's primary email point at user B's row, and `ON DELETE SET NULL (column)` needs Postgres 15+.
- [ ] **Step 4: Run the same command** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): add same-user foreign keys for primary contacts`

---

### Task 5: Credentials, social identities, capabilities and admin RBAC

**Files:**

- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/credentials.ts`
- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/rbac.ts`
- Modify: `.../schema/index.ts`
- Create: `apps/backend-api/drizzle/0008_identity_rbac.sql` (via `db:generate`)
- Create: `apps/backend-api/drizzle/0009_identity_dual_approval.sql` (via `db:generate --custom`)
- Modify: `apps/backend-api/drizzle/meta/_journal.json`
- Test: `apps/backend-api/test/modules/identity/infrastructure/postgres/rbac.int.test.ts`

**Interfaces:**

- Consumes: Task 2's enums and `bytea`, Task 3's `users`.
- Produces: `userCredentials`, `socialIdentities` (from `credentials.ts`); `userCapabilities`, `roles`, `permissions`, `rolePermissions`, `adminRoleAssignments`, `adminActionApprovals` (from `rbac.ts`), all per M1 §5.5–5.7. Checks in drizzle: `admin_role_distinct_approver`, `admin_role_no_self_grant`, `admin_action_distinct_approver`. Partial unique indexes: `social_identities_provider_subject` on `(provider, provider_user_id) WHERE unlinked_at IS NULL`, `social_identities_one_per_provider` on `(user_id, provider) WHERE unlinked_at IS NULL`, `user_capabilities_unique` on `(user_id, capability)`, `admin_role_active_unique` on `(user_id, role_code) WHERE revoked_at IS NULL`, `admin_action_approvals_pending_idx` on `(action, requested_at) WHERE approved_at IS NULL AND rejected_at IS NULL`, `admin_role_expiry_idx` on `(expires_at) WHERE revoked_at IS NULL`. Function `identity.enforce_dual_approval()` and trigger `admin_role_dual_approval` from the custom migration.

- [ ] **Step 1: Write the failing tests** in `rbac.int.test.ts`:

```ts
it('holds one credential row per user', …);                        // second insert → 23505 (PK on user_id)
it('lets a social-only user have no credential row', …);
it('rejects a second live link for the same provider subject', …); // 23505
it('allows relinking a provider subject after unlinking', …);      // unlinked_at set → second insert succeeds
it('rejects a second live identity for the same user and provider', …);
it('rejects a duplicate capability for one user', …);              // 23505
it('accepts MERCHANT, MERCHANT_MEMBER and STAFF capabilities', …);
it('rejects a SELLER capability', …);                              // 22P02, invalid input value for enum
it('rejects an approver who is also the grantor', …);              // 23514, admin_role_distinct_approver
it('rejects a self-grant', …);                                     // 23514, admin_role_no_self_grant
it('rejects a dual-approval role with no approver', …);            // trigger raises, message matches /requires a second approver/
it('rejects clearing the approver on a dual-approval role', …);    // UPDATE … SET approved_by = NULL raises
it('accepts a single-approval role with no approver', …);
it('rejects a second live assignment of the same role to the same user', …);  // 23505
it('allows regranting a role after it is revoked', …);
it('rejects an approver who is also the requester of an admin action', …);    // 23514
it('cascades role_permissions when a role is deleted', …);
```

- [ ] **Step 2: Run `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/modules/identity`** — expect FAIL.
- [ ] **Step 3: Write both schema files, generate `0008_identity_rbac.sql`, then the custom `0009_identity_dual_approval.sql`.** Rename both and update their `tag`s. The custom migration creates `identity.enforce_dual_approval()` (`LANGUAGE plpgsql`, raising `'role % requires a second approver'` when `roles.requires_dual_approval` is true and `NEW.approved_by IS NULL`) and the `BEFORE INSERT OR UPDATE … FOR EACH ROW` trigger on `identity.admin_role_assignments`. Its header says why this is a trigger and not a CHECK: the rule depends on another table's row.
- [ ] **Step 4: Run the same command** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): add identity credentials, capabilities and admin rbac`

---

### Task 6: Sessions, devices, MFA, OTP, recovery, usernames and invitations

**Files:**

- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/sessions.ts`
- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/usernames.ts`
- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/invitations.ts`
- Modify: `.../schema/index.ts`
- Create: `apps/backend-api/drizzle/0010_identity_sessions.sql` (via `db:generate`)
- Test: `apps/backend-api/test/modules/identity/infrastructure/postgres/sessions.int.test.ts`

**Interfaces:**

- Consumes: Task 2's enums and `bytea`, Task 3's `users` and `user_phones`, Task 5's nothing.
- Produces: `devices`, `sessions`, `mfaFactors`, `passkeyCredentials`, `otpChallenges`, `accountRecoveryRequests` (from `sessions.ts`); `usernameHistory`, `reservedUsernames` (from `usernames.ts`); `partyInvitations` (from `invitations.ts`), all per M1 §5.8–5.10. `sessions.parentSessionId` is a self-reference; `sessions.deviceId` and `mfaFactors.phoneId` and `accountRecoveryRequests.requestedDeviceId` are `ON DELETE SET NULL`. Check `recovery_reviewer_not_subject`. Indexes exactly as the spec names them, including the partial `sessions_user_active_idx`, `mfa_factors_user_idx`, `mfa_factors_one_default`, `otp_challenges_lookup`, `account_recovery_pending_idx`, `username_history_quarantine_idx` and `party_invitations_dest_idx`.

- [ ] **Step 1: Write the failing tests** in `sessions.int.test.ts`:

```ts
it('rejects a duplicate refresh token hash', …);                   // 23505, sessions_refresh_hash
it('rejects a duplicate device fingerprint for one user', …);      // 23505
it('allows the same fingerprint for two users', …);                // shared-device signal for M13
it('nulls session.device_id when the device is deleted', …);
it('defaults a session scope to CONSUMER and accepts STAFF and LOGISTICS', …);
it('allows one default MFA factor per user', …);                   // second → 23505
it('allows a second default once the first is revoked', …);
it('nulls mfa_factors.phone_id when the phone is deleted', …);
it('rejects a duplicate passkey credential id', …);                // 23505
it('rejects a reviewer who is the subject of the recovery request', …);   // 23514
it('allows a reviewer when the request has no user', …);           // user_id NULL → check passes
it('rejects a duplicate reserved username skeleton', …);           // 23505 (primary key)
it('rejects a duplicate invitation token hash', …);                // 23505
it('deletes sessions, devices, factors and history with the user', …);
```

- [ ] **Step 2: Run `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/modules/identity`** — expect FAIL.
- [ ] **Step 3: Write the three schema files, add them to the barrel, generate `0010_identity_sessions.sql`, rename it, update the `tag`, and read it** — confirm every partial index kept its predicate and that `sessions.parent_session_id` is a self-FK with no cascade.
- [ ] **Step 4: Run the same command** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): add identity sessions, devices, mfa and username tables`

---

### Task 7: `identity_audit_log`, append-only

**Files:**

- Create: `apps/backend-api/src/modules/identity/infrastructure/postgres/schema/audit.ts`
- Modify: `.../schema/index.ts`
- Create: `apps/backend-api/drizzle/0011_identity_audit_log.sql` (via `db:generate`)
- Create: `apps/backend-api/drizzle/0012_identity_audit_append_only.sql` (via `db:generate --custom`)
- Modify: `apps/backend-api/drizzle/meta/_journal.json`
- Test: `apps/backend-api/test/modules/identity/infrastructure/postgres/audit.int.test.ts`

**Interfaces:**

- Consumes: `appendOnly` from `src/db/helpers/appendOnly.ts`, `grantRuntimeAccess` from `src/db/roles.ts`.
- Produces: `identityAuditLog` — `id` bigserial PK, `occurredAt` timestamptz default now, `actorUserId`/`subjectUserId`/`deviceId`/`sessionId`/`correlationId` plain `uuid` (no FKs: an audit row must outlive the rows it describes), `actorType`, `action`, `outcome` text not null, `ip` inet, `userAgent` text, `beforeState`/`afterState`/`metadata` jsonb. Indexes `identity_audit_subject_idx`, `identity_audit_actor_idx`, `identity_audit_action_idx`, each `(…, occurred_at DESC)`.

- [ ] **Step 1: Write the failing tests** in `audit.int.test.ts`:

```ts
it('lets the runtime role append and read', …);
it('denies the runtime role UPDATE', …);                           // 42501
it('denies the runtime role DELETE', …);                           // 42501
it('raises KT001 on an owner UPDATE', …);
it('raises KT001 on an owner DELETE', …);
it('keeps the audit row after its subject user is deleted', …);    // no FK, so no cascade
it('stays append-only after grants are refreshed', …);             // await grantRuntimeAccess(client); UPDATE still 42501
```

- [ ] **Step 2: Run `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/modules/identity`** — expect FAIL.
- [ ] **Step 3: Write `audit.ts`, generate `0011_identity_audit_log.sql`, then `0012_identity_audit_append_only.sql` containing exactly `appendOnly('identity.identity_audit_log')`'s output.** Rename both, update their `tag`s. Do not hand-write any `GRANT`: `appendOnly()` emits the narrow grant and `grantRuntimeAccess()` keeps it.
- [ ] **Step 4: Run the same command** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): add the append-only identity audit log`

---

### Task 8: Schema census, verification, review and ticket status

**Files:**

- Test: `apps/backend-api/test/modules/identity/infrastructure/postgres/census.int.test.ts`
- Modify: `docs/tickets/03-identity.md`

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Write the failing census test** — a single file that pins the surface so a later ticket cannot quietly drop a table or an index:

```ts
it('has exactly the M1 §5 tables', async () => {
  expect(await tableNames(t.owner())).toEqual([/* 22 names, sorted */]);
});
it('has exactly the M1 §5 indexes', async () => {
  expect(await indexNames(t.owner())).toEqual([/* every index and unique constraint name, sorted */]);
});
it('has exactly the M1 §5 check constraints', async () => {
  expect(await checkNames(t.owner())).toEqual([/* named CHECKs, sorted */]);
});
```

Build the expected lists by reading M1 §5 top to bottom, then run the test and diff — a name the database has but the spec does not is as much a finding as the reverse.

- [ ] **Step 2: Run `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/modules/identity`** — expect FAIL on the first run, then reconcile each difference against M1 §5 (fix the schema when the spec is right, fix the list when drizzle's generated name is the only sensible one, and note any renames in the ticket).
- [ ] **Step 3: Full verification.** From the worktree root: `pnpm exec turbo run build lint typecheck test --force`, `pnpm exec prettier --check .`; then `cd apps/backend-api && KOMTRU_INFRA_TESTS=1 pnpm exec vitest run`. Record the test counts.
- [ ] **Step 4: Fresh whole-branch code review** (superpowers:requesting-code-review) by a general-purpose subagent on opus with no prior context, pointed at the five Review Focus risks; triage with superpowers:receiving-code-review and fix what is real.
- [ ] **Step 5: Mark T-030 done** in `docs/tickets/03-identity.md` with the plan link, the `drizzle.config.ts` glob change, the `GRANT USAGE ON SCHEMA public` change to `grantRuntimeAccess()`, the enum deviations from M1 §5.1, and a `- **Deferred:**` line for what is not in this ticket (RBAC seed rows, M1 §15 anonymisation, `user_addresses` → T-042). Do not run `pnpm tickets:index`.
- [ ] **Step 6: Commit** `docs(tickets): mark T-030 done`
