# Epic 02 — Backend platform (`apps/backend-api`)

---

### T-020 — Backend skeleton

- **Touches:** `apps/backend-api/src/{app,index,worker}.ts`, `src/config/**`, `src/platform/{logger,errors,sentry,health,registry}/**`, `eslint` module-boundary rule
- **Depends on:** T-002, T-003, T-010
- **Acceptance criteria:**
  - Express 5 app with helmet, CORS from config, compression, request id, pino HTTP logging (JSON in production), RFC 9457 error handler.
  - Config is parsed by a zod schema at boot; the process exits with a list of missing variable _names_ (never values).
  - Two entry points from one build: `index.ts` (API) and `worker.ts` (BullMQ worker). Both init Sentry; Sentry is a no-op without `SENTRY_DSN`.
  - `/health/live` and `/health/ready` (checks Postgres through PgBouncer and Redis).
  - Graceful shutdown drains HTTP, closes pools and awaits workers.
  - Module bootstrap pattern (`bootstrap.ts` per module) and route registry (`/v1` prefix).
  - ESLint `no-restricted-imports` fails when a module imports another module's internals; a fixture test proves it.
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-020-backend-skeleton.md`. Each module exports one `KomtruModule` from its `index.ts` (instead of a `bootstrap.ts`), and the boundary check is a custom rule, `komtru/module-boundaries`, rather than `no-restricted-imports`.
- **Deferred review minors:** error handler ignores `res.headersSent`; readiness probes share the request pool; readiness stays 200 while draining; Postgres/Redis connection errors are not logged; every `ZodError` maps to 422 (including internal parsing); boundary rule misses dynamic `import()` and re-exports; CORS origin match is exact (no normalisation); no tests yet for CORS preflight, compression or helmet CSP.

### T-021 — Database foundation

- **Touches:** `apps/backend-api/drizzle.config.ts`, `src/db/{index,migrator,roles}.ts`, `src/db/helpers/appendOnly.ts`, `test/db/**`
- **Depends on:** T-020
- **Acceptance criteria:**
  - Drizzle with schema-per-module; nothing in `public`. A test fails if any table is created in `public`.
  - Runtime pool connects through PgBouncer (`POSTGRES_URL`); migrations use `POSTGRES_DIRECT_URL`. Code avoids session-level features incompatible with transaction pooling; a lint rule bans `LISTEN`, session advisory locks and named prepared statements.
  - Migrations create the `komtru_app` runtime role with least privilege; the app never runs as the owner role.
  - `appendOnly(table)` helper emits the trigger plus `GRANT INSERT, SELECT` pattern used by every audit table.
  - Test harness: one database per Vitest worker, migrated once, truncated between tests; integration tests run through PgBouncer.
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-021-database-foundation.md`. Runtime grants are re-applied by the migrator on every run (so new module schemas need no hand-written grant), the migrator verifies the lockdown took, and the runtime password reaches Postgres only as a SCRAM verifier. Lint rule: `komtru/pgbouncer-safe`.
- **Deferred review minors:** fixed test database names collide across concurrent runs (two worktrees); `truncateAll` will wipe migration-seeded rows; runtime grants skip views and override hand-written REVOKEs, and give no USAGE on `public` for extensions; lint rule misses lower-case keywords, string-keyed `name`, query configs in variables, `set_config`/`TEMP TABLE`; startup can wait up to PgBouncer's `query_wait_timeout` when Postgres is down; `komtru_app` keeps PUBLIC's CONNECT on other databases on the server; no lock against concurrent migrate runs.

### T-022 — Migration-safety check

- **Touches:** `tools/migration-safety/**`, backend workflow job `migration-safety`
- **Depends on:** T-021, T-004
- **Acceptance criteria:**
  - Fails on drizzle snapshot/journal drift, on a migration that does not apply cleanly to an empty database, and on one that does not apply forward from the previous `main` schema.
  - Lints SQL for dangerous operations (non-concurrent index on an existing table, `NOT NULL` without default on an existing table, `DROP COLUMN` without an expand/contract note).
  - Introspection test asserts a maintained list of partial unique indexes, check constraints and append-only triggers exists; adding one to the codebase without the list fails CI.
  - Deploy jobs depend on it.

### T-023 — Redis, BullMQ and scheduler

- **Touches:** `src/platform/redis/**`, `src/platform/queue/**`, `src/platform/scheduler/**`
- **Depends on:** T-020
- **Cannibalized:** `scheduler/domain/registry.ts`, `scheduler/infrastructure/queue.ts` (T-001)
- **Acceptance criteria:**
  - Shared Redis connections with the `komtru:` key prefix; queue factory with exponential backoff, attempt caps and a dead-letter queue surfaced by a metric and an ops event.
  - Scheduler registry: modules register `module.job-name` with a cron in `Africa/Lagos`; only the worker starts schedulers; orphaned schedules are pruned. Fresh tests cover registration, pruning and timezone.
  - Statelessness test: two API instances and one worker against one Redis process jobs exactly once and share rate-limit state.
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-023-queues-scheduler.md`. Shared rate-limit state is asserted in T-025 (which builds the limiter); the dead-letter "ops event" is the `onDeadLetter` hook, to be wired to the bus in T-024.
- **Deferred:** jobs failed by BullMQ's stalled checker are not dead-lettered (needs a `QueueEvents` listener); scheduler pruning needs a generation stamp plus periodic reconcile before workers run multi-replica; BullMQ objects lack `error` listeners; worker shutdown drains in series; duplicate queue names are not rejected; the statelessness test prunes the dev Redis scheduler queue; producer payloads are not type-linked to queue definitions; dead-lettering is not atomic with the move to failed.

### T-024 — Domain events: outbox and typed bus

- **Touches:** `src/platform/events/**`, `platform` schema (`outbox`, `processed_events`)
- **Depends on:** T-021, T-023
- **Acceptance criteria:**
  - `publish(tx, event)` writes to `platform.outbox` inside the caller's transaction; nothing is published if the transaction rolls back (test).
  - A relay job moves outbox rows to subscriber queues at least once, in order per aggregate.
  - `subscribe(eventType, handler)` records `eventId` in `processed_events` within the handler's transaction; a replayed event is a no-op (test).
  - Envelope per M1 §11; event types and payloads are zod-typed in `shared-types`.
  - The in-process emitter exists for lossy, recomputable effects only, and its docs say so.

### T-025 — HTTP cross-cutting: pagination, idempotency, rate limits, validation

- **Touches:** `src/platform/http/{paginate,idempotency,rateLimit,validate,route}.ts`, `platform.idempotency_keys`
- **Depends on:** T-021, T-023
- **Acceptance criteria:**
  - `defineRoute({ method, path, scope, permission?, retryable?, paginated?, rateLimit?, schema })` is the only way to register a route. A registry test fails if any `GET` returning a collection is not `paginated`, or any mutating route lacks an explicit `retryable` decision.
  - Idempotency: unique on (scope, key, actor); same key and same body returns the stored response with `Idempotent-Replayed: true`; same key and different body returns 422; concurrent duplicates wait on a short Redis lock. Tests cover all three.
  - Rate limiting via `rate-limiter-flexible` on Redis, keyed per IP, per identifier and per user; responses carry `Retry-After`.
  - Request and response validation from zod schemas.

### T-026 — Platform crypto and identifiers

- **Touches:** `src/platform/crypto/{encryption,hmac,random}.ts`, `src/platform/identifiers.ts`
- **Depends on:** T-020
- **Cannibalized:** `utils/encryption.ts`, `identity/infrastructure/crypto.ts`, `identity/domain/identifiers.ts` (T-001)
- **Acceptance criteria:**
  - AES-256-GCM with the `v1:` wire format, keyed by the reused `ENCRYPTION_KEY`; tampered ciphertext fails to decrypt.
  - Domain-separated HMAC (one shared helper replaces the old per-module copies), length-safe constant-time compare, unbiased numeric codes (used for OTPs and 4-digit Park PINs).
  - Email normalisation with provider folding, E.164 phones via `libphonenumber-js` (default NG), masking helpers, public id generator.
  - Fresh tests for each; each file header records its origin.

### T-027 — Socket gateway

- **Touches:** `src/modules/socket/**`
- **Depends on:** T-023, T-031
- **Acceptance criteria:**
  - Socket.IO attached to the API's HTTP server with the Redis adapter (`komtru:sock:` prefix); CORS from config.
  - Handshake authenticates with the same access token as HTTP; every user joins a personal room.
  - `emitToUser`, `emitToRoom`, and a `registerRoomAuthorizer(prefix, fn)` hook for feature rooms (trade, dispute, hub).
  - Sessions are re-validated when the user's session epoch bumps; revoked sockets disconnect.
  - Test: an event emitted on instance A reaches a socket on instance B.

### T-028 — Outbound provider calls

- **Touches:** `src/platform/providers/http.ts`, lint rule
- **Depends on:** T-023
- **Acceptance criteria:**
  - Base HTTP helper with timeouts, retry on idempotent calls only, structured logging with secrets redacted.
  - Provider adapters live under `infrastructure/providers/`. Their network-calling functions are exported from a `*.client.ts` file that may be imported only from `jobs/` (lint rule plus a test that no `http/` or `services/` file imports a client). Pure helpers with no I/O, such as webhook signature verification, payload parsing and Cloudinary upload signing, live in separate files that request handlers may use.
  - Flows that look synchronous are made asynchronous instead of breaking the rule: Paystack charges start client-side via Paystack Inline with a server-issued reference; bank-name resolution, KYC checks and IMEI lookups create a pending record, run in a job, and push the result over the socket.
  - **One documented exception:** the OAuth authorization-code exchange during social login (T-034) is synchronous because the user is mid-redirect and a queued retry cannot complete the handshake. It runs with a strict timeout and circuit breaker, and provider JWKS are fetched by a scheduled job and cached. The exception is listed in design §4.4 and needs the owner's acknowledgement.
