# T-010 Shared Types Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@komtru/shared-types` exports the contracts every app and the backend share: money in kobo, pagination, RFC 9457 problem details, public identifier formats and shared enums, each as a zod schema plus its inferred type.

**Architecture:** One file per concern under `packages/shared-types/src/`, re-exported from `src/index.ts`. Pure functions and zod schemas only; no I/O. NodeNext output (library preset) so the Node backend and Next.js apps both consume `dist/`.

**Tech Stack:** zod 4.6, fast-check 4 for property tests, Vitest 5.

**Spec:** `docs/tickets/01-shared-packages.md` (T-010); design §4.4 (pagination), §6.5 (money integer-only, round half up).

## Global Constraints

- Money is `bigint` kobo in code and a decimal digit string in JSON. No `number` ever holds money; no float arithmetic anywhere in money code.
- Every DTO is a zod schema with `z.infer` type exported beside it.
- Imports between files use `.js` extensions (NodeNext).

## Review Focus

1. A JSON amount sent as a number (`45200000`) or with decimals (`"452000.5"`) must be rejected by the kobo schema, not coerced (Task 1 test).
2. Negative and zero amounts: allowed by the general kobo schema (ledger balances can be zero or negative), rejected by `positiveKoboSchema` used for prices (Task 1 test).
3. Very large amounts beyond `Number.MAX_SAFE_INTEGER` must round-trip exactly (Task 1 property test).
4. Pagination `limit` above the maximum or below 1 is rejected, and a missing `limit` defaults to 20 (Task 2 test).
5. Trade codes typed with lowercase letters or spaces (`kmt-7398512-ng`, `KMT-7398512`) normalise to the canonical form (Task 4 test).

---

### Task 1: Money

**Files:** `src/money.ts`, `test/money.test.ts`

**Interfaces — produces:**

- `koboSchema: ZodType<bigint, string>` — accepts `/^-?\d+$/` strings only, outputs bigint.
- `positiveKoboSchema` — same, `> 0n`.
- `koboToJson(kobo: bigint): string`.
- `formatNaira(kobo: bigint, opts?: { showKobo?: boolean }): string` — `45200000n` → `₦452,000.00`; negatives as `-₦1,500.00`; `showKobo: false` → `₦452,000`.
- `nairaToKobo(input: string): bigint` — parses `"452000"`, `"452,000.50"`, `"₦1,500.5"`; throws `RangeError` on more than two decimals or any non-numeric character.
- `applyBps(amount: bigint, bps: bigint): bigint` — integer basis-point share, round half up (used by T-047 fee calculator).

- [ ] Tests (RED): schema accepts `"45200000"` → `45200000n`; rejects `45200000` (number), `"452000.5"`, `"1e5"`, `""`; positive schema rejects `"0"` and `"-1"`; `formatNaira` cases above; `nairaToKobo` cases and rejections; `applyBps(45200000n, 150n) === 678000n` (₦452,000 × 1.5% = ₦6,780, matching HTML V1); half-up: `applyBps(1n, 5000n) === 1n`, `applyBps(3n, 5000n) === 2n`. Property tests: for any bigint `k` in ±10^20, `koboSchema.parse(koboToJson(k)) === k` and `nairaToKobo(formatNaira(k)) === k`.
- [ ] Implement (GREEN). Commit `feat(shared-types): add kobo money schema and naira formatting`.

### Task 2: Pagination

**Files:** `src/pagination.ts`, `test/pagination.test.ts`

**Interfaces — produces:** `PAGE_LIMIT_DEFAULT = 20`, `PAGE_LIMIT_MAX = 100`; `cursorPageRequestSchema` (`{ cursor?: string; limit: number }`, limit coerced from query string, int 1..100, default 20); `pageRequestSchema` (`{ page: number ≥ 1 default 1; limit }`); `paginatedSchema(item)` → `{ items: T[]; nextCursor: string | null }`; `pagedSchema(item)` → `{ items: T[]; page; limit; total }`; types `CursorPageRequest`, `PageRequest`, `Paginated<T>`, `Paged<T>`.

- [ ] Tests (RED): defaults, `"50"` coerces to 50, rejects 0, 101, `"abc"`, 2.5; `paginatedSchema(z.object({id: z.string()}))` parses a page and rejects a missing `nextCursor`.
- [ ] Implement, commit `feat(shared-types): add cursor and page pagination contracts`.

### Task 3: Problem details

**Files:** `src/errors.ts`, `test/errors.test.ts`

**Interfaces — produces:** `PROBLEM_CODES` (readonly tuple: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `IDEMPOTENCY_KEY_REUSED`, `INTERNAL`, `INVALID_TRANSITION`, `NO_LOGISTICS_ACCESS`, `LAST_ADMIN`, `ALREADY_HAS_ACTIVE_COMPANY`, `ALREADY_A_MEMBER`, `MERCHANT_CANNOT_BUY`, `ADDRESS_REQUIRED`, `PARK_NOT_AVAILABLE_IN_CITY`); `ProblemCode`; `problemDetailsSchema` (`type` URI, `title`, `status` 400–599, `code: ProblemCode`, optional `detail`, `instance`, `errors: { path: string; message: string }[]`); `problemTypeUri(code)` → `https://docs.komtru.com/problems/<kebab-code>`; `isProblemDetails(x): x is ProblemDetails`.

- [ ] Tests (RED): parses a valid problem; rejects unknown code and status 200; `problemTypeUri('INVALID_TRANSITION')` → `https://docs.komtru.com/problems/invalid-transition`; type guard true/false.
- [ ] Implement, commit `feat(shared-types): add RFC 9457 problem details contract`.

### Task 4: Identifiers and enums

**Files:** `src/ids.ts`, `src/enums.ts`, `src/index.ts`, `test/ids.test.ts`, `test/index.test.ts` (replace placeholder)

**Interfaces — produces:**

- `uuidSchema` (any RFC 4122 UUID, lower-cased).
- `publicUserIdSchema` — `KMT-U-` + 6 Crockford base32 chars.
- `tradeCodeSchema` — input normalised (trim, uppercase); accepts `KMT-` + 5 to 8 digits with optional `-NG`; output canonical `KMT-<digits>-NG`. `TRADE_CODE_EXAMPLE = 'KMT-7398512-NG'`.
- `hubCodeSchema` — `H-[A-Z]{3}-\d{3}` (HTML `H-JIB-004`).
- `enums.ts`: `SESSION_SCOPES = ['CONSUMER','STAFF','LOGISTICS']`, `CURRENCIES = ['NGN']`, matching zod enums and types.
- `index.ts` re-exports everything; the placeholder `workspace` export is removed.

- [ ] Tests (RED): valid and invalid cases for each id; trade code normalisation cases from Review Focus 5; `KMT-88213` → `KMT-88213-NG`; index exposes every schema name.
- [ ] Implement, commit `feat(shared-types): add public identifier formats and shared enums`.
