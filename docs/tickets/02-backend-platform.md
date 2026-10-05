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
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-023-queues-scheduler.md`. Shared rate-limit state is asserted in T-025's statelessness test; the dead-letter "ops event" is the `onDeadLetter` hook, wired to the bus in T-024 as `platform.queue.dead_lettered`.
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
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-024-events-outbox.md`. `publish(tx, …)` writes the envelope through the caller's transaction; the worker-only relay claims rows with `FOR UPDATE SKIP LOCKED`, fans out one BullMQ queue per subscriber and marks the batch published in the claiming transaction; each subscriber's `processed_events` marker is written in the handler's own transaction, so a failed handler is retried whole. Ordering into the queues is kept by a fleet-wide advisory lock plus a commit watermark (`created_xid < pg_snapshot_xmin(…)`), since `seq` is allocated at INSERT and not at COMMIT. Beyond the plan: an `outboxMetrics` backlog gauge, exponential backoff on failing ticks, a deadline on the enqueue phase, quarantine of unprocessable rows, batched pruning, and `processed_events` kept 90 days so a marker outlives the 30-day failed-job window that could redeliver it. `ModuleContext` gained `events`, `emitter` and `db`. The migration also creates two prune-support indexes beyond the plan's one.
- **Deferred:** ordered _execution_ is not guaranteed — a handler that fails waits out its backoff while BullMQ runs the next job for that subscriber, so handlers must be commutative or carry their own guard (a per-aggregate delay gate needs the job token plumbed through the queue factory); the commit watermark is cluster-wide, so a long transaction anywhere on the instance stalls delivery until `WATERMARK_TIMEOUT_MS` (5 s), after which rows publish possibly out of order, counted in `outboxMetrics.watermarkTimeouts`; a row that repeatedly fails to enqueue is retried forever rather than quarantined; no index on `(aggregate_type, aggregate_id)` until a replay tool needs it; no outbox replay/backfill tooling; subscriber dispatch keys on event type only, so a version mismatch dead-letters rather than being routed to a handler for that version.

### T-025 — HTTP cross-cutting: pagination, idempotency, rate limits, validation

- **Touches:** `src/platform/http/{paginate,idempotency,rateLimit,validate,route}.ts`, `platform.idempotency_keys`
- **Depends on:** T-021, T-023
- **Acceptance criteria:**
  - `defineRoute({ method, path, scope, permission?, retryable?, paginated?, rateLimit?, schema })` is the only way to register a route. A registry test fails if any `GET` returning a collection is not `paginated`, or any mutating route lacks an explicit `retryable` decision.
  - Idempotency: unique on (scope, key, actor); same key and same body returns the stored response with `Idempotent-Replayed: true`; same key and different body returns 422; concurrent duplicates wait on a short Redis lock. Tests cover all three.
  - Rate limiting via `rate-limiter-flexible` on Redis, keyed per IP, per identifier and per user; responses carry `Retry-After`.
  - Request and response validation from zod schemas.
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-025-http-cross-cutting.md`. `defineRoute` is the only way a route exists: `KomtruModule.routes` is a `RouteDefinition[]`, and `mountRoutes` checks the registry at boot, so a collection without `paginated` or a mutating route without an explicit `retryable` fails the process rather than shipping. The chain is rate limit (IP and user) → parse → rate limit (identifier) → idempotency → handler → response validation, so a malformed body cannot buy unmetered requests on a metered route; a response that breaks its own schema is a 500 and a Sentry report, not a client error. Idempotency claims `(scope, key, actor)` before the handler and completes it after, with takeover of a claim abandoned by a dead process and release of a failed one. Rate limits are Redis-backed per IP, user and identifier, fail **closed** with a 503 when Redis cannot answer (the routes that declare a limit are the ones worth brute-forcing). Cursors are base64url and a tampered one is a 422. The statelessness test now asserts two API instances share one rate-limit budget and one idempotency store, closing T-023's deferred item. Every write by an idempotency owner is fenced on an `owner_id`, and the owner renews a Redis lease while it works, so a slow-but-alive handler is never taken over and a superseded attempt can neither overwrite the new owner's response nor delete its claim. New dependency: `rate-limiter-flexible` 11.2.1.
- **Deferred:** cursors are opaque but unsigned (a client can still mint a syntactically valid one; the values are type-checked, and signing with the T-026 HMAC helper is the fix if a cursor ever carries a scoping value); the limiter key has no environment segment, so staging and production must not share one Redis; the platform guarantee is "at most one _recorded_ completion", which cannot make a non-transactional handler exactly-once — money and custody handlers must do their work in one transaction (stated in the file header); `paginated: 'page'` has no `pagedPage()` helper to match `cursorPage()`; `scope` and `permission` are recorded but unenforced until T-030/T-031, and every caller resolves to `anon`, so per-user limits and per-actor idempotency are inert until then; a body with no schema on a retryable route is hashed as the client sent it, so key order is the client's.

### T-026 — Platform crypto and identifiers

- **Touches:** `src/platform/crypto/{encryption,hmac,random}.ts`, `src/platform/identifiers.ts`
- **Depends on:** T-020
- **Cannibalized:** `utils/encryption.ts`, `identity/infrastructure/crypto.ts`, `identity/domain/identifiers.ts` (T-001)
- **Acceptance criteria:**
  - AES-256-GCM with the `v1:` wire format, keyed by the reused `ENCRYPTION_KEY`; tampered ciphertext fails to decrypt.
  - Domain-separated HMAC (one shared helper replaces the old per-module copies), length-safe constant-time compare, unbiased numeric codes (used for OTPs and 4-digit Park PINs).
  - Email normalisation with provider folding, E.164 phones via `libphonenumber-js` (default NG), masking helpers, public id generator.
  - Fresh tests for each; each file header records its origin.
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-026-platform-crypto.md`. Keys are arguments, not config reads: `createEncryption(config)` binds `ENCRYPTION_KEY` (new in `env.ts`, optional so a process that never encrypts still boots) and `createHmacHasher(pepper)` lets each module bring its own pepper. The lifted code was corrected in five places: the HMAC domain is length-prefixed rather than space-joined (the old framing collided `('otp a','b')` with `('otp','a b')`); `decrypt` validates the IV and tag lengths before `Buffer.from(…, 'hex')`, which silently truncates; `maskPhone` hides at least four characters (the old fixed 7-and-4 showed 11 of the 12 characters of a US E.164 number); `normaliseEmail` validates before canonicalising; `normalisePhone` leaves `countryCode` absent for a non-geographic number instead of defaulting to NG. `classifyIdentifier` now accepts a leading `(`.
- **Deferred:** no `DecryptionError` wrapper — a GCM authentication failure reaches Sentry as Node's bare "unable to authenticate data", naming neither the column nor the operation; no shared insert-with-retry helper for the ~30-bit `generatePublicId` (it belongs to whichever ticket first writes a public id); `IDENTITY_HMAC_PEPPER` is not in `env.ts` (the identity ticket owns it, and `createHmacHasher` already takes it as an argument); email domains are not IDN/punycode-normalised.

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
- **Status:** Done (2026-10-05). Plan: `docs/superpowers/plans/2026-10-05-t-028-provider-http.md`. Ships the platform helper (`src/platform/providers/{http,circuit-breaker}.ts`), the structural rule (`komtru/provider-clients`) and two independent proofs of it: a RuleTester suite plus `test/platform/provider-boundaries.test.ts`, which scans `src/modules` for the same violations without ESLint. The third bullet's flows belong to T-071 (Paystack Inline), T-050/T-051/T-067 (pending record plus job plus socket) and T-040 (signed direct Cloudinary upload); they are recorded in design §4.4 rather than built here, since no provider adapter exists yet. No new environment variable: timeouts, attempt caps and backoff are per-call with exported defaults. The OAuth exception is still **awaiting the owner's acknowledgement**.
- **Deferred:** the boundary scan finds nothing in `src/modules` today because no module exists yet (it is proven against fixture trees instead); the circuit breaker is per-process, not shared through Redis; no `Retry-After` handling on a 429; no jitter on the backoff; no per-provider concurrency cap or bulkhead; no metric for provider latency or failure counts (the ops exporter is a later ticket); response bodies are not size-capped; a local `TypeError` from `fetch` (malformed URL, illegal header) is classified as a network failure and retried on an idempotent call; the backoff timer is not `unref`'d.
