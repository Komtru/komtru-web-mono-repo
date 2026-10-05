# T-028 Outbound Provider Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One base HTTP helper for every outbound provider call (timeouts, retry on idempotent calls only, structured logging with secrets redacted), a circuit breaker for the one synchronous exception, and the structural rule that keeps network-calling code in `*.client.ts` files reachable only from `jobs/` — enforced by a lint rule and a repo-wide boundary test.

**Architecture:** `platform/providers/http.ts` wraps Node's built-in `fetch`: one attempt per deadline (`AbortSignal.timeout`, composed with the caller's signal through `AbortSignal.any`), retry only when the call is declared idempotent, and one log line per attempt whose URL, headers and body are scrubbed before they reach pino. `platform/providers/circuit-breaker.ts` is a small consecutive-failure breaker with an injectable clock, used by the one documented synchronous call (OAuth code exchange, T-034). The structural rule has two halves, both in `eslint-rules/provider-clients.mjs`: a `*.client.ts` file may be imported only from `jobs/`, and `platform/providers/http.js` may be imported only from a `*.client.ts` file. A second, independent check (`test/platform/provider-boundaries.test.ts`) greps the real `src/modules` tree for the same violations, so the invariant survives a lint config someone disables.

**Tech Stack:** Node 22 built-in `fetch`/`undici` (no HTTP client dependency — retries, timeouts and logging are twenty lines each and an extra dependency would be a second redaction surface), pino 10 (existing logger), ESLint 9 flat config with the repo's two existing custom rules as the template, Vitest 5, `node:http` stub server on port 0.

**Spec:** design §4.4 (`docs/superpowers/specs/2026-10-05-komtru-platform-design.md`), ticket T-028 in `docs/tickets/02-backend-platform.md`; builds on T-023's queue factory (`src/platform/queue/factory.ts`), which is what runs the jobs that call clients.

## Global Constraints

- No provider adapter exists yet (Paystack is T-071, Cloudinary T-040, OAuth T-034). This ticket ships the platform helper, the structural rule and its enforcement. The rule is proven against fixtures and synthetic sources, not against real adapters.
- No new environment variable. Timeouts, attempt caps and backoff are per-provider decisions made at the call site, with exported defaults (`DEFAULT_TIMEOUT_MS = 10_000`, `DEFAULT_MAX_ATTEMPTS = 3`, `DEFAULT_BACKOFF_MS = 200`). `src/config/env.ts` is not touched (T-026 is editing it in parallel).
- Retry only on idempotent calls. `GET`/`HEAD` are idempotent by method; `POST`/`PATCH` must say `idempotent: true` (they carry a provider idempotency key). A non-idempotent call makes exactly one attempt, whatever the failure.
- Retry only on failures a repeat can fix: network error, timeout, `429`, `5xx`. A `4xx` other than `429` is final.
- Nothing from a provider's request or response body is logged. Logged fields: `provider`, `operation`, `method`, redacted `url`, `attempt`, `status`, `durationMs`, and `err` on failure.
- Relative imports carry the `.js` extension; backend code is plain exported functions; comments explain _why_, sparsely.
- Do not run infra-gated tests and do not touch Docker. The HTTP tests run against an in-process `node:http` server on port 0.

## Review Focus

1. A caller's `AbortSignal` must abort an in-flight attempt and must not be retried — a cancelled request that keeps calling the provider is worse than a failed one (Task 1 test: external abort rejects and the stub server sees one hit).
2. A redaction that only covers the `Authorization` header leaks the rest: secrets also travel as URL query parameters (`?api_key=`), as URL userinfo (`https://user:pass@host`) and under provider-specific header names (`x-api-key`, `verif-hash`). (Task 1 test: each form is `[redacted]` in the emitted log line.)
3. A retried `POST` that the provider already applied double-charges. The default must be "no retry" and the opt-in must be explicit per call. (Task 1 test: a `500` on a plain `POST` makes exactly one request.)
4. The lint rule must not be fooled by the extension rewrite (`./paystack.client.js` on disk is `paystack.client.ts`), by a dynamic `import()`, or by a re-export — the T-020 review already caught the first boundary rule missing exactly those. (Task 3 tests: all three forms in the `invalid` list.)
5. A rule nothing exercises rots. The boundary test must fail on a real violating file, not just on a synthetic string, and must still pass when `src/modules` is empty, as it is today. (Task 4 tests: a temporary violating file under `src/modules` is detected by the same scan that runs over the real tree.)

---

### Task 1: Provider HTTP helper

**Files:**

- Create: `apps/backend-api/src/platform/providers/http.ts`
- Test: `apps/backend-api/test/platform/provider-http.test.ts`, `apps/backend-api/test/support/stub-server.ts`

**Interfaces:**

- Consumes: `Logger` from `src/platform/logger.js`.
- Produces:

```ts
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS = 200;

export interface ProviderRequest {
  provider: string; // 'paystack'
  operation: string; // 'charge.verify' — a stable log field, never the URL
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  /** Sent as application/json when present. */
  body?: unknown;
  /** Deadline for ONE attempt. */
  timeoutMs?: number;
  /** Only an idempotent call is retried; GET and HEAD are idempotent by method. */
  idempotent?: boolean;
  maxAttempts?: number;
  backoffMs?: number;
  signal?: AbortSignal;
}

export interface ProviderResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
}

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly operation: string,
    readonly status: number,
    readonly body: unknown,
  );
}
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    readonly operation: string,
    readonly reason: 'timeout' | 'network' | 'circuit-open',
    options?: { cause?: unknown },
  );
}

export function redactUrl(url: string): string;
export function redactHeaders(headers: Record<string, string>): Record<string, string>;
export function providerRequest<T = unknown>(
  logger: Logger,
  request: ProviderRequest,
): Promise<ProviderResponse<T>>;
```

- [ ] **Step 1: Write `test/support/stub-server.ts`**

```ts
export interface StubServer {
  url: string;
  hits: { method: string; path: string; headers: Record<string, string>; body: string }[];
  close(): Promise<void>;
}
/** `handler` sees the hit index (0-based) so a test can fail twice then succeed. */
export const startStubServer = (
  handler: (req: IncomingMessage, res: ServerResponse, hit: number) => void,
): Promise<StubServer>;
```

Listens on `127.0.0.1:0`, records every request (body buffered to a string) in `hits`, and `url` is `http://127.0.0.1:<port>`.

- [ ] **Step 2: Write the failing tests in `test/platform/provider-http.test.ts`**

Each test builds a silent logger (`pino({ level: 'silent' })`) except the logging tests, which write into an array through a pino stream and assert on the parsed line.

Redaction (pure, no server):

```ts
it('redacts secrets from a url', () => {
  expect(redactUrl('https://api.x.test/v1/a?api_key=sk_live_1&page=2')).toBe(
    'https://api.x.test/v1/a?api_key=[redacted]&page=2',
  );
  expect(redactUrl('https://user:pw@api.x.test/v1/a')).toBe('https://[redacted]@api.x.test/v1/a');
  expect(redactUrl('not a url')).toBe('[unparseable url]');
});
it('redacts secret-bearing headers whatever their case', () => {
  expect(redactHeaders({ Authorization: 'Bearer t', 'X-Api-Key': 'k', Accept: 'application/json' })).toEqual({
    Authorization: '[redacted]',
    'X-Api-Key': '[redacted]',
    Accept: 'application/json',
  });
});
```

`redactUrl` redacts the value of any query parameter whose name matches `/(key|secret|token|signature|password|pin|hash)/i`, and redacts userinfo wholesale. `redactHeaders` redacts any header name matching `/^(authorization|cookie|set-cookie)$/i` or `/(api[-_]?key|secret|token|signature|hash)/i`.

Against the stub server:

```ts
it('returns the parsed json body and status of a 2xx response');
it('sends the body as json with the caller headers');
it(
  'throws ProviderHttpError with the status and parsed body on a 4xx' /* 422, body { message: 'bad' }, one hit */,
);
it('retries an idempotent GET on 500 and succeeds' /* fails twice, 3 hits, resolves */);
it('retries on 429' /* one 429 then 200, 2 hits */);
it('does not retry a 400' /* 1 hit */);
it('makes exactly one attempt for a POST that is not declared idempotent' /* 500 → rejects, 1 hit */);
it('retries a POST declared idempotent' /* 500 then 200, 2 hits */);
it(
  'gives up after maxAttempts and throws the last error' /* maxAttempts: 2, 2 hits, ProviderHttpError 500 */,
);
it(
  'throws ProviderUnavailableError with reason timeout when an attempt exceeds timeoutMs' /* handler never responds, timeoutMs: 30, idempotent: false */,
);
it('throws ProviderUnavailableError with reason network when the host refuses the connection');
it('stops when the caller aborts and does not retry' /* abort after first hit; rejects; hits.length === 1 */);
it(
  'logs one line per attempt with the redacted url and no body' /* assert line.url has api_key=[redacted], line.status, line.durationMs is a number, JSON.stringify(line) does not contain the secret or the request body */,
);
it('logs the failure at warn and the give-up at error');
```

Tests pass `backoffMs: 1` so the retry waits are real but negligible.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cd apps/backend-api && pnpm exec vitest run test/platform/provider-http.test.ts`
Expected: FAIL — cannot resolve `../../src/platform/providers/http.js`.

- [ ] **Step 4: Implement `src/platform/providers/http.ts`**

One attempt = `fetch(url, { method, headers, body, signal })` where `signal` is `AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(request.signal ? [request.signal] : [])])`. A `fetch` rejection is a timeout when the deadline signal fired, a caller abort when the caller's signal fired (rethrown, never retried), otherwise a network error. Retry decision: `idempotent ?? method is GET or HEAD`, and the failure is retryable (`ProviderUnavailableError` with reason `timeout`/`network`, or `ProviderHttpError` with status `429` or `>= 500`). Backoff doubles from `backoffMs` and is awaited with the global `setTimeout`. The response body is parsed as JSON when the content type says JSON, otherwise kept as text; an unparseable JSON body becomes the raw text rather than throwing.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/backend-api && pnpm exec vitest run test/platform/provider-http.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-api/src/platform/providers/http.ts apps/backend-api/test/platform/provider-http.test.ts apps/backend-api/test/support/stub-server.ts
git commit -m "feat(backend-api): add outbound provider http helper"
```

---

### Task 2: Circuit breaker for the synchronous exception

**Files:**

- Create: `apps/backend-api/src/platform/providers/circuit-breaker.ts`
- Test: `apps/backend-api/test/platform/provider-circuit-breaker.test.ts`

**Interfaces:**

- Consumes: `ProviderHttpError`, `ProviderUnavailableError` from Task 1.
- Produces:

```ts
export interface CircuitBreakerOptions {
  /** Provider name; appears in the log line and the error. */
  name: string;
  failureThreshold?: number; // default 5
  resetAfterMs?: number; // default 30_000
  logger: Logger;
  /** Injected in tests; defaults to Date.now. */
  now?: () => number;
}
export interface CircuitBreaker {
  run<T>(operation: string, call: () => Promise<T>): Promise<T>;
  state(): 'closed' | 'open' | 'half-open';
}
export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('stays closed and returns the value while calls succeed');
it(
  'opens after failureThreshold consecutive failures and then rejects without calling' /* call count stops rising; rejects with ProviderUnavailableError reason 'circuit-open' */,
);
it('counts a 500 and a timeout as failures but not a 400' /* 10 ProviderHttpError(400) leave it closed */);
it('resets the count on a success before the threshold');
it('goes half-open after resetAfterMs and closes again on a success' /* advance the injected clock */);
it('reopens when the half-open trial fails, and the clock restarts from that failure');
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd apps/backend-api && pnpm exec vitest run test/platform/provider-circuit-breaker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/platform/providers/circuit-breaker.ts`**

A closure over `{ failures, openedAt }`. Only a `ProviderUnavailableError`, or a `ProviderHttpError` with status `429` or `>= 500`, counts as a failure; anything else (including a thrown non-provider error) passes through without touching the counters, because a bug in our own code is not the provider being down. Opening and closing each log once at `warn`/`info` with `{ provider: name, operation }`.

- [ ] **Step 4: Run and watch them pass**

Run: `cd apps/backend-api && pnpm exec vitest run test/platform/provider-circuit-breaker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-api/src/platform/providers/circuit-breaker.ts apps/backend-api/test/platform/provider-circuit-breaker.test.ts
git commit -m "feat(backend-api): add provider circuit breaker"
```

---

### Task 3: `komtru/provider-clients` lint rule

**Files:**

- Create: `apps/backend-api/eslint-rules/provider-clients.mjs`, `apps/backend-api/eslint-rules/provider-clients.d.mts`
- Modify: `apps/backend-api/eslint.config.mjs`
- Test: `apps/backend-api/test/eslint/provider-clients.test.ts`

**Interfaces:**

- Produces: an ESLint rule module with two message ids, `clientOutsideJobs` and `httpOutsideClient`, registered as `komtru/provider-clients: 'error'` on `src/**/*.ts` alongside the two existing rules.

- [ ] **Step 1: Write the failing test**

Same shape as `test/eslint/module-boundaries.test.ts` (RuleTester wired to vitest, `tseslint.parser`). Paths, with `root = '/repo/apps/backend-api/src'`:

```
const client  = `${root}/modules/ledger/infrastructure/providers/paystack.client.ts`;
const helper  = `${root}/modules/ledger/infrastructure/providers/paystack.signature.ts`;
const job     = `${root}/modules/ledger/jobs/verify-charge.job.ts`;
const service = `${root}/modules/ledger/services/funding.service.ts`;
const route   = `${root}/modules/ledger/http/controllers.ts`;
```

valid:

- `job` imports `'../infrastructure/providers/paystack.client.js'`
- `job` dynamic-imports the same specifier
- `service` imports `'../infrastructure/providers/paystack.signature.js'` (a pure helper, not a client)
- `route` imports `'../infrastructure/providers/paystack.signature.js'`
- `client` imports `'../../../../platform/providers/http.js'`
- `helper` imports `'node:crypto'`
- `${root}/platform/providers/circuit-breaker.ts` imports `'./http.js'` (platform may use its own helper)

invalid:

- `service` imports `'../infrastructure/providers/paystack.client.js'` → `clientOutsideJobs`
- `route` imports `'../infrastructure/providers/paystack.client.js'` → `clientOutsideJobs`
- `route` re-exports (`export { x } from '...client.js'`) → `clientOutsideJobs`
- `route` dynamic-imports a client → `clientOutsideJobs`
- `${root}/modules/ledger/index.ts` imports a client → `clientOutsideJobs`
- `service` imports `'../../../platform/providers/http.js'` → `httpOutsideClient`
- `job` imports `'../../../platform/providers/http.js'` → `httpOutsideClient` (a job calls the client, it does not reach past it)

- [ ] **Step 2: Run and watch it fail**

Run: `cd apps/backend-api && pnpm exec vitest run test/eslint/provider-clients.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `eslint-rules/provider-clients.mjs`**

Resolve the specifier against the importing file's directory like `module-boundaries.mjs` does, then decide from the resolved path alone, so the `.js`-for-`.ts` rewrite needs no filesystem lookup: a target basename ending `.client.js`/`.client.ts` is a client; a target path ending `platform/providers/http.js`/`.ts` is the helper. The importer is a job when its path contains a `jobs/` segment, and a client when its own basename ends `.client.ts`. Handle `ImportDeclaration`, `ExportNamedDeclaration`, `ExportAllDeclaration` and literal `ImportExpression`, as `module-boundaries.mjs` does. Non-relative specifiers are ignored. Files under `src/platform/` may import the helper.

- [ ] **Step 4: Register the rule in `eslint.config.mjs`** next to `module-boundaries` and `pgbouncer-safe`, and add `provider-clients.d.mts` mirroring the other two.

- [ ] **Step 5: Run and watch it pass**

Run: `cd apps/backend-api && pnpm exec vitest run test/eslint/provider-clients.test.ts && pnpm exec eslint .`
Expected: both PASS (the rule finds nothing in today's source, which has no modules).

- [ ] **Step 6: Commit**

```bash
git add apps/backend-api/eslint-rules apps/backend-api/eslint.config.mjs apps/backend-api/test/eslint/provider-clients.test.ts
git commit -m "feat(backend-api): add provider-clients lint rule"
```

---

### Task 4: Repo-wide boundary test

**Files:**

- Create: `apps/backend-api/test/support/provider-imports.ts`, `apps/backend-api/test/platform/provider-boundaries.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ClientImportViolation {
  file: string; // repo-relative
  specifier: string;
  kind: 'client-outside-jobs' | 'http-outside-client';
}
/** Walks `root` (default `src/modules`) and reports every forbidden provider import. */
export function findProviderImportViolations(root: string): Promise<ClientImportViolation[]>;
```

- [ ] **Step 1: Write the failing test**

```ts
it(
  'finds a client imported from a service and from an http controller' /* writes a fixture tree in a tmpdir: modules/x/{http/controllers.ts, services/a.service.ts, jobs/b.job.ts, infrastructure/providers/{p.client.ts, p.signature.ts}} and expects exactly the two violations, by file and kind */,
);
it('accepts the same client imported from jobs/ and the pure helper imported from http/');
it('finds a file reaching past its client straight to the platform http helper');
it('reports nothing for an empty tree');
it(
  'passes over the real src/modules tree' /* await expect(findProviderImportViolations(resolve(import.meta.dirname, '../../src/modules'))).resolves.toEqual([]) */,
);
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd apps/backend-api && pnpm exec vitest run test/platform/provider-boundaries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `test/support/provider-imports.ts`**

Recursive `fs.readdir(..., { withFileTypes: true })` over `.ts` files (a missing root yields `[]`, since `src/modules` holds only `index.ts` today), matching `from '...'` / `import('...')` specifiers with one regex, then applying the same two predicates as the lint rule, resolved relative to the file. This is deliberately a second, independent implementation: it is what still fails if the lint rule is disabled or mis-registered.

- [ ] **Step 4: Run and watch it pass**

Run: `cd apps/backend-api && pnpm exec vitest run test/platform/provider-boundaries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend-api/test/support/provider-imports.ts apps/backend-api/test/platform/provider-boundaries.test.ts
git commit -m "test(backend-api): assert no http or services file imports a provider client"
```

---

### Task 5: Record the asynchronous-by-default decisions and the OAuth exception

**Files:**

- Modify: `docs/superpowers/specs/2026-10-05-komtru-platform-design.md` (§4.4, after the existing exception paragraph)
- Modify: `docs/tickets/02-backend-platform.md` (T-028 status line), and the notes on T-034, T-040, T-071 where each later ticket must honour the rule

- [ ] **Step 1: Extend design §4.4** with the enforcement detail and the per-flow decisions, which the later tickets implement:
  - Where the code lives: `infrastructure/providers/<provider>.client.ts` (network, `jobs/` only) versus pure sibling files (webhook signature verification, payload parsing, Cloudinary upload signing) that request handlers may use.
  - How it is enforced: `komtru/provider-clients` plus `test/platform/provider-boundaries.test.ts`.
  - The three flows that are made asynchronous instead of breaking the rule: Paystack charges start client-side via Paystack Inline against a server-issued reference, with the webhook and a verify job confirming; bank-name resolution, KYC checks and IMEI lookups write a pending record, run in a job, and push the result over the socket (T-027).
  - The exception, with its exact wording for the owner, and an "Owner acknowledgement: pending" marker.

- [ ] **Step 2: Mark T-028 done** in `docs/tickets/02-backend-platform.md` with a `**Status:**` line pointing at this plan, and note under T-034/T-040/T-071 that their network calls go in a `*.client.ts` under `infrastructure/providers/`.

- [ ] **Step 3: Verify the whole branch**

Run from the worktree root: `pnpm exec turbo run build lint typecheck test --force` then `pnpm exec prettier --check .`
Expected: every task green; record the test counts.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs(design): record provider client boundary and the oauth exception"
```
