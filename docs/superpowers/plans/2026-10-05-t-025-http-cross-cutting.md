# T-025 HTTP Cross-cutting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One way to register a route, and with it pagination, idempotency, Redis rate limits and zod validation — enforced by the registry at boot, not by reviewer vigilance.

**Architecture:** `defineRoute()` returns a `RouteDefinition`; a module exports an array of them instead of an Express callback, and `mountRoutes()` turns each into a handler chain (rate limit → validate → idempotency → handler → response validation). `assertRouteInvariants()` runs at mount time and in a registry test: a `GET` whose response schema is a collection must declare `paginated`, and any mutating method must make an explicit `retryable` decision. Idempotency claims `(scope, key, actor)` in `platform.idempotency_keys` before the handler and stores the response after, with a short Redis lock covering the in-flight window. Rate limits use `rate-limiter-flexible` on the shared ioredis client, so two API instances share one bucket.

**Tech Stack:** express 5, zod 4, rate-limiter-flexible (new dependency), ioredis (shared client, `komtru:` prefix), drizzle, Postgres.

**Spec:** design §4.4 (`docs/superpowers/specs/2026-10-05-komtru-platform-design.md`), ticket T-025 in `docs/tickets/02-backend-platform.md`, pagination contracts in `packages/shared-types/src/pagination.ts`, problem details in `packages/shared-types/src/errors.ts` (`VALIDATION_FAILED`, `RATE_LIMITED`, `IDEMPOTENCY_KEY_REUSED`, `CONFLICT` already exist).

## Global Constraints

- `defineRoute` is the only way a module registers a route: `KomtruModule.routes` becomes `RouteDefinition[]`, and the existing integration tests move to it.
- Every list response is paginated — `PAGE_LIMIT_DEFAULT` 20, `PAGE_LIMIT_MAX` 100, `PAGE_NUMBER_MAX` 10_000, straight from shared-types, never redeclared.
- Idempotency: unique on `(scope, key, actor)`; same key and same body replays the stored response with `Idempotent-Replayed: true`; same key and a different body is 422 `IDEMPOTENCY_KEY_REUSED`; a concurrent duplicate waits on a short Redis lock, then 409 `CONFLICT` if the first is still running.
- Rate limits are Redis-backed and keyed per IP, per identifier and per user; a limited response carries `Retry-After` and the `RATE_LIMITED` code.
- No in-memory state: two API instances share both the rate-limit buckets and the idempotency store (asserted in the statelessness integration test, closing T-023's deferred item).
- Sessions arrive in T-030/T-031: `scope` and `permission` are declared and recorded now, and the principal resolver is a seam those tickets fill in. Until then the actor is anonymous and limits key on IP.
- Every error leaves as RFC 9457 problem details through the existing `ApiError`; no new error shape.

## Review Focus

1. Two requests with the same idempotency key at two API instances at once — exactly one runs the handler; the other replays or 409s, never both run (Task 4).
2. A process that dies between claiming the key and storing the response must not wedge that key forever (Task 4).
3. Redis down: the limiter's failure mode is a decision, not an accident, and the same one every time (Task 5).
4. `Retry-After` is on the 429 itself (Task 5).
5. A route whose response is a collection but which forgets `paginated` fails the boot, not just a test (Task 2).

---

### Task 1: `platform.idempotency_keys`

**Files:** modify `apps/backend-api/src/db/platform-schema.ts`; create `drizzle/0003_idempotency_keys.sql` via `pnpm db:generate`; test `apps/backend-api/test/db/idempotency-keys.int.test.ts`.

**Produces:** `idempotencyKeys` table — `scope` text, `key` text, `actor` text (`user:<uuid>` or `anon`), primary key `(scope, key, actor)`; `requestHash` text; `method` text; `path` text; `status` integer null; `response` jsonb null; `completedAt` timestamptz null; `createdAt` timestamptz default now; index on `createdAt` for pruning.

- [ ] Write the failing integration test: the runtime role can insert/read/update; a second row with the same `(scope, key, actor)` violates the primary key; a different actor with the same key is allowed.
- [ ] Run `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run test/db/idempotency-keys.int.test.ts` — expect FAIL.
- [ ] Add the table, `pnpm db:generate`, rename the migration to `0003_idempotency_keys.sql`.
- [ ] Run the test — expect PASS. Commit.

### Task 2: `defineRoute`, invariants and mounting

**Files:** create `src/platform/http/route.ts`, `src/platform/http/paginate.ts`, `src/platform/http/validate.ts`; modify `src/platform/module.ts`, `src/app.ts`, `src/server.ts`; tests `test/platform/http/route.test.ts`, `test/platform/http/mount.test.ts`.

**Produces:**

- `defineRoute({ method, path, scope, summary, permission?, retryable?, paginated?, rateLimit?, status?, schema: { params?, query?, body?, response }, handler })`
- `RouteScope = SessionScope | 'PUBLIC'`
- `assertRouteInvariants(routes): void` — throws naming the route
- `mountRoutes(routes, deps): (router: Router) => void`
- `RouteContext<…> = { params, query, body, req, res, actor }`
- `isCollectionSchema(schema): boolean` — a zod object with an `items` array, or a bare array

- [ ] Failing tests: a `GET` returning `paginatedSchema(x)` without `paginated` throws; with `paginated: 'cursor'` it passes; a `POST` without `retryable` throws; a duplicate method+path throws; a path not starting with `/` throws; a handler's return value that fails `schema.response` is a 500 (a server bug, not the client's); request body/query/params are parsed and the handler sees typed values; a body failing the schema is 422 with field errors.
- [ ] Run — FAIL. Implement. Run — PASS. Commit.

### Task 3: Pagination helper

**Files:** `src/platform/http/paginate.ts`; test `test/platform/http/paginate.test.ts`.

**Produces:** `cursorPage(rows, limit, toCursor)` → `Paginated<T>`; `encodeCursor/decodeCursor` (base64url of a JSON key, tamper-evident enough that a bad cursor is a 422, never a 500); `paginationQuery(kind)` merged into a route's query schema automatically when `paginated` is set.

- [ ] Failing tests: `limit` defaults to 20 and caps at 100; a cursor round-trips; a malformed cursor is a `VALIDATION_FAILED` 422; `nextCursor` is null on the last page and set when `rows.length > limit`.
- [ ] Run — FAIL. Implement. Run — PASS. Commit.

### Task 4: Idempotency middleware

**Files:** `src/platform/http/idempotency.ts`; test `test/platform/http/idempotency.int.test.ts`.

**Produces:** `idempotency({ db, redis, logger })` → middleware applied to routes with `retryable: true`; `IDEMPOTENCY_HEADER = 'Idempotency-Key'`, `REPLAYED_HEADER = 'Idempotent-Replayed'`, `IDEMPOTENCY_TTL_HOURS = 24`, `STALE_IN_FLIGHT_MS = 60_000`.

Flow: no header → run normally. With a header → claim `(scope, key, actor)` with `INSERT … ON CONFLICT DO NOTHING RETURNING`; on claim, take the Redis lock, run the handler, store `status`/`response`, release. On conflict: different `requestHash` → 422; completed → replay with `Idempotent-Replayed: true`; in flight → wait on the lock up to `lockWaitMs`, re-read, then 409 `CONFLICT`; in flight but older than `STALE_IN_FLIGHT_MS` → take it over.

- [ ] Failing tests (real Postgres and Redis): same key and body replays the stored status and body with the header; same key and a different body is 422 `IDEMPOTENCY_KEY_REUSED`; two concurrent identical requests run the handler exactly once and the loser gets the stored response or 409; a key abandoned mid-flight is taken over after the stale window; a different actor with the same key is independent; no header means no row.
- [ ] Run — FAIL. Implement. Run — PASS. Commit.

### Task 5: Rate limiting

**Files:** `src/platform/http/rateLimit.ts`; test `test/platform/http/rate-limit.int.test.ts`.

**Produces:** `createRateLimiters({ redis, logger })` → `limiterFor(spec)`; `RateLimitSpec = { points, durationSeconds, by: ('ip'|'user'|'identifier')[], identifierFrom?: (body, query) => string | undefined }`; 429 carries `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

- [ ] Failing tests (real Redis): the N+1st request in the window is 429 with `Retry-After`; a second limiter instance (a second API process) sees the same consumption; per-identifier keys separate two identifiers; the window rolls over; Redis unavailable → 503 `INTERNAL`, never a silent pass (fail closed, documented, with a log line).
- [ ] Run — FAIL. Implement. Run — PASS. Commit.

### Task 6: Wiring and the statelessness assertion

**Files:** modify `src/server.ts`, `src/platform/module.ts`, `test/integration/statelessness.int.test.ts`, `test/integration/events.int.test.ts`; test `test/integration/http-cross-cutting.int.test.ts`.

- [ ] Move both existing integration modules to `defineRoute` (they currently take an Express router).
- [ ] Failing test: two API instances behind one Redis share a rate-limit bucket — the limit is reached across the pair, not per process (closes T-023's deferred item); an idempotent POST retried against the _other_ instance replays rather than re-running.
- [ ] Run — FAIL. Implement. Run — PASS. Commit.

### Task 7: Verification, review, ticket status

- [ ] `pnpm exec turbo run build lint typecheck test --force`, `pnpm exec prettier --check .`, and `KOMTRU_INFRA_TESTS=1 pnpm exec vitest run` in `apps/backend-api`.
- [ ] Fresh whole-branch reviewer subagent; triage with superpowers:receiving-code-review; fix what is real.
- [ ] T-025 status and deferred lines in `docs/tickets/02-backend-platform.md`; drop T-023's "asserted in T-025" clause now that it is asserted.
