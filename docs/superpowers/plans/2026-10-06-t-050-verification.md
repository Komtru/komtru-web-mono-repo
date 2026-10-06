# T-050 — Verification core (NIN/BVN, liveness, levels) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `trust` module that takes a NIN, a BVN or a liveness selfie from a signed-in user, runs it through a swappable KYC provider adapter in a background job, and grants or refuses `IDENTITY_VERIFIED` — without the raw identifier ever reaching a table, a log line or a Redis key in plaintext.

**Architecture:** One module, `src/modules/trust`, laid out `domain/ services/ http/ infrastructure/ jobs/` with `index.ts` the only way in. HTTP accepts a submission, writes a `verification_requests` row, seals the identifier under `ENCRYPTION_KEY` and enqueues a job; the job is the only code that holds the plaintext, calls the adapter, writes the outcome and re-evaluates the user's level. The adapter is `KycProviderAdapter` with two implementations behind a config flag — a deterministic fake that passes, fails, stalls, errors and asks for review depending on the identifier, and a Dojah adapter that refuses to run until credentials exist (owner's decision Q7).

**Tech Stack:** TypeScript 5 strict ESM, drizzle-orm 0.45 on PostgreSQL 15, zod 4, BullMQ, Express 5, Socket.IO, vitest.

**Spec:** `docs/specs/module-06-trust-and-verification.md` (§3 D1–D6, §4, §6.1–6.4, §6.10, §6.11, §7, §9, §11, §12). Ticket: `docs/tickets/05-trust.md` → `### T-050`. MVP rationale: `docs/MVP.md`.

## Global Constraints

- Exact dependency versions, never `^`. No new runtime dependency is needed by this plan.
- ESM: every relative import ends `.js`. TypeScript strict; no `any`, no non-null `!`.
- zod 4 (`z.strictObject`, `z.uuid()`, `z.iso.datetime()`), matching the files module's validations.
- Module layout is `domain/`, `services/`, `http/{controllers,routes,validations}`, `infrastructure/`, `jobs/`; `src/modules/trust/index.ts` is the only import path for other modules (`komtru/module-boundaries`).
- **T-028:** every call that reaches a KYC provider lives in a `*.client.ts` under `infrastructure/providers/` and is imported only from `jobs/`. Pure helpers live beside it under a different suffix. Enforced by `test/platform/provider-boundaries.test.ts` and the `komtru/provider-clients` lint rule.
- A caller's identity comes from `actor.principal` via `requireUserId(actor, detail)`, never from `actor.key`.
- Constraint-violation catches go through `isUniqueViolation` / `pgErrorIn` in `src/db/errors.ts`. drizzle wraps the `pg` error on `cause`; `error.code` at the top level is `undefined`.
- **D1 (spec §3):** a raw NIN or BVN is never written to a table, never logged, and never sits in Redis in plaintext. The masked form, a keyed HMAC and the provider's reference are all that persist.
- Migrations: `0029_trust_schema` (generated) and `0030_trust_level_changes_append_only` (custom, from `appendOnly()`). Generate with `pnpm --filter @komtru/backend-api db:generate`; verify with `pnpm migration:safety`.
- **Do not run infra tests.** Never set `KOMTRU_INFRA_TESTS=1`, never run `pnpm infra:up`/`infra:down`. `*.int.test.ts` files are written but not executed here.
- Do not run `pnpm tickets:index`. Do not merge. Do not push.
- Conventional commits, lower-case verb first in the subject.
- Sparse comments, explaining _why_.

## Review Focus

1. **A NIN already verified by another active user.** `nin_verifications_hash_active_unique` is a partial unique index; drizzle buries the 23505 on `cause`, so a top-level `error.code` read misses it and the user gets a 500 on a path the spec says must land in `MANUAL_REVIEW` — never auto-approve, never auto-reject (§7). Covered by Task 7.
2. **The same user submitting the same check twice, concurrently.** A read-then-insert in-flight guard loses the race and spends two provider calls (money) on one user. Must be a partial unique index on `verification_requests`. Covered by Task 5.
3. **A liveness selfie file id that is someone else's, tombstoned, or not a `KYC_DOCUMENT`.** The refusal must be an undifferentiated 404 — the same posture T-040 took, so the endpoint is not an existence oracle — and it must happen before any provider call is enqueued. Covered by Task 8.
4. **A provider that accepts and never answers.** The fake scripts this deliberately. The request must reach `EXPIRED` through the sweep rather than sit `PROVIDER_PENDING` forever, and expiry must grant no level. Covered by Task 10.
5. **`ENCRYPTION_KEY` absent.** Without it there is no way to enqueue the identifier safely, and the tempting fallback — enqueue it in the clear — breaks D1 silently. The module must refuse at boot, naming the variable, the way `createIdentityAuth` refuses a missing `IDENTITY_HMAC_PEPPER`. Covered by Task 4.

---

### Task 1: Schema, enums, migrations and an empty module in the registry

**Files:**

- Create: `src/modules/trust/infrastructure/postgres/schema/{columns,enums,requests,identity-checks,liveness,provider-calls,level-changes,index}.ts`
- Create: `src/modules/trust/{index.ts,module.ts}`
- Modify: `src/modules/index.ts`
- Create: `drizzle/0029_trust_schema.sql` (generated), `drizzle/0030_trust_level_changes_append_only.sql` (custom)
- Test: `test/modules/trust/schema.test.ts`, and an added case in `test/modules/registry.test.ts`

**Interfaces:**

- Consumes: `defineModule`, `SeedableModule` from `src/platform/module.js`; `appendOnly` from `src/db/helpers/appendOnly.js`.
- Produces: the drizzle tables `verificationRequests`, `ninVerifications`, `bvnVerifications`, `livenessChecks`, `kycProviderCalls`, `verificationLevelChanges`; the value arrays `VERIFICATION_TYPES`, `VERIFICATION_REQUEST_STATUSES`, `KYC_PROVIDERS` and their `type` aliases; `trustModule: KomtruModule` (name `'trust'`).

- [ ] **Step 1: Write the failing test**

`test/modules/trust/schema.test.ts` asserts over the exported value arrays and column metadata, with no database:

```ts
it('declares every verification type M6 §6.1 names', () => {
  expect(VERIFICATION_TYPES).toEqual([
    'NIN',
    'BVN',
    'LIVENESS',
    'CAC',
    'BANK_ACCOUNT_NAME_MATCH',
    'ADDRESS',
    'DOCUMENT',
    'SOCIAL_PROOF',
  ]);
});

it('declares FAKE alongside the real providers, so a fake-granted level is queryable', () => {
  expect(KYC_PROVIDERS).toContain('FAKE');
  expect(KYC_PROVIDERS).toEqual(
    expect.arrayContaining(['SMILE_IDENTITY', 'YOUVERIFY', 'PREMBLY', 'DOJAH', 'VERIFYME', 'MANUAL']),
  );
});

it('stores an identifier only as a mask and a keyed hash', () => {
  const columns = Object.keys(ninVerifications);
  expect(columns).toEqual(expect.arrayContaining(['ninMasked', 'ninHash', 'providerReference']));
  expect(columns).not.toContain('nin');
});
```

In `test/modules/registry.test.ts`, add: `expect(testModules().map((m) => m.name)).toContain('trust')`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust test/modules/registry.test.ts`
Expected: FAIL — cannot resolve `src/modules/trust/...`.

- [ ] **Step 3: Write the schema**

`columns.ts`: `export const trust = pgSchema('trust');` — one line, matching `files/.../columns.ts`.

`enums.ts`: the four value arrays and their `trust.enum(...)` declarations, per spec §6.1 —
`VERIFICATION_TYPES` (8 values, exactly as in the test), `VERIFICATION_REQUEST_STATUSES`
(`SUBMITTED`, `PROVIDER_PENDING`, `PROVIDER_PASSED`, `PROVIDER_FAILED`, `MANUAL_REVIEW`, `APPROVED`, `REJECTED`, `EXPIRED`),
`KYC_PROVIDERS` (`SMILE_IDENTITY`, `YOUVERIFY`, `PREMBLY`, `DOJAH`, `VERIFYME`, `MANUAL`, `FAKE`),
`LEVEL_CHANGE_DIRECTIONS` (`GRANT`, `REVOKE`). `FAKE` is this build's addition and the comment says why:
a level granted by the deterministic fake must be distinguishable from one a real provider attested,
so it can be found and revoked when credentials arrive.
`duplicate_flag_status`, `review_queue_status` and `social_proof_platform` are **not** declared — they
belong to the tables T-051 and T-052 own.

Tables, in `trust`, per spec §6.2, §6.3, §6.4, §6.10, §6.11, columns and indexes verbatim, with
`user_id` a soft reference (no cross-schema FK, per the §6.2 note). Three additions beyond the spec,
each with a comment:

- `verification_requests.target_level` is `smallint`, and a partial unique index
  `verification_requests_one_in_flight`: `UNIQUE (user_id, verification_type) WHERE status IN ('SUBMITTED','PROVIDER_PENDING','MANUAL_REVIEW')`.
  Review Focus 2: the in-flight guard has to be a constraint, because two concurrent submissions
  each read "nothing in flight" and each spend a provider call.
- `verification_requests.attempt_count` `integer NOT NULL DEFAULT 0` — the §9 "rejected twice in 30
  days" rule T-052 implements needs a count this module maintains.
- `kyc_provider_calls.error_kind` `text` — the call log is the input to §9's
  `verification.provider_degraded`, and "failed" with no shape is not an error rate.

`index.ts` re-exports all of the above.

- [ ] **Step 4: Write the empty module and register it**

`module.ts`: `createTrustModule()` returning `defineModule({ name: 'trust' })` for now, plus
`export const trustModule = createTrustModule();`. `index.ts`: `export * from './infrastructure/postgres/schema/index.js';` and `export { createTrustModule, trustModule } from './module.js';`.
In `src/modules/index.ts`, import `trustModule` and place it after `filesModule` (it reads file
records through M20's barrel) and before `notifyModule` (which only subscribes to what others
publish). No `moduleSeeds` entry: trust has no reference data.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust test/modules/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Generate the migrations**

Run: `pnpm --filter @komtru/backend-api db:generate`
Expected: `drizzle/0029_trust_schema.sql` written, journal updated. Confirm the number is 0029.

Then `pnpm --filter @komtru/backend-api exec drizzle-kit generate --custom --name trust_level_changes_append_only`
and fill `0030_...sql` with the output of `appendOnly('trust.verification_level_changes')` plus a
header comment: the level log is the record of why a user may transact, and a record that can be
rewritten is not a record (spec §6.11).

- [ ] **Step 7: Verify migration safety**

Run: `pnpm migration:safety`
Expected: exit 0, no findings against 0029 or 0030.

- [ ] **Step 8: Commit**

```bash
git add apps/backend-api/src/modules/trust apps/backend-api/src/modules/index.ts apps/backend-api/drizzle apps/backend-api/test
git commit -m "feat(trust): add the M6 verification schema and register the module"
```

---

### Task 2: Identifier handling — normalise, validate, mask, hash

**Files:**

- Create: `src/modules/trust/domain/identifiers.ts`
- Test: `test/modules/trust/identifiers.test.ts`

**Interfaces:**

- Consumes: `createHmacHasher`, `HmacHasher` from `src/platform/crypto/hmac.js`.
- Produces:
  - `normaliseIdentifier(raw: string): string` — strips every non-digit.
  - `isValidIdentifier(type: 'NIN' | 'BVN', normalised: string): boolean`
  - `maskIdentifier(normalised: string): string`
  - `HASH_DOMAIN: Record<'NIN' | 'BVN', string>`
  - `identifierHash(hasher: HmacHasher, type: 'NIN' | 'BVN', normalised: string): Buffer`

- [ ] **Step 1: Write the failing test**

```ts
it('strips separators a user types', () => {
  expect(normaliseIdentifier(' 123-456-789 01 ')).toBe('12345678901');
});

it('accepts eleven digits and nothing else', () => {
  expect(isValidIdentifier('NIN', '12345678901')).toBe(true);
  expect(isValidIdentifier('NIN', '1234567890')).toBe(false);
  expect(isValidIdentifier('BVN', '123456789012')).toBe(false);
});

it('masks all but the last four digits', () => {
  expect(maskIdentifier('12345678901')).toBe('*******8901');
});

it('separates the NIN and BVN hash domains, so a leaked row cannot confirm the other table', () => {
  const hasher = createHmacHasher('k'.repeat(32));
  expect(identifierHash(hasher, 'NIN', '12345678901')).not.toEqual(
    identifierHash(hasher, 'BVN', '12345678901'),
  );
});

it('is stable across equivalent spellings of the same number', () => {
  const hasher = createHmacHasher('k'.repeat(32));
  expect(identifierHash(hasher, 'NIN', normaliseIdentifier('123-456-789-01'))).toEqual(
    identifierHash(hasher, 'NIN', '12345678901'),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/identifiers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/modules/trust/domain/identifiers.ts`**

Both NIN and BVN are 11 digits in Nigeria; `isValidIdentifier` checks length and digits only — the
provider is the authority on whether the number exists, and a client-side check that guesses at
NIMC's allocation rules refuses real numbers. The mask keeps four digits, per §6.3's display form.
`HASH_DOMAIN` is `{ NIN: 'trust:nin', BVN: 'trust:bvn' }`, passed to the hasher's `hmac`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/identifiers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(trust): normalise, mask and keyed-hash a NIN or BVN"
```

---

### Task 3: The provider interface and the deterministic fake

**Files:**

- Create: `src/modules/trust/domain/provider.ts`
- Create: `src/modules/trust/infrastructure/providers/fake-script.ts`
- Create: `src/modules/trust/infrastructure/providers/fake-kyc.client.ts`
- Test: `test/modules/trust/fake-provider.test.ts`

**Interfaces:**

- Consumes: `KycProvider` type from Task 1's enums.
- Produces:
  - `type CheckVerdict = 'PASSED' | 'FAILED' | 'LOW_CONFIDENCE' | 'PENDING'`
  - `interface IdentityClaim { identifier: string; firstName: string; lastName: string; dateOfBirth?: string }`
  - `interface IdentityCheckResult { verdict: CheckVerdict; providerReference: string; nameMatchScore?: number; dobMatch?: boolean; phoneMatch?: boolean; failureReason?: string }`
  - `interface LivenessCheckInput { selfieStorageRef: string; matchedAgainst: 'NIN' | 'BVN' }`
  - `interface LivenessCheckResult { verdict: CheckVerdict; providerReference: string; matchScore: number; livenessPassed: boolean; failureReason?: string }`
  - `interface KycProviderAdapter { readonly provider: KycProvider; verifyNin(claim): Promise<IdentityCheckResult>; verifyBvn(claim): Promise<IdentityCheckResult>; checkLiveness(input): Promise<LivenessCheckResult> }`
  - `scriptFor(normalised: string): CheckVerdict | 'ERROR'` and `livenessScriptFor(selfieStorageRef: string): CheckVerdict`, from `fake-script.ts`
  - `createFakeKycClient(): KycProviderAdapter`

- [ ] **Step 1: Write the failing test**

```ts
it('scripts a distinct outcome per trailing digit, so every branch is reachable by hand', () => {
  expect(scriptFor('00000000000')).toBe('PENDING');
  expect(scriptFor('00000000001')).toBe('FAILED');
  expect(scriptFor('00000000002')).toBe('LOW_CONFIDENCE');
  expect(scriptFor('00000000003')).toBe('ERROR');
  expect(scriptFor('00000000004')).toBe('PASSED');
  expect(scriptFor('00000000009')).toBe('PASSED');
});

it('is deterministic: the same number twice is the same answer and the same reference', async () => {
  const fake = createFakeKycClient();
  const claim = { identifier: '12345678904', firstName: 'Ada', lastName: 'Obi' };
  expect(await fake.verifyNin(claim)).toEqual(await fake.verifyNin(claim));
});

it('returns a different reference for a different number', async () => {
  const fake = createFakeKycClient();
  const a = await fake.verifyNin({ identifier: '12345678904', firstName: 'Ada', lastName: 'Obi' });
  const b = await fake.verifyNin({ identifier: '12345678914', firstName: 'Ada', lastName: 'Obi' });
  expect(a.providerReference).not.toBe(b.providerReference);
});

it('throws for the scripted provider error, so the job retry path is exercised', async () => {
  const fake = createFakeKycClient();
  await expect(
    fake.verifyNin({ identifier: '12345678903', firstName: 'Ada', lastName: 'Obi' }),
  ).rejects.toThrow(/fake kyc/i);
});

it('reports itself as FAKE, never as a real vendor', () => {
  expect(createFakeKycClient().provider).toBe('FAKE');
});

it('fails liveness for a selfie ref the script reserves', () => {
  expect(livenessScriptFor('00000000-0000-0000-0000-00000000000f')).toBe('FAILED');
  expect(livenessScriptFor('00000000-0000-0000-0000-00000000000e')).toBe('LOW_CONFIDENCE');
  expect(livenessScriptFor('00000000-0000-0000-0000-000000000001')).toBe('PASSED');
});

it('does not pass everything: across ten thousand numbers it fails, stalls and errors', () => {
  const verdicts = new Set(Array.from({ length: 10_000 }, (_, i) => scriptFor(String(i).padStart(11, '0'))));
  expect(verdicts).toEqual(new Set(['PASSED', 'FAILED', 'LOW_CONFIDENCE', 'PENDING', 'ERROR']));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/fake-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `domain/provider.ts`**

Types only, no behaviour. Document that `verifyBusiness` and `verifyBankAccountName` (spec D3's
other two methods) are T-051's additions to this same interface, so a reader does not mistake the
three methods here for the whole of D3.

- [ ] **Step 4: Implement `infrastructure/providers/fake-script.ts`**

Pure, no imports beyond `node:crypto`. `scriptFor` switches on the last digit per the test;
digits 4–9 are `PASSED`. `livenessScriptFor` switches on the last hex character of the storage ref.
Scores are derived with `sha256` of the input so they are deterministic and spread rather than
constant: a name-match score pinned at 100 is a fake that teaches nothing. `LOW_CONFIDENCE` returns a
score in the 55–74 band, `PASSED` in 85–99.

This file is deliberately not `*.client.ts`: it is pure and unit-testable, and keeping the script out
of the client is the same split T-040 made between `cloudinary.signing.ts` and `cloudinary.client.ts`.

- [ ] **Step 5: Implement `infrastructure/providers/fake-kyc.client.ts`**

A thin shell over the script. `providerReference` is `fake_` plus the first 16 hex of
`sha256(domain + identifier)`, so it is stable per number and recognisable in a row. The `ERROR`
branch throws `new Error('fake kyc: scripted provider failure for a number ending in 3')`.
It is a `*.client.ts` — it has no network call, but it occupies the provider seam, and naming it
anything else would let a service import the adapter directly and have both boundary checks stay
green.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/fake-provider.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify the provider boundary still holds**

Run: `pnpm --filter @komtru/backend-api test -- test/platform/provider-boundaries.test.ts test/eslint/provider-clients.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git commit -am "feat(trust): add the KycProviderAdapter interface and a deterministic fake"
```

---

### Task 4: Configuration, the feature flag, and the Dojah adapter that refuses to run

**Files:**

- Modify: `src/config/env.ts`
- Create: `src/modules/trust/domain/errors.ts`
- Create: `src/modules/trust/infrastructure/providers/dojah.client.ts`
- Create: `src/modules/trust/jobs/providers.ts`
- Test: `test/config/trust-config.test.ts`, `test/modules/trust/provider-selection.test.ts`

**Interfaces:**

- Consumes: `AppConfig`, `loadConfig`; `createEncryption` from `src/platform/crypto/encryption.js`.
- Produces:
  - `AppConfig['trust']: TrustConfig = { provider: KycProvider; requestTtlMinutes: number; dojah?: { appId: string; secretKey: string; baseUrl: string } }`
  - `class KycProviderNotConfiguredError extends Error` (carries `provider` and `missing: string[]`)
  - `kycProvider(config: TrustConfig, logger: Logger): KycProviderAdapter` in `jobs/providers.ts`

- [ ] **Step 1: Write the failing tests**

`test/config/trust-config.test.ts`:

```ts
it('defaults to the fake provider outside production', () => {
  expect(loadConfig(baseEnv()).trust.provider).toBe('FAKE');
});

it('refuses to boot a production process on the fake provider', () => {
  expect(() => loadConfig({ ...baseEnv(), NODE_ENV: 'production' })).toThrow(/TRUST_KYC_PROVIDER/);
});

it('accepts DOJAH with its three credentials', () => {
  const config = loadConfig({
    ...baseEnv(),
    TRUST_KYC_PROVIDER: 'DOJAH',
    DOJAH_APP_ID: 'a',
    DOJAH_SECRET_KEY: 's',
    DOJAH_BASE_URL: 'https://api.dojah.io',
  });
  expect(config.trust.dojah?.appId).toBe('a');
});
```

`test/modules/trust/provider-selection.test.ts`:

```ts
it('builds the fake when the flag says FAKE', () => {
  expect(kycProvider({ provider: 'FAKE', requestTtlMinutes: 60 }, silentLogger()).provider).toBe('FAKE');
});

it('names the missing credentials when DOJAH is selected without them', () => {
  expect(() => kycProvider({ provider: 'DOJAH', requestTtlMinutes: 60 }, silentLogger())).toThrow(
    /DOJAH_APP_ID.*DOJAH_SECRET_KEY.*DOJAH_BASE_URL/s,
  );
});

it('refuses every Dojah call until a real integration exists', async () => {
  const dojah = kycProvider(
    {
      provider: 'DOJAH',
      requestTtlMinutes: 60,
      dojah: { appId: 'a', secretKey: 's', baseUrl: 'https://x.test' },
    },
    silentLogger(),
  );
  await expect(dojah.verifyNin({ identifier: '1', firstName: 'A', lastName: 'B' })).rejects.toBeInstanceOf(
    KycProviderNotConfiguredError,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @komtru/backend-api test -- test/config/trust-config.test.ts test/modules/trust/provider-selection.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the variables to `src/config/env.ts`**

`TRUST_KYC_PROVIDER` (`z.enum(KYC_PROVIDER_FLAGS)` where the flag values are `'FAKE' | 'DOJAH'` —
the other vendors in the database enum have no adapter, and offering them here would be a flag that
cannot be turned on), `TRUST_REQUEST_TTL_MINUTES` (`int(5, 10_080)`, default 1440),
`DOJAH_APP_ID`, `DOJAH_SECRET_KEY`, `DOJAH_BASE_URL` — all `required: false`, matching the posture
every other provider block takes so a developer's `.env` still boots.

Add the cross-field check beside the existing `FILES_QUOTA_NEAR_PCT` one, with its own comment:
when `nodeEnv === 'production'` and the resolved provider is `FAKE`, push `TRUST_KYC_PROVIDER` onto
`invalid`. A fake that grants real identity levels in production is not a configuration mistake
anyone should be able to make quietly.

Assemble `trust` in the returned `AppConfig` with a `trustConfig(v, nodeEnv)` helper beside
`filesConfig`; `dojah` is present only when all three variables are.

- [ ] **Step 4: Implement `domain/errors.ts` and `infrastructure/providers/dojah.client.ts`**

`KycProviderNotConfiguredError(provider, missing)` with a message naming every missing variable.

`dojah.client.ts` implements `KycProviderAdapter` with `provider: 'DOJAH'` and every method
rejecting with `KycProviderNotConfiguredError('DOJAH', ['live credentials'])`. The file's header
comment carries the endpoints a real integration will call
(`GET /api/v1/kyc/nin`, `GET /api/v1/kyc/bvn/full`, `POST /api/v1/kyc/photoid/verify`) and states
plainly that **no request has ever been made against a Dojah account from this repository**, so the
response mapping is deliberately absent rather than guessed: owner's decision Q7 puts real
verification out of scope, and a mapper written against an unseen response is code that will be
rewritten the day credentials arrive while reading as though it works.

- [ ] **Step 5: Implement `jobs/providers.ts`**

The only file that imports either `*.client.ts` — the same role `files/jobs/providers.ts` plays.
`kycProvider` switches on `config.provider`; the `DOJAH` branch throws
`KycProviderNotConfiguredError` listing whichever of the three variables is absent before it
constructs anything, and the `FAKE` branch logs one WARN naming the module and the flag, so an
operator reading a boot log sees which adapter is attesting identities.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @komtru/backend-api test -- test/config test/modules/trust`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(trust): select a KYC adapter by flag and refuse a fake in production"
```

---

### Task 5: Submitting a NIN or BVN

**Files:**

- Create: `src/modules/trust/domain/{events,queues}.ts`
- Create: `src/modules/trust/services/verification.service.ts`
- Test: `test/modules/trust/submit.test.ts`

**Interfaces:**

- Consumes: Task 1's tables; Task 2's identifier helpers; `publish`/`Tx` from `src/platform/events/publish.js`; `Encryption` from `src/platform/crypto/encryption.js`; `isUniqueViolation` from `src/db/errors.js`; `users` from `../identity/index.js`.
- Produces:
  - `domain/events.ts`: `verificationSubmitted`, `verificationRejected`, `verificationLevelAttained`, `verificationLevelRevoked`, `verificationDuplicateIdentityDetected` (payloads per spec §9).
  - `domain/queues.ts`: `TRUST_QUEUES = { IDENTITY_CHECK: 'trust.identity-check', LIVENESS_CHECK: 'trust.liveness-check' }`, `TRUST_SCHEDULES = { EXPIRE_STALE: 'trust.expire-stale' }`, and `interface SealedCheckJob { requestId: string; sealed: string }`.
  - `submitIdentifierCheck(deps, input: { userId: string; type: 'NIN' | 'BVN'; identifier: string; firstName: string; lastName: string; dateOfBirth?: string }): Promise<{ requestId: string; status: string }>`
  - `interface VerificationDeps { db: Db; hasher: HmacHasher; encryption: Encryption; requestTtlMinutes: number; logger: Logger }`

- [ ] **Step 1: Write the failing test**

Against a stubbed `Db` built the way the files module's service tests build theirs (a thin fake that
records the values passed to `insert().values()` and answers the two `select`s), so no infra is
needed:

```ts
it('refuses a user below CONTACT_VERIFIED', async () => {
  await expect(
    submitIdentifierCheck(depsFor({ verificationLevel: 'UNVERIFIED' }), validInput()),
  ).rejects.toMatchObject({ status: 409, code: 'CONTACT_VERIFICATION_REQUIRED' });
});

it('refuses a malformed number before it costs a provider call', async () => {
  await expect(submitIdentifierCheck(deps(), { ...validInput(), identifier: '123' })).rejects.toMatchObject({
    status: 422,
    code: 'VALIDATION_FAILED',
  });
});

it('translates the in-flight unique index into a 409, read through drizzle’s wrapping', async () => {
  const deps = depsWhereInsertThrows(uniqueViolation('verification_requests_one_in_flight'));
  await expect(submitIdentifierCheck(deps, validInput())).rejects.toMatchObject({
    status: 409,
    code: 'CONFLICT',
  });
});

it('writes no raw identifier into the request row', async () => {
  const { inserted } = await capture(() => submitIdentifierCheck(deps(), validInput()));
  expect(JSON.stringify(inserted)).not.toContain('12345678904');
});

it('seals the claim into the job payload rather than enqueuing it in the clear', async () => {
  const { enqueued, encryption } = await capture(() => submitIdentifierCheck(deps(), validInput()));
  expect(JSON.stringify(enqueued)).not.toContain('12345678904');
  expect(JSON.parse(encryption.decrypt(enqueued[0].sealed)).identifier).toBe('12345678904');
});

it('publishes verification.submitted carrying the type but not the number', async () => {
  const { events } = await capture(() => submitIdentifierCheck(deps(), validInput()));
  expect(events[0]).toMatchObject({ eventType: 'verification.submitted' });
  expect(JSON.stringify(events[0].payload)).not.toContain('12345678904');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/submit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the problem code**

In `packages/shared-types/src/errors.ts`, add `'CONTACT_VERIFICATION_REQUIRED'` to `PROBLEM_CODES`
with a comment: M6 §2 requires level 1 before an identity check, and a client renders
"verify your email and phone first", which it cannot do from a bare `CONFLICT`.

- [ ] **Step 4: Implement `domain/events.ts` and `domain/queues.ts`**

Events are `defineEvent(name, 1, z.object({...}))` per spec §9. `verification.submitted` carries
`{ requestId, userId, type }` — and nothing else, because every field added here is a field that
ends up in `platform.outbox` forever. `queues.ts` lives in `domain/` rather than `jobs/`, the
workaround T-040 documented: the service must enqueue without importing a directory the boundary
scanner taints, and a future import _into_ `queues.ts` would make that file the violation.

- [ ] **Step 5: Implement `services/verification.service.ts`**

`submitIdentifierCheck` runs in one transaction: read `users.verificationLevel` and `users.status`
(`ApiError` 409 `CONTACT_VERIFICATION_REQUIRED` below `CONTACT_VERIFIED`, 403 `FORBIDDEN` if the user
is not `ACTIVE`); normalise and validate the identifier (422 `VALIDATION_FAILED`); insert the
`verification_requests` row with `targetLevel: 2` and `expiresAt: sql\`now() + ...\``; publish
`verificationSubmitted`; and return the sealed payload for the caller to enqueue after commit.
The unique-violation catch goes through `isUniqueViolation(error, 'verification_requests_one_in_flight')`— a top-level`error.code`read sees`undefined`here (see`src/db/errors.ts`).

The sealed payload is `encryption.encrypt(JSON.stringify({ identifier, firstName, lastName, dateOfBirth }))`.
The whole claim is sealed, not just the number: a name and a date of birth travelling in the clear
through Redis is the same class of exposure the number is, and sealing one field while leaving the
others is the kind of half-measure that reads as compliance.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/submit.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(trust): accept a NIN or BVN submission and seal it into a job"
```

---

### Task 6: Levels — granting, revoking, and the append-only log

**Files:**

- Create: `src/modules/trust/domain/levels.ts`
- Create: `src/modules/trust/services/level.service.ts`
- Modify: `src/modules/identity/services/user.service.ts` (create if absent), `src/modules/identity/index.ts`
- Test: `test/modules/trust/levels.test.ts`

**Interfaces:**

- Consumes: `identityVerificationLevelChangedEvent`, `users` from `../identity/index.js`.
- Produces:
  - `domain/levels.ts`: `LEVEL_NAMES: readonly string[]` (index = numeric level), `levelNumber(name: string): number`, `levelName(n: number): string`, `earnedIdentityLevel(facts: { identifierVerified: boolean; livenessPassed: boolean }): boolean`
  - `services/level.service.ts`: `applyLevel(tx, deps, input: { userId: string; toLevel: number; direction: 'GRANT' | 'REVOKE'; reason: string; actorType: 'PROVIDER_AUTO' | 'KYC_ANALYST' | 'SYSTEM'; actorId?: string; triggeringRequestId?: string }): Promise<{ changed: boolean; from: number; to: number }>`
  - identity: `applyVerificationLevel(tx, { userId, to: string, reason: string }): Promise<{ from: string; to: string; changed: boolean }>`

- [ ] **Step 1: Write the failing test**

```ts
it('needs an identifier AND liveness for level 2 — a matched NIN alone proves someone typed a number', () => {
  expect(earnedIdentityLevel({ identifierVerified: true, livenessPassed: false })).toBe(false);
  expect(earnedIdentityLevel({ identifierVerified: false, livenessPassed: true })).toBe(false);
  expect(earnedIdentityLevel({ identifierVerified: true, livenessPassed: true })).toBe(true);
});

it('writes one level-change row and moves the identity column in the same transaction', async () => {
  const { rows, users } = await capture((tx) =>
    applyLevel(tx, deps(), {
      userId: U,
      toLevel: 2,
      direction: 'GRANT',
      reason: 'NIN + liveness',
      actorType: 'PROVIDER_AUTO',
    }),
  );
  expect(rows.verificationLevelChanges).toHaveLength(1);
  expect(rows.verificationLevelChanges[0]).toMatchObject({ fromLevel: 1, toLevel: 2, direction: 'GRANT' });
  expect(users.verificationLevel).toBe('IDENTITY_VERIFIED');
});

it('does nothing when the user is already at or above the level', async () => {
  const result = await applyLevel(tx, depsFor({ verificationLevel: 'BUSINESS_VERIFIED' }), grantTo(2));
  expect(result.changed).toBe(false);
});

it('revokes downward and records the direction', async () => {
  const { rows, users } = await capture((tx) =>
    applyLevel(tx, depsFor({ verificationLevel: 'IDENTITY_VERIFIED' }), {
      userId: U,
      toLevel: 1,
      direction: 'REVOKE',
      reason: 'provider reversed the attestation',
      actorType: 'SYSTEM',
    }),
  );
  expect(rows.verificationLevelChanges[0]).toMatchObject({ direction: 'REVOKE', toLevel: 1 });
  expect(users.verificationLevel).toBe('CONTACT_VERIFIED');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/levels.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `domain/levels.ts`**

`LEVEL_NAMES` is `['UNVERIFIED', 'CONTACT_VERIFIED', 'IDENTITY_VERIFIED', 'BUSINESS_VERIFIED', 'ENHANCED']`,
built so the array index _is_ the spec §4 numeric level, and derived from identity's exported enum
values rather than retyped — a second copy of this ladder is a copy that drifts.

- [ ] **Step 4: Implement identity's `applyVerificationLevel`**

A new `src/modules/identity/services/user.service.ts` holding one function: it reads the current
level, returns `{ changed: false }` when it already matches, otherwise updates
`users.verification_level` and `verification_synced_at` and publishes
`identityVerificationLevelChangedEvent` in the caller's transaction. Exported from
`src/modules/identity/index.ts`.

The comment states the deviation from spec D6 and why: the spec has M1 _subscribe_ to
`verification.level_attained`, but the relay makes that eventually consistent, so
`GET /verification/status` would answer with yesterday's level for as long as the queue is behind.
M6 still decides — identity never computes a level here, it only performs the write — and the write
lands in the same transaction as the `verification_level_changes` row, so the log and the column
cannot disagree.

- [ ] **Step 5: Implement `services/level.service.ts`**

`applyLevel` inserts the `verification_level_changes` row (append-only: INSERT and SELECT only, so
nothing here may ever update it), calls identity's `applyVerificationLevel`, and publishes
`verificationLevelAttained` or `verificationLevelRevoked`. A `GRANT` whose target is at or below the
current level is a no-op that writes nothing — a re-run of a redelivered job must not append a
second row saying the user moved from 2 to 2.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/levels.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(trust): grant and revoke a verification level through an append-only log"
```

---

### Task 7: The identity-check job and the outcome it records

**Files:**

- Create: `src/modules/trust/services/outcome.service.ts`
- Create: `src/modules/trust/jobs/{deps.ts,run-identity-check.job.ts}`
- Test: `test/modules/trust/identity-check-job.test.ts`

**Interfaces:**

- Consumes: Tasks 2, 3, 5, 6; `isUniqueViolation` from `src/db/errors.js`.
- Produces:
  - `jobs/deps.ts`: `interface TrustJobDeps { db: Db; adapter: KycProviderAdapter; hasher: HmacHasher; encryption: Encryption; gateway: SocketGateway; logger: Logger }`
  - `runIdentityCheck(deps: TrustJobDeps, data: SealedCheckJob): Promise<void>`
  - `recordIdentityOutcome(tx, deps, input: { request: VerificationRequest; result: IdentityCheckResult; normalised: string }): Promise<{ status: VerificationRequestStatus }>`

- [ ] **Step 1: Write the failing test**

Against the stub `Db` and a hand-built adapter, so no infra is needed:

```ts
it('writes a provider-call row whether the call passed or failed', async () => {
  const { rows } = await run({ verdict: 'FAILED' });
  expect(rows.kycProviderCalls).toHaveLength(1);
  expect(rows.kycProviderCalls[0]).toMatchObject({ provider: 'FAKE', callType: 'NIN', succeeded: false });
});

it('writes a provider-call row when the adapter throws, then rethrows for the queue to retry', async () => {
  await expect(run({ throws: new Error('boom') })).rejects.toThrow('boom');
  expect(lastRows().kycProviderCalls[0]).toMatchObject({ succeeded: false, errorKind: 'exception' });
});

it('stores the mask, the hash and the reference — and never the number', async () => {
  const { rows } = await run({ verdict: 'PASSED', identifier: '12345678904' });
  expect(rows.ninVerifications[0]).toMatchObject({ ninMasked: '*******8904' });
  expect(JSON.stringify(rows)).not.toContain('12345678904');
});

it('routes a NIN already verified by another active user to MANUAL_REVIEW, not a 500 and not a rejection', async () => {
  const { status, events } = await run({
    verdict: 'PASSED',
    insertThrows: uniqueViolation('nin_verifications_hash_active_unique'),
  });
  expect(status).toBe('MANUAL_REVIEW');
  expect(events.map((e) => e.eventType)).toContain('verification.duplicate_identity_detected');
});

it('leaves verified_at null on a LOW_CONFIDENCE outcome, so the uniqueness index does not claim the number', async () => {
  const { rows, status } = await run({ verdict: 'LOW_CONFIDENCE' });
  expect(rows.ninVerifications[0].verifiedAt).toBeNull();
  expect(status).toBe('MANUAL_REVIEW');
});

it('rejects terminally on FAILED and publishes verification.rejected', async () => {
  const { status, events } = await run({ verdict: 'FAILED' });
  expect(status).toBe('REJECTED');
  expect(events.map((e) => e.eventType)).toContain('verification.rejected');
});

it('leaves a PENDING verdict in PROVIDER_PENDING for the sweep, and grants nothing', async () => {
  const { status, rows } = await run({ verdict: 'PENDING' });
  expect(status).toBe('PROVIDER_PENDING');
  expect(rows.verificationLevelChanges).toHaveLength(0);
});

it('grants level 2 only once liveness has also passed', async () => {
  const { rows } = await run({ verdict: 'PASSED', existingLivenessPassed: true });
  expect(rows.verificationLevelChanges[0]).toMatchObject({ toLevel: 2 });
});

it('does nothing for a request that already reached a terminal status', async () => {
  const { rows } = await run({ verdict: 'PASSED', requestStatus: 'REJECTED' });
  expect(rows.ninVerifications).toHaveLength(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/identity-check-job.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `runIdentityCheck`**

Load the request; return immediately if its status is terminal (`APPROVED`, `REJECTED`, `EXPIRED`) —
a redelivered job must not call the provider again. Mark `PROVIDER_PENDING` with `provider_called_at`
and commit, so a crash during the call leaves a row the sweep can see. Open the sealed claim, call
the adapter inside a timer, and write `kyc_provider_calls` in every path including the throw — the
call log is the only record that money was spent. Rethrow so BullMQ retries.

`latency_ms` is measured around the adapter call alone. `cost_estimate_kobo` is left null for the
fake: inventing a price for a call that cost nothing would corrupt the reconciliation the column
exists for.

- [ ] **Step 4: Implement `recordIdentityOutcome`**

One transaction per verdict:

- `PASSED` → insert the outcome row with `verified_at` set, request `APPROVED`, then re-evaluate the
  level (Task 6). On `isUniqueViolation(error, '_hash_active_unique')`: re-insert with `verified_at`
  null, set the request `MANUAL_REVIEW`, publish `verification.duplicate_identity_detected`, and
  grant nothing. Spec §7 is explicit that neither auto-approval nor auto-rejection is acceptable
  here; the flag row and the review queue are T-052's tables, so this module publishes the event and
  stops.
- `LOW_CONFIDENCE` → outcome row with `verified_at` null, request `MANUAL_REVIEW`.
- `FAILED` → request `REJECTED` with `rejection_reason`, `attempt_count` incremented, publish
  `verification.rejected`.
- `PENDING` → leave `PROVIDER_PENDING`; the sweep owns it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/identity-check-job.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(trust): run the identity check in a job and record its outcome"
```

---

### Task 8: Liveness

**Files:**

- Modify: `src/modules/trust/services/verification.service.ts`
- Create: `src/modules/trust/jobs/run-liveness-check.job.ts`
- Test: `test/modules/trust/liveness.test.ts`

**Interfaces:**

- Consumes: `findServableFile` from `../files/index.js`; Tasks 3, 5, 6, 7.
- Produces:
  - `submitLivenessCheck(deps, input: { userId: string; selfieFileId: string }): Promise<{ requestId: string; status: string }>`
  - `runLivenessCheck(deps: TrustJobDeps, data: { requestId: string }): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
it('refuses a selfie uploaded by someone else with the same 404 as one that does not exist', async () => {
  const notMine = await submitLivenessCheck(depsWithFile({ uploaderUserId: OTHER }), {
    userId: U,
    selfieFileId: F,
  });
  // both refusals are byte-identical
  await expect(notMine).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  await expect(submitLivenessCheck(depsWithNoFile(), { userId: U, selfieFileId: F })).rejects.toMatchObject({
    status: 404,
    code: 'NOT_FOUND',
  });
});

it('refuses a file that is not a KYC_DOCUMENT', async () => {
  await expect(
    submitLivenessCheck(depsWithFile({ category: 'CHAT_ATTACHMENT' }), valid()),
  ).rejects.toMatchObject({ status: 404 });
});

it('enqueues nothing when the file check fails', async () => {
  await submitLivenessCheck(depsWithFile({ category: 'CHAT_ATTACHMENT' }), valid()).catch(() => {});
  expect(enqueued()).toHaveLength(0);
});

it('refuses liveness before any identifier has passed, naming the reason', async () => {
  await expect(submitLivenessCheck(depsWithNoVerifiedIdentifier(), valid())).rejects.toMatchObject({
    status: 409,
    code: 'CONFLICT',
  });
});

it('matches the selfie against the most recent passed identifier', async () => {
  const { rows } = await runLiveness({ latestPassed: 'BVN' });
  expect(rows.livenessChecks[0]).toMatchObject({ matchedAgainst: 'BVN', livenessPassed: true });
});

it('grants level 2 when liveness passes and an identifier is already verified', async () => {
  const { rows } = await runLiveness({ latestPassed: 'NIN' });
  expect(rows.verificationLevelChanges[0]).toMatchObject({ toLevel: 2 });
});

it('grants nothing when the provider says the selfie was not live', async () => {
  const { rows, status } = await runLiveness({ verdict: 'FAILED' });
  expect(rows.verificationLevelChanges).toHaveLength(0);
  expect(status).toBe('REJECTED');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/liveness.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `submitLivenessCheck`**

Resolve the selfie through M20's barrel (`findServableFile`), then check uploader and category in
this module — the file is stored through T-040 rather than down a second path, and the access-log
obligation on `KYC_DOCUMENT` belongs to M20's retrieval path, which this never uses: trust holds a
reference, never bytes. Absent, tombstoned, someone else's and wrong-category all answer the same
404, the posture T-040 established so the endpoint is not an existence oracle.

Then require a `verified_at`-stamped NIN or BVN row for the user (409 `CONFLICT`, detail naming the
missing step) — spec §4 is explicit that liveness is matched _against_ an identity document, so a
liveness check with nothing to match is not a weaker check, it is a meaningless one.

The job payload is `{ requestId }` only: the selfie reference is already a column on the request
row, and it is not a secret.

- [ ] **Step 4: Implement `runLivenessCheck`**

Same shape as Task 7's job: terminal-status guard, `PROVIDER_PENDING`, adapter call inside a timer,
a `kyc_provider_calls` row on every path, then a `liveness_checks` row with `matched_against` from
the most recent passed identifier, and a level re-evaluation.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/liveness.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(trust): accept a liveness selfie and check it against the passed identifier"
```

---

### Task 9: The HTTP surface, the socket push, and the composition root

**Files:**

- Create: `src/modules/trust/http/{validations.ts,controllers.ts,routes.ts}`
- Modify: `src/modules/trust/module.ts`, `src/modules/trust/index.ts`, `src/modules/index.ts`
- Test: `test/modules/trust/routes.test.ts`

**Interfaces:**

- Consumes: `defineRoute`, `requireUserId`; `SocketGateway` from `../socket/index.js`; every service above.
- Produces: `trustRoutes(deps: TrustHttpDeps): RouteDefinition[]`; `createTrustModule(options: { gateway: SocketGateway }): KomtruModule`; `VERIFICATION_SOCKET_EVENT = 'verification:updated'`.

- [ ] **Step 1: Write the failing test**

```ts
it('declares the M6 §11 user surface and nothing admin-facing yet', () => {
  expect(paths(trustModule)).toEqual([
    'POST /verification/nin',
    'POST /verification/bvn',
    'POST /verification/liveness',
    'GET /verification/status',
  ]);
});

it('scopes every verification route to CONSUMER and rate-limits the submissions', () => {
  for (const route of submissionRoutes()) {
    expect(route.scope).toBe('CONSUMER');
    expect(route.rateLimit?.by).toEqual(expect.arrayContaining(['ip', 'user']));
  }
});

it('answers 202, because the provider is never called on the request path', () => {
  expect(routeFor('POST /verification/nin').status).toBe(202);
});

it('rejects a body carrying an unexpected field', () => {
  expect(ninBody.safeParse({ nin: '12345678904', firstName: 'A', lastName: 'B', note: 'x' }).success).toBe(
    false,
  );
});

it('reports the level and the in-flight requests without echoing an identifier', async () => {
  const status = await readStatus(depsWithOneInFlight());
  expect(status).toMatchObject({ level: 'CONTACT_VERIFIED', levelNumber: 1 });
  expect(JSON.stringify(status)).not.toContain('12345678904');
});

it('pushes the terminal outcome to the submitting user and nobody else', async () => {
  const gateway = recordingGateway();
  await runIdentityCheck(depsWith(gateway), job());
  expect(gateway.emitted).toEqual([
    { userId: U, event: 'verification:updated', payload: expect.objectContaining({ status: 'APPROVED' }) },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the HTTP layer**

`validations.ts`: `z.strictObject` bodies. `ninBody`/`bvnBody` are
`{ nin | bvn: z.string().min(11).max(20), firstName: z.string().min(1).max(100), lastName, dateOfBirth: z.iso.date().optional() }`
— the length bound is loose because the service normalises separators out before validating, and a
`z.strictObject` is what keeps an extra field from riding along into the sealed claim.

`routes.ts`: the four routes, all `scope: 'CONSUMER'`, submissions `status: 202` and
`retryable: false` (the in-flight unique index makes a repeat a 409 rather than a second provider
call, which is a better answer than an idempotency key), rate limit `5` per `60s` by `['ip', 'user']`
— a KYC submission costs real money per call, so it is budgeted far tighter than an upload ticket.
`GET /verification/status` is not paginated: it returns one object with a bounded `inFlight` array.

The status response carries `{ level, levelNumber, levelAttainedAt, requirements: { identifier: {...}, liveness: {...} }, inFlight: [{ requestId, type, status, submittedAt, expiresAt }] }`
— the shape screens J2 and VF1 read.

- [ ] **Step 4: Implement the composition root**

`module.ts` grows `routes`, two `queues` (`TRUST_QUEUES.IDENTITY_CHECK`, `.LIVENESS_CHECK`, both
concurrency 2 — the provider is the bottleneck and a queued check is a user watching a spinner) and
`start()`, which builds `TrustJobDeps`: `kycProvider(config.trust, logger)` from `jobs/providers.ts`,
`createHmacHasher(config.identity.hmacPepper)` and `createEncryption(config)`. Both throw at boot,
naming their variable, rather than at the first submission — Review Focus 5: without
`ENCRYPTION_KEY` the only way to enqueue is in the clear, and that must not be reachable.

Note in the comment why the HMAC pepper is identity's: §12 flags the hash key as the one secret here
whose leak is irreversible, and giving trust its own variable now would mean two keys to migrate to
KMS later instead of one. Record it as a deferral rather than a decision made silently.

The terminal-outcome push is `deps.gateway.emitToUser(userId, VERIFICATION_SOCKET_EVENT, { requestId, type, status, level })`
from the jobs, wrapped in try/catch and logged: the outcome is already committed, and a failed emit
must not roll it back — `GET /verification/status` is the floor underneath the push.

In `src/modules/index.ts`, build the socket module into a `const` before the array so
`createTrustModule({ gateway: socket.gateway })` can take its gateway, and keep `socket` last in the
array so start order is unchanged. The comment says why: the registry is a pure function of the
process's connections, and the gateway is one of them.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust test/modules/registry.test.ts test/app.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(trust): serve the M6 user surface and push outcomes over the socket"
```

---

### Task 10: The expiry sweep, the D1 leak scan, and the integration suite

**Files:**

- Create: `src/modules/trust/jobs/expire-stale.job.ts`
- Modify: `src/modules/trust/module.ts`
- Test: `test/modules/trust/expire-stale.test.ts`, `test/modules/trust/no-raw-identifier.test.ts`, `test/integration/verification.int.test.ts`

**Interfaces:**

- Produces: `runExpireStale(deps: TrustJobDeps, firedAt: Date): Promise<{ expired: number }>`; schedule `trust.expire-stale`, cron `'13 * * * *'`.

- [ ] **Step 1: Write the failing tests**

`expire-stale.test.ts`:

```ts
it('expires a request past expires_at that never reached a decision', async () => {
  const { rows, result } = await sweep({ status: 'PROVIDER_PENDING', expiresAt: anHourAgo() });
  expect(result.expired).toBe(1);
  expect(rows.verificationRequests[0].status).toBe('EXPIRED');
});

it('grants no level on expiry', async () => {
  const { rows } = await sweep({ status: 'PROVIDER_PENDING', expiresAt: anHourAgo() });
  expect(rows.verificationLevelChanges).toHaveLength(0);
});

it('leaves a decided request alone however old it is', async () => {
  const { result } = await sweep({ status: 'APPROVED', expiresAt: aYearAgo() });
  expect(result.expired).toBe(0);
});

it('leaves a MANUAL_REVIEW request alone — a human owes it an answer, and expiry is not one', async () => {
  const { result } = await sweep({ status: 'MANUAL_REVIEW', expiresAt: anHourAgo() });
  expect(result.expired).toBe(0);
});

it('frees the in-flight slot, so the user can submit again', async () => {
  await sweep({ status: 'PROVIDER_PENDING', expiresAt: anHourAgo() });
  await expect(submitIdentifierCheck(deps(), validInput())).resolves.toMatchObject({ status: 'SUBMITTED' });
});
```

`no-raw-identifier.test.ts` — the ticket's "a test scans logs and tables after a verification run",
in its unit form: run submit → job → outcome with a capturing logger and the recording `Db`, then
assert the raw number appears in no log line, no inserted row, no published event payload and no
enqueued job payload. It asserts over the serialised whole, not named fields, so a column added
later cannot quietly start carrying it.

`test/integration/verification.int.test.ts` (written, **not run**), under
`describe.runIf(infraEnabled)` with `useTestDatabase()`:

```ts
it('takes a user from CONTACT_VERIFIED to IDENTITY_VERIFIED through NIN and liveness', ...);
it('holds a duplicate NIN in MANUAL_REVIEW and leaves the first user verified', ...);
it('leaves no raw identifier in any trust table or in platform.outbox', async () => {
  // scans every column of every table in the trust schema, plus platform.outbox, for the digits
  const hits = await owner().query(scanEveryTextColumnFor(RAW_NIN));
  expect(hits.rows).toEqual([]);
});
it('refuses an UPDATE of verification_level_changes as komtru_app', ...);
it('refuses a second in-flight NIN request for the same user', ...);
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust/expire-stale.test.ts test/modules/trust/no-raw-identifier.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `runExpireStale` and register the schedule**

One `UPDATE ... WHERE expires_at < now() AND status IN ('SUBMITTED', 'PROVIDER_PENDING')`.
`MANUAL_REVIEW` is deliberately excluded: it is waiting on a person, and expiring it would silently
close the case T-052 exists to work. Publish `verification.rejected` with reason `'expired'` for each
so the user is told, and register the schedule at `'13 * * * *'` — off the hour, like files'.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm --filter @komtru/backend-api test -- test/modules/trust`
Expected: PASS.

- [ ] **Step 5: Verify the whole branch**

Run, in order:

```bash
pnpm -w exec turbo run typecheck lint test --force
pnpm -w exec prettier --check .
pnpm migration:safety
```

Expected: all green. `KOMTRU_INFRA_TESTS` stays unset, so the `*.int.test.ts` files are skipped.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(trust): expire stale requests and prove no raw identifier is ever stored"
```

---

### Task 11: Review, fixes, and the ticket note

- [ ] **Step 1:** `superpowers:requesting-code-review` with a FRESH reviewer subagent on model `opus`, over the whole branch diff against `main`.
- [ ] **Step 2:** `superpowers:receiving-code-review` — verify each finding against the code before acting; push back where the reviewer is wrong, with the evidence.
- [ ] **Step 3:** Re-run the verification commands from Task 10 Step 5.
- [ ] **Step 4:** Mark `### T-050` in `docs/tickets/05-trust.md` done, with a `- **Status:** Done (2026-10-06). Plan: ...` note at the depth of T-031's and T-040's, plus a `- **Deferred:**` line covering: the Dojah adapter's absent request/response mapping; `verification.provider_degraded` (no error-rate tracker yet); `duplicate_identity_flags` and `kyc_review_queue` (T-052's tables, so a `MANUAL_REVIEW` request has no way to be decided until then); the shared `IDENTITY_HMAC_PEPPER` and §12's KMS recommendation; `verification_documents` and levels 3–4 (T-051); and the fake's missing latency simulation.
- [ ] **Step 5:** Commit the ticket note. Do not run `pnpm tickets:index`, do not merge, do not push.
