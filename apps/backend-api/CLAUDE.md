# backend-api

Express API plus a BullMQ worker, served at api.komtru.com. Two entry points share one
codebase: `src/server.ts` and `src/worker-process.ts`.

## Module shape

Every domain lives under `src/modules/<name>/` and exposes itself through an `index.ts` barrel.
Inside: `domain/` (pure rules and state machines), `services/` (orchestration), `http/` with
`controllers`, `routes` and `validations`, and `infrastructure/` (database, queues, providers).
Cross-cutting machinery that is not a domain goes in `src/platform/`.

**Plain exported functions, no class hierarchies.** This is deliberate and repo-wide.

## Database

- **One Postgres schema per module** — `identity`, `trades`, `logistics`, `park`, … — and never
  `public`.
- Foreign keys inside a schema are real, hard FKs with an explicit `onDelete`. References
  **across** a schema boundary are soft: a plain `uuid` column, no `REFERENCES`.
- Invariants that two concurrent requests could both pass ("one active company per POC", "the
  last admin cannot be removed") are enforced by a **partial unique index**, not by a
  check-then-insert in a service.
- Only one migration-bearing branch may be in flight at a time: the `000N_` prefix and the
  `drizzle/meta/_journal.json` entry collide. Run `pnpm migration:safety` before the deploy.
- Since T-021 the API and worker refuse to start unless `POSTGRES_URL` names the `komtru_app`
  runtime role. An older `.env` needs `pnpm env:backend --force`, `pnpm infra:up`, then
  `pnpm --filter @komtru/backend-api db:migrate`.

## Every endpoint, from its first line

- **Paginated.** No unpaginated `SELECT *`, including on admin-only, low-volume routes.
- **Idempotent** where a flaky connection could plausibly retry it. This matters most for
  `park-agent-app`, used in the field.
- **Rate-limited** on auth routes and PIN-attempt routes specifically, backed by Redis.
- **Stateless process.** No in-memory session, queue or rate limiter — the API runs as 2+
  instances behind a load balancer.
- An invalid state-machine jump is a `409`, decided by an explicit `canTransition` function in
  `domain/`, never by an `if` in a controller.

## Background work

An in-process typed event emitter for pure in-process effects. **BullMQ on Redis for anything
touching external I/O** — SMS, email, push, provider calls, webhooks — or anything that must
survive a crash. The single acknowledged exception is the OAuth code exchange during social
login.

BullMQ rejects a custom job id containing `:`, its own key separator. A stubbed queue in a test
will not catch that; only a real-Redis path will.

## Tests

- Integration tests are `apps/backend-api/test/modules/**/*.int.test.ts`, gated on `infraEnabled`
  and needing `KOMTRU_INFRA_TESTS=1`. **The `test:int` script does not run them** — it only
  covers `test/integration` and `test/db`. Use
  `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run <path>`.
- Each parallel agent needs its own `KOMTRU_TEST_DB_PREFIX`. The worker database name is built in
  `test/support/db.ts` as `${TEST_DB_PREFIX}_${VITEST_POOL_ID}` with no run id, so two concurrent
  runs sharing a prefix drop each other's databases.
- The RBAC permission catalog has an exhaustive-matrix test. Adding a permission means updating
  its counts in the same commit.
- Before writing a new test file, read what is already there. `grep` for a route factory's name
  can miss a suite that mounts it differently; an F-081 commit overwrote 15 live T-039 tests
  this way.
- A failure that appears only in the full suite is almost always cross-file interference. See
  [testing](../../docs/conventions/testing.md) before theorising.
