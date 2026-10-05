# T-021 Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drizzle wired into the backend with schema-per-module migrations, a least-privilege runtime role, an `appendOnly()` helper, a PgBouncer-safety lint rule, and a per-worker test database harness.

**Architecture:** Migrations run as the owner over `POSTGRES_DIRECT_URL`. After migrating, the migrator re-applies runtime grants for `komtru_app` across every module schema: full DML on normal tables, `INSERT, SELECT` only on tables carrying the `komtru_append_only` trigger. The runtime pool (`POSTGRES_URL`, through PgBouncer) logs in as `komtru_app`, and startup refuses to run as a superuser or the schema owner. Integration tests get one database per Vitest worker, cloned from a migrated template, and connect through PgBouncer as `komtru_app`.

**Tech Stack:** drizzle-orm 0.45.3, drizzle-kit 0.31.11, pg 8.23.1, Postgres 16, PgBouncer (transaction mode), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-05-komtru-platform-design.md` (§4 stack table rows "ORM/migrations" and "Pooling"; §11 testing; §10 CI migration-safety lines) and ticket T-021 in `docs/tickets/02-backend-platform.md`.

## Global Constraints

- Schema-per-module; nothing in `public`. Drizzle's own journal lives in schema `drizzle`.
- Runtime connects through PgBouncer (`POSTGRES_URL`); migrations use `POSTGRES_DIRECT_URL`.
- No session state: no `LISTEN`/`NOTIFY`, no session advisory locks (`pg_advisory_xact_lock` is allowed), no named prepared statements.
- Runtime role name: `komtru_app`. The app never runs as the owner role.
- Every append-only table: trigger blocks `UPDATE` and `DELETE`; runtime role has `INSERT, SELECT` only.
- Secrets: never print `.env` values; local throwaway credentials only (`komtru`/`komtru`, `komtru_app`/`komtru_app`).

## Review Focus

1. A module schema added by a later migration: the runtime role must get access without a hand-written grant (the migrator re-grants every run).
2. Re-running the migrator must not re-grant `UPDATE`/`DELETE` on an append-only table.
3. Parallel Vitest workers must never share a database; a crashed run must not break the next one (databases are dropped with `FORCE` and recreated).
4. A deployed `.env` whose `POSTGRES_URL` still names the owner: the API must refuse to start, not run as owner silently.
5. The runtime password reaches SQL only through `escapeLiteral`, and is never logged.

---

### Task 1: Local infra and env for the runtime role

**Files:**

- Modify: `docker-compose.yml` (PgBouncer: drop `DB_NAME` so the generated `[databases]` entry is `*`, letting per-worker test databases route through it; unknown users authenticate via the generated `auth_user=komtru`)
- Modify: `scripts/env/local-infra.mjs` (add `LOCAL_APP_ROLE = { user: 'komtru_app', password: 'komtru_app' }`; `pooledUrl` uses it; `directUrl` stays owner)
- Modify: `scripts/env/populate-backend-env.mjs` (local target writes `POSTGRES_APP_PASSWORD=komtru_app`; rds target keeps the owner URL as `POSTGRES_DIRECT_URL`, generates a random 32-byte hex `POSTGRES_APP_PASSWORD` only when the target file has none, and rewrites `POSTGRES_URL` to `komtru_app:<that password>`, host unchanged)
- Modify: `apps/backend-api/.env.example`, `apps/backend-api/src/config/env.ts` (`POSTGRES_APP_PASSWORD` optional → `postgres.appPassword?`)
- Modify: `docs/runbooks/local-dev.md` (run `pnpm infra:up` to recreate PgBouncer, then `pnpm --filter @komtru/backend-api db:migrate`)
- Test: `scripts/test/populate-backend-env.test.mjs`, `apps/backend-api/test/config/env.test.ts`

- [ ] Tests: local target → `POSTGRES_URL` user is `komtru_app`, `POSTGRES_DIRECT_URL` user is `komtru`; rds target → `POSTGRES_URL` user `komtru_app` with a 64-hex password equal to `POSTGRES_APP_PASSWORD`, same host, db `komtru_v2_dev`; `POSTGRES_DIRECT_URL` is the owner URL; config exposes `appPassword` only when set.
- [ ] Run, watch fail, implement, run, pass. Recreate the stack (`pnpm infra:up`).
- [ ] Commit `feat(infra): route the runtime role through pgbouncer`.

### Task 2: Drizzle, baseline migration, roles and migrator

**Files:**

- Create: `apps/backend-api/drizzle.config.ts` (schema `./src/modules/*/schema.ts`, out `./drizzle`, dialect `postgresql`, `migrations.schema: 'drizzle'`, url from `POSTGRES_DIRECT_URL`)
- Create: `apps/backend-api/drizzle/0000_platform_baseline.sql` (custom migration, with journal and snapshot from `drizzle-kit generate --custom`): create role `komtru_app` `NOLOGIN` if missing; `REVOKE ALL ON SCHEMA public FROM PUBLIC`; schema `platform`; function `platform.reject_mutation()` raising `komtru: % is append-only` with SQLSTATE `KT001` (the error carries `TG_TABLE_SCHEMA.TG_TABLE_NAME`)
- Create: `src/db/index.ts` — `createDb(pool: pg.Pool)` returns a `NodePgDatabase`; re-export `RUNTIME_ROLE`
- Create: `src/db/roles.ts` — `RUNTIME_ROLE = 'komtru_app'`, `APPEND_ONLY_TRIGGER = 'komtru_append_only'`, `grantRuntimeAccess(client: pg.ClientBase): Promise<void>`, `setRuntimePassword(client, password: string): Promise<void>` (`ALTER ROLE … LOGIN PASSWORD` built with `client.escapeLiteral`), `assertNotOwner(pool: pg.Pool): Promise<void>` (throws `RuntimeRoleError` when `current_user` is superuser or owns schema `drizzle`)
- Create: `src/db/migrator.ts` — `runMigrations({ directUrl, appPassword?, ssl, logger }): Promise<void>` (one client: drizzle `migrate`, then `grantRuntimeAccess`, then `setRuntimePassword` when given); `src/db/migrate-cli.ts` (loads config, requires `POSTGRES_DIRECT_URL`, exits 1 naming the variable)
- Modify: `src/server.ts`, `src/worker-process.ts` — call `assertNotOwner(clients.pool)` after `createClients`; on failure close clients and rethrow
- Modify: `package.json` — deps `drizzle-orm@0.45.3`; dev `drizzle-kit@0.31.11`; scripts `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx --env-file-if-exists=.env src/db/migrate-cli.ts`)
- Test: `test/db/roles.int.test.ts`

`grantRuntimeAccess` covers every schema except `pg_catalog`, `information_schema`, `pg_toast`, `public`, `drizzle`: `GRANT USAGE ON SCHEMA`; per table, `INSERT, SELECT` and `REVOKE UPDATE, DELETE, TRUNCATE` when the table has trigger `komtru_append_only`, otherwise `SELECT, INSERT, UPDATE, DELETE`; `USAGE, SELECT` on all sequences; `EXECUTE` on functions in `platform`.

- [ ] Tests (infra-gated, use Task 3's harness once it exists; until then a direct throwaway database): after migrating, `information_schema.tables` has no row in `public`; `komtru_app` cannot `CREATE TABLE public.x` or `CREATE SCHEMA`; a table created in a new schema after the first migrate run is readable by `komtru_app` after a second migrate run; `assertNotOwner` rejects the owner pool and accepts the `komtru_app` pool; running the migrator twice is a no-op.
- [ ] Run, fail, implement, pass. Commit `feat(backend-api): drizzle migrations and least-privilege runtime role`.

### Task 3: Test database harness

**Files:**

- Create: `test/support/db-global-setup.ts` — when `KOMTRU_INFRA_TESTS=1`: drop `komtru_test_template` (`WITH (FORCE)`), create it, `runMigrations` on it with `appPassword: 'komtru_app'`. No-op otherwise.
- Create: `test/support/db.ts` — `useTestDatabase(): { app: () => pg.Pool; owner: () => pg.Pool; db: () => NodePgDatabase }`. Registers `beforeAll` (drop/create `komtru_test_${VITEST_POOL_ID}` from the template; open the `app` pool through PgBouncer as `komtru_app` and the `owner` pool direct), `beforeEach` (`truncateAll(owner)`: `TRUNCATE … RESTART IDENTITY CASCADE` on every table outside system schemas, `public` and `drizzle`), and `afterAll` (end pools).
- Modify: `vitest.config.ts` — `globalSetup: ['test/support/db-global-setup.ts']`
- Test: `test/db/harness.int.test.ts`

- [ ] Tests: `current_user` on `app()` is `komtru_app` and `current_database()` is `komtru_test_${VITEST_POOL_ID}`; the `app` pool's port is the PgBouncer port; a row inserted in one test is gone in the next.
- [ ] Run, fail, implement, pass. Commit `test(backend-api): per-worker test database harness`.

### Task 4: `appendOnly()` helper

**Files:**

- Create: `src/db/helpers/appendOnly.ts` — `appendOnly(table: string): string` for `schema.table` (each part `/^[a-z_][a-z0-9_]{0,62}$/`, else throws `TypeError`); returns the SQL: `CREATE TRIGGER komtru_append_only BEFORE UPDATE OR DELETE ON <t> FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();` then `REVOKE ALL ON <t> FROM komtru_app;` then `GRANT INSERT, SELECT ON <t> TO komtru_app;` separated by drizzle's `--> statement-breakpoint`.
- Test: `test/db/append-only.test.ts` (unit: output, identifier rejection), `test/db/append-only.int.test.ts`

- [ ] Int tests on a table created in the test database and passed through `appendOnly`: as `komtru_app`, `INSERT` and `SELECT` work, `UPDATE` and `DELETE` fail with permission denied; as owner, `UPDATE` and `DELETE` fail with SQLSTATE `KT001`; after `grantRuntimeAccess` runs again, `komtru_app` still cannot `UPDATE`.
- [ ] Run, fail, implement, pass. Commit `feat(backend-api): appendOnly migration helper`.

### Task 5: PgBouncer-safety lint rule

**Files:**

- Create: `eslint-rules/pgbouncer-safe.mjs` (+ `.d.mts`), wire into `eslint.config.mjs` as `komtru/pgbouncer-safe` for `src/**/*.ts`
- Test: `test/eslint/pgbouncer-safe.test.ts`

Reports, in string literals and template literal quasis: `\bLISTEN\b`, `\bUNLISTEN\b`, `\bpg_(try_)?advisory_lock(_shared)?\b`, `\bPREPARE\b`, `\bDEALLOCATE\b`; calls `x.prepare(...)` with any argument (drizzle named statements); object literals with a `name` property passed as the first argument to `.query(...)` (pg named statements). Allowed: `pg_advisory_xact_lock`. Session `SET` is not linted: a text pattern cannot tell it from `UPDATE … SET`, so code review covers it.

- [ ] RuleTester valid/invalid cases for each pattern above, run, fail, implement, pass; `pnpm lint` passes on real source.
- [ ] Commit `feat(backend-api): lint rule for pgbouncer-safe sql`.
