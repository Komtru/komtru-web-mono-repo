# T-020 Backend Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/backend-api` becomes a real Express 5 service: validated config, structured logs with request ids, RFC 9457 errors, health endpoints that probe Postgres (through PgBouncer) and Redis, a module system with a `/v1` route registry and an enforced module boundary, and two processes (API and worker) that shut down gracefully and report to Sentry.

**Architecture:** `createApp(deps)` builds the Express app from injected dependencies (logger, health checks, modules) so tests run it with supertest and no network. `src/index.ts` and `src/worker.ts` are thin entrypoints that load config, create real clients, and wire shutdown. Platform code lives in `src/platform/*`; domain modules in `src/modules/<name>/` expose only `index.ts`. Node loads `.env` via `--env-file-if-exists` (no dotenv).

**Tech Stack:** Express 5.2, zod 4.6 (via `@komtru/shared-types` problem types), pino 10 + pino-http 11, @sentry/node 11, helmet 8, cors 2.8, compression 1.8, pg 8, ioredis 5, uuid 14 (v7 request ids), supertest 7, tsx 4 for dev.

**Spec:** `docs/tickets/02-backend-platform.md` (T-020); design §3.2, §4.2, §4.4; `docs/runbooks/local-dev.md` for the local stack.

## Global Constraints

- Config errors list variable NAMES only, never values (the backend .env holds live credentials).
- Every error response is problem details (`@komtru/shared-types` `ProblemDetails`); a 500 never leaks a message or stack.
- Health: `GET /health/live` (process up, no I/O) and `GET /health/ready` (Postgres via `POSTGRES_URL`, Redis via `REDIS_URL`), outside `/v1`.
- Modules import other modules only through `src/modules/<name>/index.ts`; enforced by a local ESLint rule.
- No `console.*` in app code (shared lint rule); use the logger.

## Review Focus

1. A request whose body is invalid JSON gets a 400 problem response, not an HTML error page (Task 2 test).
2. An unknown route under `/v1` and outside it both return a 404 problem (Task 2 test).
3. Readiness must fail (503, naming the failed dependency) when Postgres or Redis is down, and must not hang: each check times out (Task 3 test with an unreachable port).
4. A client-supplied `X-Request-Id` that is huge or contains control characters is replaced, not echoed into logs (Task 2 test).
5. Shutdown runs every closer even if one throws, and finishes within the timeout (Task 5 test).

---

### Task 1: Config

**Files:** `apps/backend-api/src/config/env.ts`, `test/config/env.test.ts`

**Interfaces — produces:** `loadConfig(env: NodeJS.ProcessEnv): AppConfig`; `class ConfigError extends Error { missing: string[]; invalid: string[] }`. `AppConfig` = `{ nodeEnv: 'development'|'test'|'production'; port: number; log: { level; format: 'json'|'pretty' }; http: { allowedOrigins: string[]; trustProxyHops: number }; postgres: { url; directUrl?: string; ssl: boolean; poolMax: number }; redis: { url }; sentry: { dsn?: string; environment: string } }`.

- [ ] Tests: minimal valid env parses with defaults (PORT 7813, LOG_LEVEL info, format pretty outside production / json in production, poolMax 10, ssl false); `ALLOWED_ORIGINS` comma list split and trimmed; missing `POSTGRES_URL` and `REDIS_URL` → `ConfigError` whose message names both and contains no value from the env; invalid `PORT=abc` → listed under invalid; `SENTRY_DSN=''` → undefined.
- [ ] Implement with a zod schema. Commit.

### Task 2: App, logging, request ids, errors

**Files:** `src/app.ts`, `src/platform/logger.ts`, `src/platform/request-id.ts`, `src/platform/errors.ts`, `test/app.test.ts`, `test/platform/errors.test.ts`

**Interfaces — produces:** `createLogger(config): Logger` (pino; pretty transport only when format is pretty); `class ApiError extends Error { constructor(status: number, code: ProblemCode, title: string, detail?: string) }`; `createApp({ config, logger, health, modules }): Express`; `requestId` middleware sets `req.id` and `X-Request-Id` (accepts client value only if it matches `^[A-Za-z0-9._-]{1,64}$`, else uuid v7); `errorHandler(logger, onUnexpected)` maps ApiError → its status, ZodError → 422 `VALIDATION_FAILED` with `errors[]`, body-parser syntax error → 400 `VALIDATION_FAILED`, anything else → 500 `INTERNAL` with title "Something went wrong" and `instance` = request id.

- [ ] Tests via supertest: helmet headers present; CORS allows a listed origin and not an unlisted one; invalid JSON body → 400 problem; unknown `/v1/nope` and `/nope` → 404 problem with `code: NOT_FOUND`; a route throwing `ApiError(409,'INVALID_TRANSITION',…)` → 409 problem; a route throwing a plain Error → 500 problem whose body contains neither the message nor a stack, and `onUnexpected` was called; valid client request id echoed; 500-char or newline request id replaced with a uuid.
- [ ] Implement. Commit.

### Task 3: Health

**Files:** `src/platform/health.ts`, `src/platform/clients.ts`, `test/platform/health.test.ts`, `test/integration/health.int.test.ts`

**Interfaces — produces:** `type HealthCheck = { name: string; check(): Promise<void> }`; `runChecks(checks, timeoutMs = 2000): Promise<{ ok: boolean; checks: Record<string, 'ok' | 'failed' | 'timeout'> }>`; `postgresCheck(pool: pg.Pool)`, `redisCheck(redis: Redis)`; `createClients(config): { pool: pg.Pool; redis: Redis; close(): Promise<void> }`.

- [ ] Unit tests: all ok → 200 `{ status: 'ok' }`; one failing → 503 naming it; a never-resolving check → `timeout` within ~timeout; `/health/live` never calls checks.
- [ ] Integration test (local Docker stack; skipped unless `KOMTRU_INFRA_TESTS=1`): real clients → ready 200; a pool pointed at an unused port → 503 with `postgres: 'failed'`.
- [ ] Implement. Commit.

### Task 4: Modules, `/v1` registry, boundary rule

**Files:** `src/platform/module.ts`, `src/modules/index.ts`, `eslint-rules/module-boundaries.mjs`, `eslint.config.mjs`, `test/platform/module.test.ts`, `test/eslint/module-boundaries.test.ts`

**Interfaces — produces:** `defineModule({ name, routes?: (router: Router) => void, healthChecks?: HealthCheck[], start?, stop? }): KomtruModule`; `src/modules/index.ts` exports `modules: KomtruModule[]` (empty now); app mounts each module's routes on `/v1`.

- [ ] Tests: a fake module's route answers at `/v1/<path>`; duplicate module names throw at startup; ESLint RuleTester: from `src/modules/trades/services/a.ts`, importing `../../identity/services/x.js` → error, `../../identity/index.js` → ok, `../domain/y.js` → ok, `../../../platform/logger.js` → ok.
- [ ] Implement; wire the rule into the backend's ESLint config. Commit.

### Task 5: Entrypoints, Sentry, graceful shutdown

**Files:** `src/index.ts`, `src/worker.ts`, `src/platform/sentry.ts`, `src/platform/shutdown.ts`, `test/platform/shutdown.test.ts`; Modify `package.json` scripts (`dev`, `dev:worker`, `start`, `start:worker`, `build`).

**Interfaces — produces:** `initSentry(config, processName): { captureException(err): void; flush(): Promise<void> }` (no-op without DSN); `gracefulShutdown({ closers: Array<{ name; close(): Promise<void> }>, timeoutMs, logger }): Promise<void>` (runs all closers, logs failures, resolves by the timeout).

- [ ] Tests: all closers run even when one throws; a hanging closer does not block past the timeout; `initSentry` without DSN returns a no-op.
- [ ] Implement entrypoints: API listens on `PORT`, sets `keepAliveTimeout` 65s / `headersTimeout` 66s, and on SIGTERM/SIGINT stops accepting, then closes clients and modules; worker starts modules' `start()` hooks and shuts down the same way.
- [ ] Verify: `pnpm --filter @komtru/backend-api build && node --env-file-if-exists=.env dist/index.js` with the generated `.env` serves `/health/ready` 200; SIGTERM exits 0. Commit.
