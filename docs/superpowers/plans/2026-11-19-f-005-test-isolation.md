# F-005 Deterministic Integration Test Suite (T-029) Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make parallel runs of the backend infra suite unable to touch each other's Postgres databases, BullMQ queues or Redis keys, and make async-wait timeouts say what they gave up on.

**Architecture:** The test harness already namespaces Redis by run id and worker id (`db-urls.ts`). The Postgres worker database and the migrated template are named by prefix and worker id only, so two runs sharing a prefix drop each other's databases. Bring Postgres naming onto the same run-scoped scheme, make the BullMQ prefix a parameter of the scheduler as it already is for the queue factory, and extend the `eventually` diagnostics to every queue and relay wait. Cause 2 (PgBouncer exhaustion) is already fixed in `docker-compose.yml` by `b61667c`; this plan only verifies it. Cause 1 (idempotency expiry clock) is already merged; no work.

**Tech Stack:** TypeScript, Vitest, BullMQ, ioredis, node-postgres (`pg`), Docker Compose (Postgres 16, PgBouncer, Redis 7).

**Spec:** `docs/tickets/02-backend-platform.md` (T-029), `docs/tickets/FEATURE_MAP.md` (F-005), `docs/TICKETS.md`.

## Global Constraints

- Do not edit `docker-compose.yml`.
- Do not run `pnpm infra:down` or `pnpm infra:reset`. Only `pnpm infra:up` if Docker is down.
- Run integration tests only with `export KOMTRU_TEST_DB_PREFIX=komtru_f005`, and never start a second suite under that prefix while one is running.
- Do not run `pnpm tickets:index` or `pnpm progress:write`. Do not set any `- **Status:**` line to Done.
- Commit after every green step. Conventional commits, lower-case subject, header at most 100 characters, Co-Authored-By trailer per the workspace rule.
- Test files are read in full before they are edited or created.

## Review Focus

1. Two runs with the same `KOMTRU_TEST_DB_PREFIX` must not share worker databases or the template. Pinned by Task 1.
2. Teardown must not leave one database per worker per run behind. Pinned by Task 2.
3. A scheduler started by a test must not write to the production BullMQ prefix. Pinned by Task 3.
4. A wait that times out must name the state it gave up on, not "condition not met". Pinned by Task 5.
5. A run with `KOMTRU_TEST_RUN_ID` unset falls back to `norun`, which would re-create the cross-run collision. Pinned by the existing `shared-redis.test.ts` run-id test, extended by Task 1.

## File Structure

- Modify `apps/backend-api/test/support/db-urls.ts`: run-scoped `workerDatabaseName`/`templateDatabase` helpers beside the Redis namespace.
- Modify `apps/backend-api/test/support/db.ts`: use the run-scoped name; drop the worker database after the file.
- Modify `apps/backend-api/test/support/db-global-setup.ts`: mint the run id before naming the template; drop the template in teardown.
- Create `apps/backend-api/test/support/db-names.test.ts`: unit test (no infra) for the naming.
- Modify `apps/backend-api/src/platform/scheduler/scheduler.ts`: `prefix` option, default `BULL_PREFIX`.
- Modify `apps/backend-api/test/platform/scheduler.int.test.ts`: pass `testQueuePrefix()`; add a prefix assertion.
- Modify `apps/backend-api/test/support/shared-redis.test.ts`: guard `startScheduler` calls carry a `prefix`.
- Modify the `eventually(` call sites listed in Task 5.

---

### Task 1: Run-scope the worker database and the template

**Files:**

- Create: `apps/backend-api/test/support/db-names.test.ts`
- Modify: `apps/backend-api/test/support/db-urls.ts`, `apps/backend-api/test/support/db.ts`, `apps/backend-api/test/support/db-global-setup.ts`

**Interfaces:**

- Produces: `workerDatabase(): string` (unchanged signature) returning `${TEST_DB_PREFIX}_${runId}_${workerId}`; `templateDatabase(): string` returning `${TEST_DB_PREFIX}_${runId}_template`. `TEMPLATE_DATABASE` constant is removed (it is evaluated at import, before the global setup mints the run id).

- [ ] **Step 1: Write the failing test**

`db-names.test.ts` (unit, not gated by `KOMTRU_INFRA_TESTS`):

- Sets `KOMTRU_TEST_RUN_ID` to `runA`, records `workerDatabase()` and `templateDatabase()`; sets it to `runB` and asserts both differ from the `runA` values.
- Asserts `workerDatabase()` contains the run id and `VITEST_POOL_ID`.
- Asserts `workerDatabase()` and `templateDatabase()` are at most 63 characters (Postgres `NAMEDATALEN` limit) with a 36-character run id.
- Restores the environment in `afterEach`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -w exec turbo run test --filter=@komtru/backend-api` is too broad; run instead `cd apps/backend-api && pnpm exec vitest run test/support/db-names.test.ts`.
Expected: FAIL, `templateDatabase is not a function` (and/or the two worker names equal across runs).

- [ ] **Step 3: Implement**

- `db-urls.ts`: add `const runScope = () => \`${TEST_DB_PREFIX}_${runId()}\``next to the existing`namespace()`(which becomes`${runScope()}_${workerId()}`). Export `workerDatabaseName = () => \`${runScope()}_${workerId()}\``and`templateDatabaseName = () => \`${runScope()}_template\``. Remove the import-time `TEMPLATE_DATABASE`constant. Keep`runId()` private.
- `db.ts`: `workerDatabase` returns `workerDatabaseName()`; `useTestDatabase` uses `templateDatabaseName()` in `CREATE DATABASE ... TEMPLATE`.
- `db-global-setup.ts`: the `KOMTRU_TEST_RUN_ID ??=` line already runs first. Use `templateDatabaseName()` for the template create, drop and `runMigrations` URL. Import order must not evaluate the name before the run id is set.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend-api && pnpm exec vitest run test/support/db-names.test.ts test/support/shared-redis.test.ts`
Expected: PASS for both files.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-api/test/support docs/superpowers/plans/2026-11-19-f-005-test-isolation.md
git commit -m "fix(test): put the run id in worker and template database names"
```

Also commit the plan document in this first commit.

---

### Task 2: Drop per-run databases at teardown

**Files:**

- Modify: `apps/backend-api/test/support/db.ts`, `apps/backend-api/test/support/db-global-setup.ts`

**Interfaces:**

- Consumes: `workerDatabase()`, `templateDatabaseName()` from Task 1.

- [ ] **Step 1: Verify the leak (red)**

Run a single file under `KOMTRU_TEST_DB_PREFIX=komtru_f005`, then query `SELECT datname FROM pg_database WHERE datname LIKE 'komtru_f005_%'` via `docker exec komtru-postgres-1 psql -U komtru -d postgres`.
Expected before the fix: the run's template and worker databases remain. This is the red state; record the result in the commit body.

- [ ] **Step 2: Implement**

- `db.ts`: in `useTestDatabase` `afterAll`, after the pools end, `DROP DATABASE IF EXISTS <workerDatabase()> WITH (FORCE)` on the direct admin connection.
- `db-global-setup.ts` teardown: after `releaseRunKeyspace()`, drop `templateDatabaseName()` WITH (FORCE). Keep the teardown non-throwing.

- [ ] **Step 3: Verify green**

Same single-file run; the query returns no rows for this run's run id.

- [ ] **Step 4: Commit**

```bash
git add apps/backend-api/test/support/db.ts apps/backend-api/test/support/db-global-setup.ts
git commit -m "fix(test): drop run-scoped databases when the run ends"
```

---

### Task 3: Scheduler accepts a BullMQ prefix

**Files:**

- Modify: `apps/backend-api/src/platform/scheduler/scheduler.ts`, `apps/backend-api/test/platform/scheduler.int.test.ts`, `apps/backend-api/test/support/shared-redis.test.ts`

**Interfaces:**

- Produces: `SchedulerOptions.prefix?: string`, default `BULL_PREFIX`, passed to both `Queue` and `Worker`.

- [ ] **Step 1: Write the failing test**

In `scheduler.int.test.ts`, add a case: start a scheduler with `prefix: testQueuePrefix()` (the option does not exist yet, so the type fails), then `raw.keys(\`${testQueuePrefix()}:${queueName}:*\`)`is non-empty after`start()`. Use a raw ioredis client on `redisUrl`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend-api && KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_f005 pnpm exec vitest run test/platform/scheduler.int.test.ts`
Expected: FAIL, keys are not under the test prefix (written under `komtru:bull`).

- [ ] **Step 3: Implement**

Add `prefix = BULL_PREFIX` to `startScheduler`'s destructuring and option type; replace the two `prefix: BULL_PREFIX` uses. In the test, replace `BULL_PREFIX` in `setup`'s `new Queue` with `testQueuePrefix()` and pass `prefix: testQueuePrefix()` into `startScheduler`.

- [ ] **Step 4: Extend the guard (`shared-redis.test.ts`)**

Add `['startScheduler', 'prefix']` to the `callsTo` list in the first test.

- [ ] **Step 5: Verify green and commit**

Run the scheduler file and `shared-redis.test.ts`; both pass.

```bash
git add apps/backend-api/src/platform/scheduler/scheduler.ts apps/backend-api/test/platform/scheduler.int.test.ts apps/backend-api/test/support/shared-redis.test.ts
git commit -m "fix(test): namespace the scheduler's BullMQ keys per test worker"
```

---

### Task 4: Verify cause 2 is in effect

**Files:** none changed.

- [ ] **Step 1:** Confirm Postgres `max_connections`: `docker exec komtru-postgres-1 psql -U komtru -d postgres -tAc 'SHOW max_connections'` expected `300`.
- [ ] **Step 2:** Confirm the PgBouncer values from `docker-compose.yml` are loaded in the running container without printing secrets: `docker exec komtru-pgbouncer-1 sh -c 'grep -E "default_pool_size|max_db_connections|server_login_retry" /etc/pgbouncer/pgbouncer.ini'` expected `10`, `15`, `0`. If the config is passed only by env, check `docker exec ... printenv` filtered to the three names with values printed only for these three keys.
- [ ] **Step 3:** The exhaustion symptom is judged by the 20-run loop (Task 6), not by this step. Record the values in the report.

---

### Task 5: `eventually` diagnostics on every queue and relay wait

**Files:** the 7 files that call `eventually(`: `test/integration/events.int.test.ts`, `test/integration/notifications.int.test.ts`, `test/integration/statelessness.int.test.ts`, `test/modules/identity/session.int.test.ts`, `test/platform/events/relay.int.test.ts`, `test/platform/queue.int.test.ts`, `test/platform/scheduler.int.test.ts`.

**Interfaces:**

- Consumes: `eventually(check, timeoutMs, describe)` from `test/support/eventually.ts` (already has the `describe` parameter).

- [ ] **Step 1: Write the failing test**

Add `test/support/eventually.test.ts` (unit): `eventually(() => false, 30, () => 'queue notify.sms: 2 waiting')` rejects with a message containing `queue notify.sms: 2 waiting`; a `describe` that is never called when the check passes.

- [ ] **Step 2: Run** `pnpm exec vitest run test/support/eventually.test.ts`. Expected to pass against the existing helper, which already accepts `describe`. Record that this pins behavior rather than driving a change.

- [ ] **Step 3: Implement**

For each `eventually(` call that waits on a queue, relay or provider, add a `describe` callback that reads the state the wait depends on: job counts by state (`queue.getJobCounts()`), outbox row status, or the provider stub's call count. Keep the callback cheap and non-throwing (wrap reads so a read error is part of the message, not a new failure).

- [ ] **Step 4: Verify and commit** the touched files individually (`pnpm exec vitest run <file>`), then:

```bash
git commit -m "test: report the queue or relay state a wait gave up on"
```

---

### Task 6: Full verification and the 20-run criterion

- [ ] **Step 1:** `pnpm -w exec turbo run lint typecheck test --force`. Expected: all pass.
- [ ] **Step 2:** Start a background loop with `export KOMTRU_TEST_DB_PREFIX=komtru_f005` and `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run`, appending each run's result to `/private/tmp/claude-501/-Users-emmanuelahman-Documents-projects-nykon-externals-komtru-monorepo/0d366224-d2e1-4c46-b697-6a40366f32c4/scratchpad/f-005/runs.log`. Stop at the first failure only to investigate; otherwise continue to 20.
- [ ] **Step 3:** Report honestly: the count of completed green runs, and every failure by name.
