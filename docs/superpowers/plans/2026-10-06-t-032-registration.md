# T-032 — Registration, OTP and password login: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build M1's account-opening half — phone-first and email registration, OTP challenges delivered through `notify`, password login by email/phone/username, forgot/reset/change password, and terms acceptance — on top of T-030's schema and T-031's session service, with no new migration.

**Architecture:** Pure domain under `identity/domain/{credential,otp}` (hashing, breach, policy, lockout, challenge arithmetic) with no database and no I/O; services that always take the caller's transaction (`Tx`), so a login's session row, audit row, device row and outbox event commit together or not at all; controllers that hold no logic beyond mapping a service outcome onto a status code. `otp_challenges` is used as the general "prove you hold this secret" table: a 6-digit OTP and a 256-bit password-reset token are the same row shape with different entropy and different `max_attempts`, which is why the reset flow needs no new storage. Delivery is the existing M11 pipeline: identity publishes `identity.otp.requested` into the outbox and notify's binding turns it into an SMS or an email.

**Tech Stack:** TypeScript 6 strict ESM (`.js` on every relative import), zod 4, drizzle-orm 0.45, express 5, `@node-rs/argon2` 2.2.2 (new), `jose` (already present, T-031), vitest 5.

**Spec:** `docs/specs/module-01-identity-and-user-management.md` (§2, §5.4–5.6, §9.1, §9.3, §10.1, §11, §14, §15, §17); ticket `docs/tickets/03-identity.md` § T-032; screens E2, E3, E3b, E4, AC2, AC3, TOS1, TOS2 in `docs/design-reference/Komtru — UI Screens Living Master File.html`; T-031's plan `docs/superpowers/plans/2026-10-05-t-031-sessions.md`.

## Global Constraints

- **No drizzle migration.** T-030 created every table this ticket writes to. If a column seems missing, stop and report rather than adding one. Notification templates and mappings are _not_ schema — they are synced from `notify/domain/catalogue.ts` at boot, so adding one is a code change.
- **Never run the infra suite.** No `KOMTRU_INFRA_TESTS=1`, no `pnpm infra:up`, no `pnpm infra:down`. Write `*.int.test.ts` files; do not execute them. Unit tests only: `pnpm --filter @komtru/backend-api test`.
- **Never run `pnpm tickets:index`.**
- Exact dependency versions, no `^`.
- Module layout: `domain/`, `services/`, `http/{controllers,routes,validations}`, `infrastructure/`. `src/modules/identity/index.ts` is the only way in; `eslint-rules/module-boundaries.mjs` enforces it.
- Conventional commits, lower-case verb first in the subject (commitlint rejects sentence case).
- Comments are sparse and explain _why_, never _what_.
- Verify with `--force`: turbo's cache is shared across worktrees.
- **S12 is absolute:** no email, phone, password, OTP code or token in any log line. Log `userId` and masked or hashed identifiers only.
- **S1:** argon2id at `m=19456 KiB, t=2, p=1` minimum, transparent rehash on login.
- **S2:** minimum 10 characters, breach-checked by k-anonymity (HIBP range API, 5-char prefix only), no composition rules.
- **S3:** uniform authentication failure — same status, same body, same timing across nonexistent user / wrong password / social-only account / locked account.
- **S4:** login 5/min/identifier + 20/min/IP; OTP send 3/10min/destination and 10/day; OTP verify 5 attempts per challenge; password reset 3/hour/identifier.
- **S5:** 10 failed attempts → 15-minute lock, exponential thereafter, never permanent.
- **S6:** OTP 6 digits, cryptographically random, 5-minute TTL, single use, invalidated on new issuance for the same purpose+destination, HMAC stored never plaintext.
- **S10:** every auth-sensitive action writes `identity.identity_audit_log` in the same transaction as the change.
- **T-030's standing rule:** `user_emails.email` and `user_emails.email_normal` must both come from **one** `normaliseEmail()` call; `user_phones.phone_e164` from `normalisePhone()`.

## Review Focus

Five inputs the spec implies but no obvious task exercises. Each has a test attached to the task that owns the code.

1. **Two people verify the same email at the same instant.** `user_emails_verified_unique` is a partial unique index, so the loser gets a 23505 from Postgres, not a tidy service answer. It must become a 409 `CONFLICT`, not a 500. (Task 5)
2. **A phone-path user has no password and calls `/auth/password/change`.** M1 §9.3 says the phone path sets a password _after_ verification, and there is no other endpoint to set a first one. `currentPassword` must be optional exactly when `user_credentials` has no row, and required otherwise — a mandatory-but-ignorable `currentPassword` would let a stolen session change a password without proving the old one. (Task 9)
3. **A registration OTP has to reach an address nobody has verified yet.** `resolveDestination` treats unverified as absent, so today every registration OTP would be recorded `DEAD_LETTERED` and no SMS would leave the building. (Task 10)
4. **One `identity.otp.requested` event, two seeded templates (SMS and EMAIL).** Dispatch fans out to every active channel under a key, so a phone registration OTP would also be emailed — to an address that does not exist, dead-lettering a security-critical row on every signup. (Task 10)
5. **`req.ip` is attacker-controlled when `TRUST_PROXY_HOPS` is mis-set, and `otp_challenges.created_ip` / `users.registration_ip` / `users.consent_ip` are `inet` columns.** An unparseable value must be dropped, not handed to Postgres as a 22P02 and a 500. (Task 7)

---

## File Structure

**New — identity domain (pure, no I/O):**

- `src/modules/identity/domain/credential/hashing.ts` — argon2id, verify, `needsRehash`, decoy. Cannibalized from `kumtru/backend-apis/src/modules/identity/domain/credential/hashing.ts` (T-001).
- `src/modules/identity/domain/credential/breach.ts` — HIBP k-anonymity. Cannibalized from the same directory, adapted to take its config and logger as arguments.
- `src/modules/identity/domain/credential/policy.ts` — length, offline weak list, reuse, identifier-in-password.
- `src/modules/identity/domain/credential/lockout.ts` — S5's schedule.
- `src/modules/identity/domain/otp/challenge.ts` — code length, TTL, budgets, domain-separated hashing, outcome types.
- `src/modules/identity/domain/terms.ts` — current versions and the acceptance check.
- `src/modules/identity/domain/registration.ts` — `nextStep` from a user's state.

**New — identity services (each takes `Tx`):**

- `src/modules/identity/services/audit.service.ts`
- `src/modules/identity/services/otp.service.ts`
- `src/modules/identity/services/contact.service.ts`
- `src/modules/identity/services/credential.service.ts`
- `src/modules/identity/services/device.service.ts`
- `src/modules/identity/services/auth.service.ts` — register, challenge verification, terms acceptance.
- `src/modules/identity/services/login.service.ts` — password login.
- `src/modules/identity/services/password.service.ts` — forgot, reset, change.

**New — identity HTTP:**

- `src/modules/identity/http/validations/registration.validation.ts`
- `src/modules/identity/http/validations/password.validation.ts`
- `src/modules/identity/http/controllers/registration.controller.ts`
- `src/modules/identity/http/controllers/password.controller.ts`
- `src/modules/identity/http/routes/registration.routes.ts`
- `src/modules/identity/http/routes/password.routes.ts`

**Modified:**

- `src/modules/identity/domain/events.ts` — nine new events.
- `src/modules/identity/index.ts` — new exports; `createIdentityAuth` builds the new routes. **Merge-conflict surface.**
- `src/platform/errors.ts` — `ApiError.extensions`, spread into the problem body (RFC 9457 extension members).
- `src/platform/http/route.ts` — `'device'` rate-limit key and `deviceFrom`.
- `src/platform/http/rateLimit.ts` — the same.
- `src/config/env.ts` + `apps/backend-api/.env.example` — five variables.
- `packages/shared-types/src/errors.ts` — `INVALID_CREDENTIALS`, `OTP_INVALID`. **Merge-conflict surface.**
- `src/modules/notify/domain/binding.ts` — `NotificationRecipient.channels`, `allowsUnverifiedDestination`, four identity bindings. **Merge-conflict surface.**
- `src/modules/notify/services/recipients.service.ts`, `services/dispatch.service.ts`, `jobs/send.job.ts` — honour both.
- `package.json` (backend-api) — `@node-rs/argon2` `2.2.2`.

---

### Task 1: Password hashing, breach check and policy

**Files:**

- Create: `src/modules/identity/domain/credential/hashing.ts`, `breach.ts`, `policy.ts`, `lockout.ts`
- Modify: `apps/backend-api/package.json`
- Test: `test/modules/identity/domain/credential/{hashing,breach,policy,lockout}.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  // hashing.ts
  export const ARGON2_PARAMS: Readonly<{
    algorithm: Algorithm;
    memoryCost: 19456;
    timeCost: 2;
    parallelism: 1;
  }>;
  export const PASSWORD_ALGORITHM = 'argon2id';
  export const hashPassword: (plaintext: string) => Promise<string>;
  export const verifyPassword: (plaintext: string, phcHash: string) => Promise<boolean>;
  export const needsRehash: (phcHash: string) => boolean;
  export const performDecoyVerification: (attempted: string) => Promise<false>;
  /** The port every caller takes, so a timing test can inject a cheap implementation. */
  export interface PasswordHasher {
    hash(plaintext: string): Promise<string>;
    verify(plaintext: string, phcHash: string): Promise<boolean>;
    needsRehash(phcHash: string): boolean;
    decoy(attempted: string): Promise<false>;
  }
  export const argon2Hasher: PasswordHasher;

  // breach.ts
  export interface BreachResult {
    breached: boolean;
    count: number;
    checkUnavailable: boolean;
  }
  export const sha1Hex: (value: string) => string;
  export const findSuffixCount: (body: string, suffix: string) => number;
  export interface BreachDeps {
    enabled: boolean;
    logger: Logger;
    fetch?: typeof globalThis.fetch;
  }
  export const checkPasswordBreached: (deps: BreachDeps, password: string) => Promise<BreachResult>;

  // policy.ts
  export const MIN_PASSWORD_LENGTH = 10;
  export const MAX_PASSWORD_LENGTH = 256;
  export type PasswordRejection =
    'TOO_SHORT' | 'TOO_LONG' | 'COMMON' | 'CONTAINS_IDENTIFIER' | 'BREACHED' | 'REUSED';
  export interface PasswordVerdict {
    ok: boolean;
    rejection?: PasswordRejection;
    message?: string;
  }
  export const OFFLINE_WEAK_PASSWORDS: ReadonlySet<string>;
  export const checkPasswordPolicy: (
    password: string,
    context?: { identifiers?: readonly string[] },
  ) => PasswordVerdict;
  export const PASSWORD_REJECTION_MESSAGE: Record<PasswordRejection, string>;

  // lockout.ts
  export const LOCKOUT_THRESHOLD = 10;
  export const LOCKOUT_BASE_MINUTES = 15;
  export const LOCKOUT_CAP_MINUTES = 1440;
  export const lockoutMinutes: (failedAttempts: number) => number;
  export const lockedUntil: (failedAttempts: number, now: Date) => Date | null;
  ```

- [ ] **Step 1: Add the dependency**

```bash
cd apps/backend-api && pnpm add @node-rs/argon2@2.2.2
```

Check the written `package.json` line is exactly `"@node-rs/argon2": "2.2.2"` with no caret.

- [ ] **Step 2: Write the failing hashing tests**

`test/modules/identity/domain/credential/hashing.test.ts`:

```ts
it('produces a PHC string at the OWASP baseline and verifies it', async () => {
  const phc = await hashPassword('correct horse battery staple');
  expect(phc).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  await expect(verifyPassword('correct horse battery staple', phc)).resolves.toBe(true);
  await expect(verifyPassword('wrong', phc)).resolves.toBe(false);
});

it('reads a corrupt hash as a wrong password rather than throwing', async () => {
  await expect(verifyPassword('x', 'not-a-phc-string')).resolves.toBe(false);
});

it.each([
  ['$argon2id$v=19$m=4096,t=2,p=1$abc$def', true, 'weaker memory'],
  ['$argon2id$v=19$m=19456,t=1,p=1$abc$def', true, 'weaker time'],
  ['$argon2i$v=19$m=65536,t=4,p=1$abc$def', true, 'a different argon2 variant'],
  ['$2b$12$abcdefghijklmnopqrstuv', true, 'a bcrypt row'],
  ['$argon2id$v=19$m=65536,t=4,p=2$abc$def', false, 'stronger than the baseline'],
])('needsRehash(%s) is %s for %s', (phc, expected) => {
  expect(needsRehash(phc)).toBe(expected);
});

it('decoy verification always fails and always does the work', async () => {
  // Two calls with different inputs both return false, and the second is not short-circuited:
  // the decoy hash is memoised, so the second call still runs a full verify.
  await expect(performDecoyVerification('a')).resolves.toBe(false);
  await expect(performDecoyVerification('b')).resolves.toBe(false);
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/domain/credential/hashing.test.ts`
Expected: FAIL, cannot resolve `hashing.js`.

- [ ] **Step 4: Create `hashing.ts`**

Copy `kumtru/backend-apis/src/modules/identity/domain/credential/hashing.ts` verbatim, then: add the `.js` extension discipline (it imports nothing relative), keep the file header note "Cannibalized from kumtru/backend-apis/src/modules/identity/domain/credential/hashing.ts (T-001)", and add the `PasswordHasher` port plus `argon2Hasher` at the bottom. Keep the existing `getDecoyHash` memoisation exactly as it is — the comment there is the whole §S3 timing argument.

- [ ] **Step 5: Run them and confirm they pass**

Run: the same command. Expected: PASS.

- [ ] **Step 6: Write the failing breach tests**

`test/modules/identity/domain/credential/breach.test.ts`:

```ts
it('matches a suffix on the line key, never as a substring of the body', () => {
  // The count 0018AB... would match a naive `body.includes(suffix)`.
  const body = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0018ABCDEF0123456789ABCDEF0123456789ABC\r\nBBBBB:7';
  expect(findSuffixCount(body, 'BBBBB')).toBe(7);
  expect(findSuffixCount(body, '0018ABCDEF0123456789ABCDEF0123456789ABC')).toBe(0);
});

it('sends only the first five hex characters of the SHA-1 and never the rest', async () => {
  const seen: string[] = [];
  const fakeFetch = async (url: string) => {
    seen.push(String(url));
    return new Response('ABC:3');
  };
  await checkPasswordBreached({ enabled: true, logger: silent, fetch: fakeFetch as never }, 'password');
  const digest = sha1Hex('password');
  expect(seen[0]).toBe(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`);
  expect(seen[0]).not.toContain(digest.slice(5));
});

it('reports a hit with its count', async () => {
  const digest = sha1Hex('password');
  const fakeFetch = async () => new Response(`${digest.slice(5)}:12345`);
  await expect(
    checkPasswordBreached({ enabled: true, logger: silent, fetch: fakeFetch as never }, 'password'),
  ).resolves.toEqual({ breached: true, count: 12345, checkUnavailable: false });
});

it('fails open when the corpus cannot be reached', async () => {
  const fakeFetch = async () => {
    throw new Error('ECONNRESET');
  };
  await expect(
    checkPasswordBreached({ enabled: true, logger: silent, fetch: fakeFetch as never }, 'x'),
  ).resolves.toEqual({ breached: false, count: 0, checkUnavailable: true });
});

it('fails open on a non-200', async () => {
  /* Response('', { status: 503 }) → checkUnavailable: true */
});

it('does no network call at all when the flag is off', async () => {
  let called = false;
  const fakeFetch = async () => {
    called = true;
    return new Response('');
  };
  await expect(
    checkPasswordBreached({ enabled: false, logger: silent, fetch: fakeFetch as never }, 'x'),
  ).resolves.toEqual({ breached: false, count: 0, checkUnavailable: false });
  expect(called).toBe(false);
});
```

- [ ] **Step 7: Run them and confirm they fail, then create `breach.ts`**

Copy the cannibalized `breach.ts`, with the header note, and these adaptations: `config.identity.breachCheckEnabled` and the module-level `logger` become `BreachDeps` fields; `fetch` is injectable and defaults to `globalThis.fetch`; `REQUEST_TIMEOUT_MS` stays 3000; the `Add-Padding: true` header and the "never log the password, the digest, or the prefix" comment stay.

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/domain/credential/breach.test.ts`. Expected: PASS.

- [ ] **Step 8: Write the failing policy and lockout tests**

`policy.test.ts`:

```ts
it('rejects below ten characters and accepts ten', () => {
  expect(checkPasswordPolicy('nine char').rejection).toBe('TOO_SHORT');
  expect(checkPasswordPolicy('tencharact').ok).toBe(true);
});
it('has no composition rules', () => {
  expect(checkPasswordPolicy('aaaaaaaaaaaaaaaaaaaaaaaa').rejection).not.toBe('COMMON'); // long and dull is fine
  expect(checkPasswordPolicy('correct horse battery staple').ok).toBe(true);
});
it('rejects the offline list, which is what a breach-check outage falls back to', () => {
  expect(checkPasswordPolicy('password12').rejection).toBe('COMMON');
  expect(checkPasswordPolicy('Password12').rejection).toBe('COMMON'); // case-folded
});
it('refuses a password that contains the identifier it protects', () => {
  expect(checkPasswordPolicy('janedoe2026!', { identifiers: ['janedoe'] }).rejection).toBe(
    'CONTAINS_IDENTIFIER',
  );
  expect(checkPasswordPolicy('jane@example.com', { identifiers: ['jane@example.com'] }).rejection).toBe(
    'CONTAINS_IDENTIFIER',
  );
});
it('bounds the input, because argon2 hashes whatever it is given', () => {
  expect(checkPasswordPolicy('a'.repeat(257)).rejection).toBe('TOO_LONG');
});
it('has a message for every rejection', () => {
  for (const r of ['TOO_SHORT', 'TOO_LONG', 'COMMON', 'CONTAINS_IDENTIFIER', 'BREACHED', 'REUSED'] as const) {
    expect(PASSWORD_REJECTION_MESSAGE[r]).toBeTruthy();
  }
});
```

`lockout.test.ts`:

```ts
it.each([
  [0, 0],
  [9, 0],
  [10, 15],
  [11, 30],
  [12, 60],
  [13, 120],
])('%i failures locks for %i minutes', (n, m) => {
  expect(lockoutMinutes(n)).toBe(m);
});
it('caps at a day, because a permanent lockout is a denial of service against our own users (S5)', () => {
  expect(lockoutMinutes(100)).toBe(LOCKOUT_CAP_MINUTES);
  expect(Number.isFinite(lockoutMinutes(1_000_000))).toBe(true);
});
it('lockedUntil is null below the threshold and a future date above it', () => {
  const now = new Date('2026-10-06T00:00:00Z');
  expect(lockedUntil(9, now)).toBeNull();
  expect(lockedUntil(10, now)).toEqual(new Date('2026-10-06T00:15:00Z'));
});
```

The offline list: at least the 40 most common passwords long enough to pass the length check (`password12`, `qwerty1234`, `1234567890`, `iloveyou12`, …). Matching is case-folded and whitespace-trimmed.

- [ ] **Step 9: Create `policy.ts` and `lockout.ts`, run both files, confirm PASS**

`lockoutMinutes` is `min(LOCKOUT_CAP_MINUTES, LOCKOUT_BASE_MINUTES * 2 ** (n - LOCKOUT_THRESHOLD))` for `n >= LOCKOUT_THRESHOLD`, else 0. Compute the cap before the exponent so a large `n` does not overflow to `Infinity`.

- [ ] **Step 10: Commit**

```bash
git add apps/backend-api/package.json pnpm-lock.yaml apps/backend-api/src/modules/identity/domain/credential apps/backend-api/test/modules/identity/domain/credential
git commit -m "feat(identity): add argon2id hashing, breach check and password policy"
```

---

### Task 2: Configuration, problem codes and the per-device rate-limit key

**Files:**

- Modify: `packages/shared-types/src/errors.ts`, `apps/backend-api/src/platform/errors.ts`, `apps/backend-api/src/platform/http/route.ts`, `apps/backend-api/src/platform/http/rateLimit.ts`, `apps/backend-api/src/config/env.ts`, `apps/backend-api/.env.example`
- Create: `apps/backend-api/src/modules/identity/domain/terms.ts`
- Test: `test/config/env.test.ts`, `test/platform/http/route.test.ts`, `test/platform/http/rate-limit.int.test.ts`, `test/modules/identity/domain/terms.test.ts`, `packages/shared-types/test/errors.test.ts` (or wherever that package's tests live)

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  // shared-types/src/errors.ts — two new members of PROBLEM_CODES
  'INVALID_CREDENTIALS' // every §S3 login failure, so the body is identical across all of them
  'OTP_INVALID'         // a wrong, expired or exhausted challenge (E3b)

  // platform/errors.ts
  class ApiError {
    constructor(status, code, title, detail?, fieldErrors?, extensions?: Record<string, unknown>)
  }

  // platform/http/route.ts
  interface RateLimitSpec {
    by: ('ip' | 'user' | 'identifier' | 'device')[];
    identifierFrom?: (input: { body: unknown; query: unknown; params: unknown }) => string | undefined;
    deviceFrom?: (input: { body: unknown; query: unknown; params: unknown }) => string | undefined;
  }

  // config/env.ts — AppConfig.identity gains:
  hmacPepper?: string; breachCheckEnabled: boolean; mirrorPhoneOtpToEmail: boolean;
  // AppConfig.app gains (or a new `terms` block):
  terms: { version: string; privacyVersion: string };

  // identity/domain/terms.ts
  export const DEFAULT_TERMS_VERSION = '2026-08-01';
  export const DEFAULT_PRIVACY_VERSION = '2026-08-01';
  export interface TermsState { termsVersion: string; privacyVersion: string; acceptedTermsVersion: string | null; acceptedPrivacyVersion: string | null }
  export const termsUpToDate: (state: TermsState) => boolean;
  ```

- [ ] **Step 1: Write the failing tests**

`packages/shared-types` errors test:

```ts
it('knows the two codes T-032 answers with', () => {
  expect(PROBLEM_CODES).toContain('INVALID_CREDENTIALS');
  expect(PROBLEM_CODES).toContain('OTP_INVALID');
  expect(problemTypeUri('INVALID_CREDENTIALS')).toBe('https://docs.komtru.com/problems/invalid-credentials');
});
```

`test/platform/http/route.test.ts`:

```ts
it('refuses a route that limits by device but cannot find one', () => {
  expect(() =>
    assertRouteInvariants([routeWith({ rateLimit: { points: 1, durationSeconds: 1, by: ['device'] } })]),
  ).toThrow(/rate limits by device but provides no deviceFrom/);
});
it('accepts one that supplies deviceFrom', () => {
  expect(() =>
    assertRouteInvariants([
      routeWith({
        rateLimit: { points: 1, durationSeconds: 1, by: ['device'], deviceFrom: () => 'fp' },
      }),
    ]),
  ).not.toThrow();
});
```

Add to `test/platform/http/mount.test.ts` (unit, runnable):

```ts
it('carries an ApiError extension member into the problem body', async () => {
  // a route whose handler throws new ApiError(422,'OTP_INVALID','…',undefined,undefined,{ attemptsRemaining: 2 })
  expect(response.body).toMatchObject({ code: 'OTP_INVALID', attemptsRemaining: 2 });
});
```

`test/config/env.test.ts`:

```ts
it('reads the identity variables T-032 adds', () => {
  const config = loadConfig({
    ...base,
    IDENTITY_HMAC_PEPPER: 'p'.repeat(32),
    IDENTITY_BREACH_CHECK_ENABLED: 'true',
    IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL: 'true',
    APP_TERMS_VERSION: '2026-09-01',
  });
  expect(config.identity.hmacPepper).toBe('p'.repeat(32));
  expect(config.identity.breachCheckEnabled).toBe(true);
  expect(config.identity.mirrorPhoneOtpToEmail).toBe(true);
  expect(config.terms.version).toBe('2026-09-01');
});
it('defaults the terms versions and the two flags', () => {
  const config = loadConfig(base);
  expect(config.identity.breachCheckEnabled).toBe(false);
  expect(config.identity.mirrorPhoneOtpToEmail).toBe(false);
  expect(config.terms).toEqual({ version: DEFAULT_TERMS_VERSION, privacyVersion: DEFAULT_PRIVACY_VERSION });
});
it('refuses a pepper short enough to be guessed', () => {
  expect(() => loadConfig({ ...base, IDENTITY_HMAC_PEPPER: 'short' })).toThrow(/IDENTITY_HMAC_PEPPER/);
});
```

`test/modules/identity/domain/terms.test.ts`: `termsUpToDate` is true only when both accepted versions equal both current ones; null accepted versions are not up to date.

Write (do not run) in `test/platform/http/rate-limit.int.test.ts`: two requests with the same `deviceFingerprint` from **different IPs** exhaust a `by: ['device'], points: 1` budget, and a third request with a different fingerprint still passes — proving the key is the fingerprint and not the IP.

- [ ] **Step 2: Run the unit tests and confirm they fail**

Run: `pnpm --filter @komtru/shared-types test` and `pnpm --filter @komtru/backend-api exec vitest run test/config test/platform/http/route.test.ts test/platform/http/mount.test.ts test/modules/identity/domain/terms.test.ts`

- [ ] **Step 3: Implement**

- `shared-types/src/errors.ts`: add the two codes in the "Domain" block with a one-line comment each naming T-032.
- `platform/errors.ts`: a sixth constructor parameter `extensions?: Record<string, unknown>`; `toProblem` spreads it **before** the known members so an extension can never overwrite `status`, `code` or `type`.
- `platform/http/route.ts`: add `'device'` to `RateLimitSpec['by']`, add `deviceFrom`, and add the invariant mirroring the `identifierFrom` one.
- `platform/http/rateLimit.ts`: `PHASE.device = 'after-parse'` (the fingerprint is in the body); `subjectFor` returns `spec.deviceFrom?.(parsed)` for `'device'`. Keep the existing lower-casing.
- `config/env.ts`: `IDENTITY_HMAC_PEPPER` (`z.string().min(32)`, optional — a process with no identity module boots without it, exactly as `IDENTITY_SIGNING_KEY` does), `IDENTITY_BREACH_CHECK_ENABLED` and `IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL` (boolean, optional, default false), `APP_TERMS_VERSION` / `APP_PRIVACY_VERSION` (optional strings). Note in a comment that the last two are **not** in `docs/specs/backend-apis.env`, so `pnpm env:backend` will not write them and the defaults are what every environment gets until someone sets them.
- `.env.example`: add `APP_TERMS_VERSION=2026-08-01` and `APP_PRIVACY_VERSION=2026-08-01` under the identity block.
- `identity/domain/terms.ts`: the two default constants and `termsUpToDate`.

- [ ] **Step 4: Run the unit tests and confirm they pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(platform): add a per-device rate-limit key, problem extensions and identity config"
```

---

### Task 3: Identity events and the audit writer

**Files:**

- Modify: `src/modules/identity/domain/events.ts`, `src/modules/identity/index.ts`
- Create: `src/modules/identity/services/audit.service.ts`
- Test: `test/modules/identity/domain/events.test.ts`, `test/modules/identity/services/audit.int.test.ts` (int — write, do not run)

**Interfaces:**

- Consumes: `defineEvent` from `@komtru/shared-types`, `publish`/`Tx` from `platform/events/publish.js`.
- Produces:

  ```ts
  // domain/events.ts — all via defineEvent(type, 1, schema)
  identityUserRegisteredEvent          'identity.user.registered'
    { userId, publicId, registeredVia: string, channel: 'EMAIL'|'PHONE', ip: string|null }
  identityOtpRequestedEvent            'identity.otp.requested'
    { userId: uuid|null, challengeId: uuid, purpose: OtpPurpose, channels: ('SMS'|'EMAIL')[],
      code: string, expiresInMinutes: number }
  identityEmailVerifiedEvent           'identity.email.verified'   { userId, emailId }
  identityPhoneVerifiedEvent           'identity.phone.verified'   { userId, phoneId }
  identityLoginFailedEvent             'identity.login.failed'
    { identifierHash: string, identifierKind: 'EMAIL'|'PHONE'|'USERNAME', ip: string|null, reason: string }
  identityPasswordChangedEvent         'identity.password.changed'
    { userId, viaRecovery: boolean, changedAt: iso, revokedSessions: number }
  identityDeviceSignedInEvent          'identity.device.signed_in'
    { userId, deviceId: uuid|null, deviceLabel: string, location: string, signedInAt: iso, ip: string|null }
  identityUserStatusChangedEvent       'identity.user.status_changed'
    { userId, from: string, to: string, reason: string }
  identityVerificationLevelChangedEvent 'identity.user.verification_level_changed'
    { userId, from: string, to: string }

  // services/audit.service.ts
  export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';
  export type AuditActorType = 'USER' | 'STAFF' | 'SYSTEM' | 'ANONYMOUS';
  export interface AuditInput {
    action: string; outcome: AuditOutcome;
    actorType?: AuditActorType; actorUserId?: string | null; subjectUserId?: string | null;
    ip?: string | null; userAgent?: string | null; deviceId?: string | null; sessionId?: string | null;
    metadata?: Record<string, unknown>;
  }
  export const AUDIT_ACTIONS: Record<'REGISTERED'|'OTP_ISSUED'|'OTP_VERIFIED'|'OTP_FAILED'|'LOGIN'|'LOGIN_FAILED'|'PASSWORD_SET'|'PASSWORD_CHANGED'|'PASSWORD_RESET'|'TERMS_ACCEPTED'|'EMAIL_VERIFIED'|'PHONE_VERIFIED', string>;
  export async function writeAudit(tx: Tx, input: AuditInput): Promise<void>;
  ```

- [ ] **Step 1: Write the failing event tests**

`test/modules/identity/domain/events.test.ts`:

```ts
it('names every event M1 §11 and the notify catalogue expect', () => {
  expect(
    [
      identityUserRegisteredEvent,
      identityOtpRequestedEvent,
      identityEmailVerifiedEvent,
      identityPhoneVerifiedEvent,
      identityLoginFailedEvent,
      identityPasswordChangedEvent,
      identityDeviceSignedInEvent,
    ].map((e) => e.eventType),
  ).toEqual([
    'identity.user.registered',
    'identity.otp.requested',
    'identity.email.verified',
    'identity.phone.verified',
    'identity.login.failed',
    'identity.password.changed',
    'identity.device.signed_in',
  ]);
});

it('matches the event names the seeded notification mappings already carry', () => {
  // CATALOGUE.mappings is reference data T-045 shipped; a typo here is a notification that never sends.
  const mapped = new Set(CATALOGUE.mappings.map((m) => m.eventName));
  for (const e of [identityOtpRequestedEvent, identityDeviceSignedInEvent, identityPasswordChangedEvent]) {
    expect(mapped).toContain(e.eventType);
  }
});

it('carries no identifier in identity.login.failed — only its hash (S12)', () => {
  const parsed = identityLoginFailedEvent.payload.parse({
    identifierHash: 'ab12',
    identifierKind: 'EMAIL',
    ip: null,
    reason: 'wrong_password',
  });
  expect(Object.keys(parsed)).not.toContain('identifier');
});

it('allows a null userId on an OTP request, for the decoy a forgot-password probe creates', () => {
  expect(() =>
    identityOtpRequestedEvent.payload.parse({
      userId: null,
      challengeId: randomUUID(),
      purpose: 'PASSWORD_RESET',
      channels: ['SMS'],
      code: '482913',
      expiresInMinutes: 5,
    }),
  ).not.toThrow();
});
```

- [ ] **Step 2: Run and confirm failure, then add the events to `domain/events.ts` and export them from `index.ts`**

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/domain/events.test.ts`. Expected: PASS after.

Each event gets a one-paragraph comment saying who consumes it and why the payload is shaped that way. `identity.password.changed` carries a note that M1 §11 calls it `identity.credential.password_changed`, and this build uses the shorter name because T-045 already seeded a `notification_event_mappings` row for it.

- [ ] **Step 3: Write the audit integration test (do not run)**

`test/modules/identity/services/audit.int.test.ts`:

```ts
it('writes one row inside the caller transaction and rolls back with it', async () => {
  /* … */
});
it('cannot be updated or deleted afterwards (T-030 migration 0012, error KT001)', async () => {
  /* … */
});
it('accepts an unresolvable actor', async () => {
  /* actorType: 'ANONYMOUS', actorUserId: null */
});
```

- [ ] **Step 4: Implement `writeAudit`**

A single insert into `identityAuditLog`. `actorType` defaults to `'SYSTEM'`. `ip` is passed straight through — the controllers are responsible for having run it through `net.isIP` (Task 7). The file header states the S12 rule: `metadata` holds ids, hashes, counts and reasons, never an address, a code or a token.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @komtru/backend-api typecheck
git commit -m "feat(identity): declare the M1 §11 account events and the audit writer"
```

---

### Task 4: OTP challenges — domain and service

**Files:**

- Create: `src/modules/identity/domain/otp/challenge.ts`, `src/modules/identity/services/otp.service.ts`
- Test: `test/modules/identity/domain/otp/challenge.test.ts`, `test/modules/identity/services/otp.service.int.test.ts` (int — write, do not run)

**Interfaces:**

- Consumes: `HmacHasher` from `platform/crypto/hmac.js`, `randomNumericCode`/`randomToken` from `platform/crypto/random.js`, `publish`/`Tx`, `identityOtpRequestedEvent` (Task 3), `otpChallenges` from the schema.
- Produces:

  ```ts
  // domain/otp/challenge.ts
  export const OTP_CODE_DIGITS = 6;
  export const OTP_TTL_SECONDS = 300;
  export const OTP_MAX_ATTEMPTS = 5;
  export const OTP_SEND_BURST = { max: 3, windowSeconds: 600 } as const; // S4
  export const OTP_SEND_DAILY = { max: 10, windowSeconds: 86_400 } as const;
  export const PROOF_TOKEN_BYTES = 32;
  export const PROOF_TOKEN_TTL_SECONDS = 900;
  export const OTP_DESTINATION_DOMAIN = 'identity.otp.destination';
  export const OTP_CODE_DOMAIN = 'identity.otp.code';
  export type OtpPurpose =
    | 'REGISTRATION'
    | 'LOGIN'
    | 'PHONE_VERIFICATION'
    | 'EMAIL_VERIFICATION'
    | 'PASSWORD_RESET'
    | 'MFA_CHALLENGE'
    | 'SENSITIVE_ACTION'
    | 'ACCOUNT_RECOVERY';
  export const otpPurposeLabel: (purpose: OtpPurpose) => string; // 'verification' | 'sign-in' | 'password reset' | …
  export const hashDestination: (h: HmacHasher, destination: string) => Buffer;
  export const hashCode: (
    h: HmacHasher,
    i: { purpose: OtpPurpose; destinationHash: Buffer; code: string },
  ) => Buffer;
  export const matchesCode: (h: HmacHasher, i: { purpose; destinationHash; code }, stored: Buffer) => boolean;
  export const splitProofToken: (token: string) => { challengeId: string; secret: string } | null;

  // services/otp.service.ts
  export interface OtpDeps {
    hasher: HmacHasher;
    logger: Logger;
  }
  export interface IssueOtpInput {
    userId: string | null;
    purpose: OtpPurpose;
    channels: ('SMS' | 'EMAIL')[];
    destination: string;
    ip?: string | null;
    /** false writes the row and publishes nothing — the forgot-password decoy and the throttled case. */
    deliver?: boolean;
  }
  export interface IssuedOtp {
    challengeId: string;
    expiresAt: Date;
    delivered: boolean;
    throttled: boolean;
  }
  export async function issueOtp(tx: Tx, deps: OtpDeps, input: IssueOtpInput): Promise<IssuedOtp>;

  export type OtpRow = typeof otpChallenges.$inferSelect;
  export type VerifyOutcome =
    | { outcome: 'VERIFIED'; challenge: OtpRow }
    | { outcome: 'WRONG_CODE'; attemptsRemaining: number }
    | { outcome: 'NO_ATTEMPTS_LEFT' }
    | { outcome: 'EXPIRED' }
    | { outcome: 'UNKNOWN' };
  export async function consumeOtp(
    tx: Tx,
    deps: OtpDeps,
    i: { challengeId: string; code: string },
  ): Promise<VerifyOutcome>;
  export async function issueProofToken(
    tx: Tx,
    deps: OtpDeps,
    from: OtpRow,
  ): Promise<{ token: string; expiresAt: Date }>;
  export async function consumeProofToken(tx: Tx, deps: OtpDeps, token: string): Promise<VerifyOutcome>;
  ```

- [ ] **Step 1: Write the failing domain tests**

`test/modules/identity/domain/otp/challenge.test.ts`:

```ts
const h = createHmacHasher('pepper-for-tests-0123456789abcdef');

it('is six digits, zero-padded and uniformly drawn (S6)', () => {
  // randomNumericCode is platform-tested; this pins the length this module uses.
  expect(OTP_CODE_DIGITS).toBe(6);
  expect(OTP_TTL_SECONDS).toBe(300);
  expect(OTP_MAX_ATTEMPTS).toBe(5);
});

it('binds a code hash to its purpose and destination, so one row never confirms another', () => {
  const dest = hashDestination(h, '+2348012345678');
  const other = hashDestination(h, '+2348012345679');
  const a = hashCode(h, { purpose: 'REGISTRATION', destinationHash: dest, code: '482913' });
  expect(hashCode(h, { purpose: 'PASSWORD_RESET', destinationHash: dest, code: '482913' }).equals(a)).toBe(
    false,
  );
  expect(hashCode(h, { purpose: 'REGISTRATION', destinationHash: other, code: '482913' }).equals(a)).toBe(
    false,
  );
  expect(hashCode(h, { purpose: 'REGISTRATION', destinationHash: dest, code: '482913' }).equals(a)).toBe(
    true,
  );
});

it('hashes the destination under a different domain from the code', () => {
  expect(
    hashDestination(h, '482913').equals(
      hashCode(h, { purpose: 'REGISTRATION', destinationHash: Buffer.alloc(32), code: '482913' }),
    ),
  ).toBe(false);
});

it('splits a proof token into its challenge id and secret, and rejects anything else', () => {
  const id = randomUUID();
  expect(splitProofToken(`${id}.abcdef`)).toEqual({ challengeId: id, secret: 'abcdef' });
  expect(splitProofToken('no-dot')).toBeNull();
  expect(splitProofToken('not-a-uuid.secret')).toBeNull();
  expect(splitProofToken(`${id}.`)).toBeNull();
});

it('gives every purpose human copy for the SMS body', () => {
  // The template is 'Komtru: {{code}} is your {{purpose}} code.'
  expect(otpPurposeLabel('PASSWORD_RESET')).toBe('password reset');
  expect(otpPurposeLabel('REGISTRATION')).toBe('verification');
});
```

- [ ] **Step 2: Run, confirm failure, create `domain/otp/challenge.ts`, run, confirm PASS**

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/domain/otp`

`splitProofToken` validates the id with `z.uuid()` so a garbage token never reaches a `::uuid` cast.

- [ ] **Step 3: Write the service integration test (do not run)**

`test/modules/identity/services/otp.service.int.test.ts`:

```ts
it('stores only the HMAC — the code appears nowhere in the row (S6)', async () => {
  // SELECT the row, stringify it, assert it does not contain the code
});
it('invalidates every unconsumed challenge for the same purpose and destination on a new issue (S6)', async () => {
  // issue twice; the first row has consumed_at set and verifying its code answers UNKNOWN/EXPIRED
});
it('expires after five minutes', async () => {
  /* backdate expires_at; consumeOtp → EXPIRED */
});
it('counts a wrong code against the challenge and reports what is left (E3b)', async () => {
  // first wrong code → { outcome: 'WRONG_CODE', attemptsRemaining: 4 }
});
it('stops at five attempts and never unlocks itself (S4)', async () => {
  // five wrong codes, then the CORRECT code → NO_ATTEMPTS_LEFT, not VERIFIED
});
it('persists the attempt count even when the caller rolls back nothing else', async () => {
  /* … */
});
it('is single use: a verified challenge cannot be verified twice', async () => {
  /* second call → UNKNOWN */
});
it('throttles a destination at three sends in ten minutes and ten in a day (S4)', async () => {
  // the fourth issue returns { throttled: true, delivered: false } and publishes no event
});
it('publishes identity.otp.requested with the code and no destination', async () => {
  // the payload carries `code` (notify renders it) and carries no email or phone
});
it('writes the row but publishes nothing when deliver is false', async () => {
  /* the decoy path */
});
it('mints a proof token whose secret is 256 bits and single-attempt', async () => {
  // max_attempts = 1 on the minted row; a wrong secret → NO_ATTEMPTS_LEFT on the next try
});
it('rejects a proof token whose challenge id is real but whose secret is not', async () => {
  /* … */
});
```

- [ ] **Step 4: Implement `services/otp.service.ts`**

`issueOtp`:

1. `destinationHash = hashDestination(...)`.
2. Count unexpired sends for this destination hash in each S4 window from `otp_challenges.created_at`; if either budget is spent, set `deliver = false` and `throttled = true`.
3. `UPDATE identity.otp_challenges SET consumed_at = now() WHERE destination_hash = $1 AND purpose = $2 AND consumed_at IS NULL` — S6's "invalidated on new issuance".
4. Insert the new row with `randomNumericCode(OTP_CODE_DIGITS)`, `max_attempts = OTP_MAX_ATTEMPTS`, `expires_at = now + OTP_TTL_SECONDS`, `created_ip = input.ip`.
5. When delivering, `publish(tx, identityOtpRequestedEvent, { payload: { …, code, channels }, aggregateType: 'identity.otp', aggregateId: challengeId })`.

The budget count must run **before** step 3, or the invalidation hides the evidence. The whole function runs inside the caller's transaction, so the count and the insert are consistent; two concurrent issues for one destination can both pass the count, which over-admits by one and is the safe direction (the alternative locks a row that may not exist).

`consumeOtp`: `SELECT … FOR UPDATE` by id; `UNKNOWN` when missing or already consumed; `EXPIRED` past `expires_at`; `NO_ATTEMPTS_LEFT` when `attempts >= max_attempts`; otherwise `UPDATE … SET attempts = attempts + 1` **first**, then `matchesCode` (constant-time, via `HmacHasher.matches`); on a match also set `consumed_at`.

`issueProofToken`: a new row copying `user_id`, `purpose` and `destination_hash` from `from`, `max_attempts = 1`, `expires_at = now + PROOF_TOKEN_TTL_SECONDS`, `code_hash = hashCode(h, { purpose, destinationHash, code: secret })` where `secret = randomToken(PROOF_TOKEN_BYTES)`; returns `` `${id}.${secret}` ``. The file header explains why: a reset token is a single-use short-lived secret bound to a destination, which is exactly an OTP challenge with 256 bits instead of twenty, so it needs no second table and inherits the attempt cap, the expiry and the single-use consume that are already tested here.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm --filter @komtru/backend-api typecheck && pnpm --filter @komtru/backend-api lint
git commit -m "feat(identity): issue, throttle and verify OTP challenges"
```

---

### Task 5: Contact channels — attach, verify and the status transitions

**Files:**

- Create: `src/modules/identity/services/contact.service.ts`
- Test: `test/modules/identity/services/contact.service.int.test.ts` (int — write, do not run)

**Interfaces:**

- Consumes: `normaliseEmail`, `normalisePhone`, `maskEmail`, `maskPhone`, `phoneReverifyAfter` from `platform/identifiers.js`; `userEmails`, `userPhones`, `users` from the schema; the events from Task 3.
- Produces:

  ```ts
  export class ContactTakenError extends Error { constructor(readonly channel: 'EMAIL' | 'PHONE') }
  export interface AttachedEmail { emailId: string; email: string; emailNormal: string }
  export interface AttachedPhone { phoneId: string; phoneE164: string }
  export async function attachEmail(tx: Tx, i: { userId: string; email: string; makePrimary?: boolean }): Promise<AttachedEmail>;
  export async function attachPhone(tx: Tx, i: { userId: string; phone: string; makePrimary?: boolean }): Promise<AttachedPhone>;
  export async function findUserByVerifiedEmail(tx: Tx, emailNormal: string): Promise<{ userId: string; emailId: string } | null>;
  export async function findUserByVerifiedPhone(tx: Tx, phoneE164: string): Promise<{ userId: string; phoneId: string } | null>;
  /** The primary contact of each channel, verified or not, for addressing an OTP. */
  export async function primaryContacts(tx: Tx, userId: string): Promise<{
    email: { id: string; address: string; verified: boolean } | null;
    phone: { id: string; address: string; verified: boolean } | null;
  }>;
  export async function markEmailVerified(tx: Tx, i: { userId: string; emailId: string; source: string }): Promise<void>;
  export async function markPhoneVerified(tx: Tx, i: { userId: string; phoneId: string }): Promise<void>;
  /** M1 §2 and §9.1: first verified channel → ACTIVE, both → CONTACT_VERIFIED. Publishes both events. */
  export async function applyVerificationProgress(tx: Tx, userId: string): Promise<{ status: string; verificationLevel: string }>;
  ```

- [ ] **Step 1: Write the integration tests (do not run)**

`test/modules/identity/services/contact.service.int.test.ts`:

```ts
it('writes email and email_normal from one normaliseEmail call (T-030 rule)', async () => {
  const { emailId } = await attachEmail(tx, { userId, email: 'J.ane+promo@GoogleMail.com' });
  // row.email === 'j.ane+promo@googlemail.com' and row.email_normal === 'jane@gmail.com'
});
it('stores a phone in E.164 and nothing else', async () => {
  /* '0802 341 5567' → '+2348023415567' */
});
it('rejects a phone normalisePhone cannot parse before it reaches the CHECK', async () => {
  /* … */
});
it('makes the first contact of a channel primary and points users.primary_email_id at it', async () => {
  /* … */
});
it('leaves users.primary_email_id pointing at the row flagged is_primary', async () => {
  // T-030 deferred this to T-032: the pointer and the flag must name the same row
});
it('finds a user only by a VERIFIED contact', async () => {
  // an unverified row is invisible to findUserByVerifiedEmail
});

it('turns a lost race for a verified address into a 409, not a 500', async () => {
  // two transactions verify the same email_normal; the loser gets ContactTakenError, not a 23505
});

it('moves PENDING_VERIFICATION to ACTIVE on the FIRST verified channel (M1 §9.1)', async () => {
  // verification_level stays UNVERIFIED
});
it('raises verification_level to CONTACT_VERIFIED only when BOTH channels are verified (M1 §2)', async () => {
  /* … */
});
it('publishes identity.user.status_changed and identity.user.verification_level_changed once each', async () => {
  // a second call with nothing to change publishes nothing
});
it('never downgrades a user already past CONTACT_VERIFIED', async () => {
  // M1 §2: M6 owns levels 2–4 and M1 never computes them
});
it('sets reverify_after a year out on a verified phone (D4, SIM recycling)', async () => {
  /* … */
});
```

- [ ] **Step 2: Implement `contact.service.ts`**

`attachEmail` calls `normaliseEmail` once and writes both columns from that one result. `attachPhone` calls `normalisePhone`; a `null` result throws a `ContactTakenError`-sibling validation error the controller turns into a 422. `countryCode` is `NOT NULL` in the schema while `normalisePhone` returns it optionally — fall back to `DEFAULT_COUNTRY` (`'NG'`) and note in a comment that a non-geographic E.164 number cannot receive an SMS OTP anyway, which is T-030's deferred item.

`markEmailVerified` / `markPhoneVerified` set `verified_at`, `verification_source` / `reverify_after`, and catch Postgres `23505` on `user_emails_verified_unique` / `user_phones_verified_unique`, rethrowing `ContactTakenError`. `applyVerificationProgress` reads both channels, writes `status` and `verification_level` in one `UPDATE … WHERE id = $1 AND status = 'PENDING_VERIFICATION'` style guard so a concurrent call publishes only once, and publishes only for the transitions it actually made.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
git commit -m "feat(identity): attach and verify contact channels with their status transitions"
```

---

### Task 6: Credentials — set, verify, lockout and transparent rehash

**Files:**

- Create: `src/modules/identity/services/credential.service.ts`
- Test: `test/modules/identity/services/credential.service.int.test.ts` (int — write, do not run)

**Interfaces:**

- Consumes: Task 1's `PasswordHasher`, `BreachDeps`, `checkPasswordPolicy`, `lockedUntil`; `userCredentials` from the schema.
- Produces:

  ```ts
  export const PASSWORD_HISTORY = 5;
  export interface CredentialDeps {
    hasher: PasswordHasher;
    breach: BreachDeps;
    logger: Logger;
  }
  export type SetPasswordResult = { ok: true } | { ok: false; rejection: PasswordRejection; message: string };
  export async function setPassword(
    tx: Tx,
    deps: CredentialDeps,
    i: { userId: string; password: string; identifiers?: readonly string[] },
  ): Promise<SetPasswordResult>;
  export async function hasCredential(tx: Tx, userId: string): Promise<boolean>;
  export type PasswordVerdict =
    | { outcome: 'OK'; rehashed: boolean }
    | { outcome: 'WRONG'; failedAttempts: number; lockedUntil: Date | null }
    | { outcome: 'LOCKED'; until: Date }
    | { outcome: 'NO_CREDENTIAL' };
  /** Always performs exactly one password verification, whatever the answer (§S3). */
  export async function verifyAndRecord(
    tx: Tx,
    deps: CredentialDeps,
    i: { userId: string | null; password: string },
  ): Promise<PasswordVerdict>;
  ```

- [ ] **Step 1: Write the integration tests (do not run)**

```ts
it('refuses a password below ten characters without hashing it', async () => {
  /* rejection TOO_SHORT */
});
it('refuses a breached password when the flag is on, and records breached_at on no one', async () => {
  /* … */
});
it('accepts a breached password when the corpus is unreachable, falling back to the offline list', async () => {
  // checkUnavailable: true → the policy's COMMON list is the only gate
});
it('keeps the last five hashes and refuses a reuse', async () => {
  // six distinct passwords; the first is re-usable again, the fifth is not
});
it('verifies a correct password and leaves failed_attempts at zero', async () => {
  /* … */
});
it('counts a wrong password and locks for fifteen minutes at the tenth (S5)', async () => {
  /* … */
});
it('answers LOCKED while locked_until is in the future, and clears it afterwards', async () => {
  /* … */
});
it('never sets users.status to LOCKED — that is the risk lock, not the throttle (M1 §9.1)', async () => {
  /* … */
});
it('answers NO_CREDENTIAL for a social-only user AFTER doing the same hashing work (S3)', async () => {
  // a counting hasher proves verify (or decoy) ran exactly once
});
it('performs exactly one verification for a userId of null (S3)', async () => {
  /* … */
});
it('rehashes transparently when the stored parameters are below the baseline (S1)', async () => {
  // seed a m=4096 hash, verify the right password, assert the stored hash now matches the baseline
  // and that the OLD hash did not land in previous_hashes (it is the same password)
});
```

- [ ] **Step 2: Implement `credential.service.ts`**

`verifyAndRecord` is the §S3 engine: one query for the credential row (none for a null `userId`), then **exactly one** call to `deps.hasher.verify` or `deps.hasher.decoy` on every path including `NO_CREDENTIAL` and `LOCKED`. Do the decoy _before_ returning, never after a short-circuit. Lockout accounting (`failed_attempts`, `locked_until` from `lockedUntil`) is one `UPDATE`.

`setPassword` runs the policy, then the breach check, then compares against `previous_hashes` with `hasher.verify` (one call per stored hash, bounded by `PASSWORD_HISTORY`), then upserts with `previous_hashes` trimmed to the newest `PASSWORD_HISTORY` entries and `password_set_at = now()`, `failed_attempts = 0`, `locked_until = NULL`.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
git commit -m "feat(identity): set and verify passwords with lockout and transparent rehash"
```

---

### Task 7: Registration, OTP verification and terms acceptance

**Files:**

- Create: `src/modules/identity/domain/registration.ts`, `src/modules/identity/services/device.service.ts`, `src/modules/identity/services/auth.service.ts`, `src/modules/identity/http/validations/registration.validation.ts`, `src/modules/identity/http/controllers/registration.controller.ts`, `src/modules/identity/http/routes/registration.routes.ts`
- Create: `src/modules/identity/http/controllers/request.ts` — `callerIp` / `callerAgent`, moved out of `auth.controller.ts` so both controllers share one copy
- Modify: `src/modules/identity/http/controllers/auth.controller.ts` (import the moved helpers)
- Test: `test/modules/identity/domain/registration.test.ts`, `test/modules/identity/http/registration.routes.test.ts` (unit, route declarations), `test/modules/identity/http/registration.routes.int.test.ts` (int — write, do not run)

**Interfaces:**

- Consumes: Tasks 3–6, `createSession` and `IssuedSession` from `services/session.service.js`, `generatePublicId`/`classifyIdentifier` from `platform/identifiers.js`, `termsUpToDate` from `domain/terms.js`.
- Produces:

  ```ts
  // domain/registration.ts
  export type NextStep =
    | 'VERIFY_EMAIL'
    | 'VERIFY_PHONE'
    | 'SET_PASSWORD'
    | 'ACCEPT_TERMS'
    | 'CHOOSE_USERNAME'
    | 'ADD_EMAIL'
    | 'ADD_PHONE'
    | 'DONE';
  export interface OnboardingState {
    emailVerified: boolean;
    phoneVerified: boolean;
    hasEmail: boolean;
    hasPhone: boolean;
    hasPassword: boolean;
    hasUsername: boolean;
    termsUpToDate: boolean;
  }
  export const nextStep: (state: OnboardingState) => NextStep;

  // services/device.service.ts
  export async function upsertDevice(
    tx: Tx,
    i: { userId: string; fingerprint?: string | null; platform?: string | null; ip?: string | null },
  ): Promise<{ deviceId: string | null; isNewDevice: boolean }>;

  // services/auth.service.ts
  export interface AuthDeps extends SessionDeps, CredentialDeps, OtpDeps {
    terms: { version: string; privacyVersion: string };
    mirrorPhoneOtpToEmail: boolean;
  }
  export interface RegisterInput {
    channel: 'EMAIL' | 'PHONE';
    email?: string;
    phone?: string;
    password?: string;
    fullName?: string;
    acceptedTermsVersion: string;
    acceptedPrivacyVersion?: string;
    marketingOptIn: boolean;
    deviceFingerprint?: string;
    ip: string | null;
    userAgent: string | null;
  }
  export type RegisterResult =
    | {
        outcome: 'REGISTERED';
        userId: string;
        publicId: string;
        status: string;
        challengeId: string;
        expiresAt: Date;
        nextStep: NextStep;
        maskedDestination: string;
      }
    | { outcome: 'TAKEN' }
    | { outcome: 'REJECTED'; rejection: PasswordRejection; message: string }
    | { outcome: 'STALE_TERMS' };
  export async function register(db: Db, deps: AuthDeps, input: RegisterInput): Promise<RegisterResult>;

  export type ChallengeResult =
    | { outcome: 'SESSION'; session: IssuedSession; nextStep: NextStep; user: PublicUser }
    | { outcome: 'RESET_TOKEN'; resetToken: string; expiresAt: Date }
    | { outcome: 'TAKEN' }
    | Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;
  export async function verifyChallenge(
    db: Db,
    deps: AuthDeps,
    i: {
      challengeId: string;
      code: string;
      deviceFingerprint?: string;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<ChallengeResult>;

  export async function resendOtp(
    db: Db,
    deps: AuthDeps,
    i: { challengeId: string; ip: string | null },
  ): Promise<
    | { outcome: 'ISSUED'; challengeId: string; expiresAt: Date }
    | { outcome: 'THROTTLED' }
    | { outcome: 'UNKNOWN' }
  >;

  export interface PublicUser {
    id: string;
    publicId: string;
    username: string | null;
    displayName: string | null;
    status: string;
    verificationLevel: string;
  }
  export async function acceptTerms(
    db: Db,
    deps: AuthDeps,
    i: { userId: string; termsVersion: string; privacyVersion: string; ip: string | null },
  ): Promise<{ ok: boolean }>;
  export async function termsStateFor(db: Db, deps: AuthDeps, userId: string): Promise<TermsState>;

  // http/controllers/request.ts
  export const callerIp: (req: Request) => string | null; // net.isIP guarded
  export const callerAgent: (req: Request) => string | null;
  ```

- [ ] **Step 1: Write the failing `nextStep` tests**

`test/modules/identity/domain/registration.test.ts`:

```ts
const base: OnboardingState = {
  emailVerified: false,
  phoneVerified: false,
  hasEmail: false,
  hasPhone: true,
  hasPassword: false,
  hasUsername: false,
  termsUpToDate: true,
};

it.each([
  [{ ...base }, 'VERIFY_PHONE'],
  [{ ...base, hasPhone: false, hasEmail: true }, 'VERIFY_EMAIL'],
  // M1 §9.3: the phone path sets a password after the channel is proven
  [{ ...base, phoneVerified: true }, 'SET_PASSWORD'],
  [{ ...base, phoneVerified: true, hasPassword: true }, 'CHOOSE_USERNAME'],
  [{ ...base, phoneVerified: true, hasPassword: true, hasUsername: true }, 'ADD_EMAIL'],
  [
    { ...base, hasEmail: true, emailVerified: true, hasPassword: true, hasUsername: true, hasPhone: false },
    'ADD_PHONE',
  ],
  [
    {
      ...base,
      hasEmail: true,
      emailVerified: true,
      phoneVerified: true,
      hasPassword: true,
      hasUsername: true,
    },
    'DONE',
  ],
])('nextStep(%o) is %s', (state, expected) => expect(nextStep(state)).toBe(expected));

it('puts stale terms ahead of everything, because TOS2 blocks the app', () => {
  expect(nextStep({ ...base, termsUpToDate: false })).toBe('ACCEPT_TERMS');
});
```

- [ ] **Step 2: Run, confirm failure, implement `domain/registration.ts`, run, confirm PASS**

Order: `ACCEPT_TERMS` → `VERIFY_PHONE`/`VERIFY_EMAIL` → `SET_PASSWORD` → `CHOOSE_USERNAME` → `ADD_EMAIL`/`ADD_PHONE` → `DONE`, exactly as §9.3 draws it.

- [ ] **Step 3: Write the route-declaration unit tests**

`test/modules/identity/http/registration.routes.test.ts` (runs without infra — build the routes with stub deps and inspect the declarations):

```ts
it('declares every rate limit S4 names', () => {
  const byPath = Object.fromEntries(registrationRoutes(stubDeps).map((r) => [r.path, r]));
  expect(byPath['/auth/register'].rateLimit).toMatchObject({ by: ['ip', 'identifier', 'device'] });
  expect(byPath['/auth/verify-otp'].rateLimit?.by).toContain('ip');
});
it('passes assertRouteInvariants', () => {
  expect(() => assertRouteInvariants(registrationRoutes(stubDeps))).not.toThrow();
});
it('keys /auth/register on the email or phone the body carries, never on a raw identifier', () => {
  const spec = registrationRoutes(stubDeps).find((r) => r.path === '/auth/register')!.rateLimit!;
  // the subject is a hex digest, so the limiter key in Redis is not an email address
  expect(
    spec.identifierFrom!({ body: { channel: 'EMAIL', email: 'jane@example.com' }, query: {}, params: {} }),
  ).toMatch(/^[0-9a-f]{64}$/);
});
it('declares /auth/register and /auth/verify-otp non-retryable, with the reason in a comment', () => {
  // both carry a one-time secret in the response; see the T-031 precedent on /auth/refresh
});
it('serves the terms routes to a CONSUMER session only', () => {
  expect(byPath['/me/terms'].scope).toBe('CONSUMER');
});
```

- [ ] **Step 4: Run, confirm failure**

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/http/registration.routes.test.ts`

- [ ] **Step 5: Write the HTTP integration tests (do not run)**

`test/modules/identity/http/registration.routes.int.test.ts`:

```ts
it('registers phone-first with no password and answers 201 with a challenge (E2)', async () => {
  /* … */
});
it('requires a password on the email path', async () => {
  /* 422 */
});
it('refuses an acceptedTermsVersion that is not the current one (TOS1)', async () => {
  /* 409 */
});
it('records terms_version, privacy_version, consent_recorded_at and consent_ip (NDPA §15)', async () => {
  /* … */
});
it('drops an unparseable X-Forwarded-For rather than handing it to an inet column', async () => {
  // TRUST_PROXY_HOPS set, header "'; DROP TABLE users; --" → 201, registration_ip IS NULL, no 500
});
it('answers 409 when the email is already VERIFIED on another account', async () => {
  /* … */
});
it('allows a second account to hold the same UNVERIFIED address, as the partial index does', async () => {
  /* … */
});
it('writes the OTP code nowhere in the response', async () => {
  /* … */
});
it('verifies the OTP, turns the user ACTIVE and returns a CONSUMER session (E3)', async () => {
  /* … */
});
it('returns the wrong-code state with the attempts left (E3b)', async () => {
  // 422 { code: 'OTP_INVALID', attemptsRemaining: 4 }
});
it('answers the same way for a sixth attempt as for an expired challenge', async () => {
  /* … */
});
it('resends by issuing a NEW challenge and killing the old one', async () => {
  /* … */
});
it('answers 429 on the fourth resend within ten minutes (S4)', async () => {
  /* … */
});
it('writes an identity_audit_log row before it returns success (S10)', async () => {
  /* … */
});
it('publishes identity.user.registered, identity.otp.requested and identity.phone.verified in order', async () => {
  /* … */
});
it('tells an existing user their terms are stale and accepts the new ones (TOS2)', async () => {
  // GET /me/terms → upToDate false; POST /me/terms/accept with the current versions → upToDate true
});
it('refuses to accept a terms version that is not the current one', async () => {
  /* 409 */
});
```

- [ ] **Step 6: Implement**

`http/controllers/request.ts` first: move `callerIp` (the `net.isIP` guard) and `callerAgent` out of `auth.controller.ts` verbatim, keeping the comment, and have `auth.controller.ts` import them. That is Review Focus item 5 — every new `inet` write goes through the same guard.

`services/auth.service.ts`:

- `register` opens one transaction: resolve `normaliseEmail`/`normalisePhone`, check the **verified** owner (`findUserByVerified*`) → `TAKEN`; check `acceptedTermsVersion === deps.terms.version` → `STALE_TERMS`; insert `users` with `generatePublicId()` (retry once on a 23505 against `users_public_id_key`), `registered_via`, `registration_ip`, `terms_version`, `privacy_version`, `consent_recorded_at`, `consent_ip`, `marketing_opt_in`; insert `user_profiles` from `fullName` (first token → `first_name`, the rest → `last_name`, the whole string → `display_name`); `attachEmail`/`attachPhone` with `makePrimary: true`; `setPassword` when one was given (a rejection rolls the whole transaction back and answers `REJECTED`); `issueOtp` for the channel; `writeAudit`; `publish(identityUserRegisteredEvent)`.
- `verifyChallenge`: one transaction that **commits on every outcome**, because a wrong code must still spend its attempt. `consumeOtp` first; a non-`VERIFIED` outcome returns immediately and the transaction commits the increment. On `VERIFIED`, branch on `challenge.purpose`: `PASSWORD_RESET` → `issueProofToken`; anything else → `markEmailVerified`/`markPhoneVerified` (a `ContactTakenError` returns `TAKEN`), `applyVerificationProgress`, `upsertDevice`, `createSession(tx, deps, { userId, scope: 'CONSUMER', amr: ['otp'], deviceId, ip, userAgent, isNewDevice })`, `publish(identityDeviceSignedInEvent)` when `isNewDevice`, `writeAudit`.
- `resendOtp`: load the challenge by id, re-issue for the same purpose and destination. The destination is not recoverable from `destination_hash`, so it is re-read from the user's primary contact for that channel (`primaryContacts`); a challenge with a null `userId` (the forgot-password decoy) answers `UNKNOWN`, which is the same shape as a real throttle to the caller.

`registration.routes.ts` — `registrationRoutes(deps)`:

| route                   | scope    | retryable | rate limit                                                                               |
| ----------------------- | -------- | --------- | ---------------------------------------------------------------------------------------- |
| `POST /auth/register`   | PUBLIC   | false     | 20/min ip, 5/min identifier (sha256 hex of the normalised email or phone), 10/min device |
| `POST /auth/otp/resend` | PUBLIC   | false     | 30/min ip, 5/10min identifier (`challengeId`), 10/min device                             |
| `POST /auth/verify-otp` | PUBLIC   | false     | 60/min ip, 10/min identifier (`challengeId`), 20/min device                              |
| `GET /me/terms`         | CONSUMER | —         | —                                                                                        |
| `POST /me/terms/accept` | CONSUMER | false     | 10/min user                                                                              |

`identifierFrom` returns a **sha256 hex digest** of the normalised identifier, never the address: the subject becomes a Redis key and a log field, and S12 is absolute. Every body schema carries an optional `deviceFingerprint` so `deviceFrom` has something to read.

Controller mapping: `TAKEN` → 409 `CONFLICT`; `REJECTED` → 422 `VALIDATION_FAILED` with a `fieldErrors` entry on `password`; `STALE_TERMS` → 409 `CONFLICT`; `WRONG_CODE` → 422 `OTP_INVALID` with `extensions: { attemptsRemaining }`; `NO_ATTEMPTS_LEFT` / `EXPIRED` / `UNKNOWN` → 422 `OTP_INVALID` with no `attemptsRemaining` (E3b's "ask for a fresh code").

- [ ] **Step 7: Run the unit tests and confirm they pass**

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/identity`

- [ ] **Step 8: Typecheck, lint, commit**

```bash
git commit -m "feat(identity): add registration, OTP verification and terms acceptance"
```

---

### Task 8: Password login with a uniform failure

**Files:**

- Create: `src/modules/identity/services/login.service.ts`
- Test: `test/modules/identity/services/login.service.int.test.ts`, `test/modules/identity/http/login.enumeration.int.test.ts` (both int — write, do not run)

**Interfaces:**

- Consumes: Task 6's `verifyAndRecord`, Task 5's `findUserByVerified*`, Task 7's `upsertDevice` and `nextStep`, `createSession`.
- Produces:

  ```ts
  export type LoginResult =
    | { outcome: 'SESSION'; session: IssuedSession; user: PublicUser; nextStep: NextStep }
    | { outcome: 'REJECTED' }; // the ONLY failure this function has (§S3)
  export async function login(
    db: Db,
    deps: AuthDeps,
    i: {
      identifier: string;
      password: string;
      deviceFingerprint?: string;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<LoginResult>;
  /** One query whatever the identifier is, so the hit and the miss cost the same round trips. */
  export async function resolveLoginCandidate(
    tx: Tx,
    identifier: string,
  ): Promise<{ userId: string; status: string } | null>;
  ```

- [ ] **Step 1: Write the integration tests (do not run)**

`login.service.int.test.ts`:

```ts
it('signs in by verified email, by verified phone and by username (E4, M1 §10.1)', async () => {
  /* … */
});
it('ignores an UNVERIFIED contact: an unproven address is not globally unique', async () => {
  /* REJECTED */
});
it('classifies @janedoe as a username, not an email', async () => {
  /* … */
});
it('classifies (0801) 234-5678 as a phone', async () => {
  /* … */
});

it.each([
  'no such user',
  'wrong password',
  'social-only account',
  'throttled by locked_until',
  'SUSPENDED',
  'LOCKED',
  'CLOSED',
])('answers REJECTED and nothing else for: %s (S3)', async () => {
  /* … */
});

it('lets PENDING_VERIFICATION and RESTRICTED sign in (M1 §9.1 table)', async () => {
  /* … */
});
it('opens a CONSUMER session with amr ["pwd"]', async () => {
  /* … */
});
it('rehashes a weak stored hash on a successful sign-in (S1)', async () => {
  /* … */
});
it('clears failed_attempts on success', async () => {
  /* … */
});
it('publishes identity.login.failed with a HASH of the identifier and no identifier', async () => {
  /* … */
});
it('publishes identity.device.signed_in only for a fingerprint it has not seen', async () => {
  /* … */
});
it('writes an identity_audit_log row for the failure as well as the success (S10)', async () => {
  /* … */
});
it('performs exactly one password verification per attempt, hit or miss (S3)', async () => {
  // a counting PasswordHasher injected through deps
});
```

`login.enumeration.int.test.ts` — M1 §17's enumeration suite:

```ts
it('takes the same time for an existing and a nonexistent user: < 5ms over 1,000 samples', async () => {
  // deps.hasher is a CHEAP constant-cost hasher, injected. The argon2 cost is identical on both
  // paths by construction (Task 6 proves exactly one verification); what this measures is the
  // DATABASE work, which is where a real difference would hide — an extra credential lookup on the
  // hit path and none on the miss path is exactly the leak §S3 is about.
  expect(Math.abs(medianMs(hitSamples) - medianMs(missSamples))).toBeLessThan(5);
});
it('rate limits independently per identifier, per IP and per device (M1 §17)', async () => {
  // 5 attempts on one identifier from five different IPs → the sixth is 429
  // 20 attempts on twenty identifiers from one IP → the twenty-first is 429
  // 10 attempts with one fingerprint from ten IPs and ten identifiers → the eleventh is 429
});
```

- [ ] **Step 2: Implement `login.service.ts`**

`resolveLoginCandidate` runs **one** statement for every identifier kind — a `SELECT u.id, u.status FROM identity.users u LEFT JOIN identity.user_emails … LEFT JOIN identity.user_phones …` with the kind chosen by `classifyIdentifier` deciding which branch of the `WHERE` is live. Joins to the contact tables are filtered on `verified_at IS NOT NULL`.

`login` then: `verifyAndRecord(tx, deps, { userId: candidate?.userId ?? null, password })` — called with `null` on a miss so the decoy runs; map `OK` plus a usable `status` to `SESSION` and everything else to `REJECTED`; on `REJECTED` publish `identityLoginFailedEvent` with `sha256(identifier).toString('hex')` and write an audit row. A status outside `USABLE_STATUSES` (T-031's `sessionUsableUnder`) is `REJECTED` too, **after** the password work, never before.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
git commit -m "feat(identity): add password login with a uniform failure response"
```

---

### Task 9: Forgot, reset and change password

**Files:**

- Create: `src/modules/identity/services/password.service.ts`, `src/modules/identity/http/validations/password.validation.ts`, `src/modules/identity/http/controllers/password.controller.ts`, `src/modules/identity/http/routes/password.routes.ts`
- Test: `test/modules/identity/http/password.routes.test.ts` (unit), `test/modules/identity/http/password.routes.int.test.ts` (int — write, do not run)

**Interfaces:**

- Consumes: Task 4's `issueOtp` / `consumeProofToken`, Task 6's `setPassword` / `verifyAndRecord` / `hasCredential`, Task 8's `login`, T-031's `revokeAllSessions` and `bumpSessionsEpoch`.
- Produces:

  ```ts
  /** Always the same shape, found or not (M1 §17). A miss writes a real challenge with user_id NULL. */
  export async function startPasswordReset(
    db: Db,
    deps: AuthDeps,
    i: {
      identifier: string;
      ip: string | null;
    },
  ): Promise<{ challengeId: string; expiresAt: Date; maskedDestination: string | null }>;

  export type ResetResult =
    | { outcome: 'RESET'; revokedSessions: number }
    | { outcome: 'REJECTED'; rejection: PasswordRejection; message: string }
    | Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;
  export async function completePasswordReset(
    db: Db,
    deps: AuthDeps,
    i: {
      resetToken: string;
      newPassword: string;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<ResetResult>;

  export type ChangeResult =
    | { outcome: 'CHANGED'; revokedSessions: number }
    | { outcome: 'WRONG_PASSWORD' }
    | { outcome: 'CURRENT_REQUIRED' }
    | { outcome: 'REJECTED'; rejection: PasswordRejection; message: string };
  export async function changePassword(
    db: Db,
    deps: AuthDeps,
    i: {
      userId: string;
      sessionId: string;
      currentPassword?: string;
      newPassword: string;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<ChangeResult>;
  ```

- [ ] **Step 1: Write the route-declaration unit tests**

```ts
it('limits /auth/password/forgot to three an hour per identifier (S4)', () => {
  expect(byPath['/auth/password/forgot'].rateLimit).toMatchObject({ points: 3, durationSeconds: 3600 });
});
it('limits /auth/login to five a minute per identifier and twenty a minute per IP (S4)', () => {
  // two specs cannot share one window, so the route declares 5/60s with by: ['identifier'] and a
  // second, looser ip budget; the test pins the numbers S4 names
});
it('serves /auth/password/change to a CONSUMER session and the other two to PUBLIC', () => {
  /* … */
});
it('passes assertRouteInvariants', () => {
  /* … */
});
```

- [ ] **Step 2: Write the HTTP integration tests (do not run)**

```ts
it('answers 202 with an identical body for a known and an unknown identifier (M1 §17)', async () => {
  // deep-equal the two bodies with challengeId and expiresAt redacted, and assert both carry a
  // syntactically real challengeId
});
it('writes a real challenge row with user_id NULL for an unknown identifier', async () => {
  // so that verifying against it is indistinguishable from verifying against a real one
});
it('sends nothing for the unknown identifier', async () => {
  /* no identity.otp.requested in the outbox */
});
it('masks only what the caller typed, never what the account holds', async () => {
  // identifier 'janedoe' (a username) → maskedDestination is null, not the account's phone
});
it('resets the password, revokes EVERY session and bumps the epoch (AC3)', async () => {
  // a refresh token issued before the reset answers 401 afterwards
});
it('refuses a reset token after its single attempt is spent', async () => {
  /* … */
});
it('refuses a reset token after fifteen minutes', async () => {
  /* … */
});
it('refuses a reset token whose challenge id is real but whose secret is not', async () => {
  /* … */
});
it('changes a password and keeps the calling session alive while killing the others (M1 §17)', async () => {
  // the caller's own access token still resolves; a sibling session's refresh token is revoked
});
it('requires currentPassword when the user has one', async () => {
  /* 401 INVALID_CREDENTIALS */
});
it('allows a first password with no currentPassword for a phone-path user (M1 §9.3)', async () => {
  // user_credentials has no row; the session's own existence (amr ['otp']) is the proof
});
it('refuses to reuse one of the last five passwords', async () => {
  /* 422 */
});
it('publishes identity.password.changed with viaRecovery true on reset and false on change', async () => {
  /* … */
});
it('writes an identity_audit_log row before returning success on all three routes (S10)', async () => {
  /* … */
});
```

- [ ] **Step 3: Implement**

`startPasswordReset`: `classifyIdentifier`; resolve a user through the **verified** contact or the username; when found, choose the channel the identifier names (a username falls back to the primary verified phone, then email) and `issueOtp({ purpose: 'PASSWORD_RESET', deliver: true })`; when not found, `issueOtp({ userId: null, purpose: 'PASSWORD_RESET', destination: <what the caller typed>, deliver: false })`. Both return the same shape. `maskedDestination` is `maskEmail`/`maskPhone` of **what the caller typed** and `null` for a username — masking what the account holds would turn a username into a phone-number oracle.

`completePasswordReset`: one transaction — `consumeProofToken`, `setPassword`, `bumpSessionsEpoch`, `revokeAllSessions` (no `exceptSessionId`: a recovery means every device signs in again), `writeAudit`, `publish(identityPasswordChangedEvent, { viaRecovery: true })`. After the commit, `deps.epochs.invalidate(userId)`.

`changePassword`: `hasCredential` decides whether `currentPassword` is required (`CURRENT_REQUIRED` when it is missing and one exists); `verifyAndRecord` proves it; `setPassword`; `revokeAllSessions(tx, { userId, reason: 'password_changed', exceptSessionId: sessionId })` — M1 §9.2 keeps the caller signed in; **no** epoch bump, because that would kill the caller's own access token too, and the sibling sessions are already revoked by row.

Routes — `passwordRoutes(deps)`:

| route                        | scope    | retryable | rate limit                                                                      |
| ---------------------------- | -------- | --------- | ------------------------------------------------------------------------------- |
| `POST /auth/login`           | PUBLIC   | false     | 5/min identifier (sha256 hex), 20/min ip, 10/min device                         |
| `POST /auth/password/forgot` | PUBLIC   | false     | 3/hour identifier (sha256 hex), 20/hour ip, 10/hour device                      |
| `POST /auth/password/reset`  | PUBLIC   | false     | 10/min ip, 5/min identifier (the challenge id half of the token), 10/min device |
| `POST /auth/password/change` | CONSUMER | false     | 5/min user, 20/min ip                                                           |

`/auth/login` is `retryable: false` for T-031's reason on `/auth/refresh`: the response carries a refresh token, and the idempotency gate stores a completed response as plaintext jsonb for 24 hours. The comment says so.

- [ ] **Step 4: Run the unit tests, typecheck, lint, commit**

```bash
pnpm --filter @komtru/backend-api exec vitest run test/modules/identity
git commit -m "feat(identity): add forgot, reset and change password"
```

---

### Task 10: Notify — channel targeting, unverified destinations and the identity bindings

**Files:**

- Modify: `src/modules/notify/domain/binding.ts`, `src/modules/notify/services/recipients.service.ts`, `src/modules/notify/services/dispatch.service.ts`, `src/modules/notify/jobs/send.job.ts`
- Test: `test/modules/notify/domain/binding.test.ts` (unit, new), `test/modules/notify/services/dispatch.int.test.ts` and `test/modules/notify/jobs/send.int.test.ts` (int — extend, do not run)

**Interfaces:**

- Consumes: Task 3's identity events, `otpPurposeLabel` from identity's barrel.
- Produces:

  ```ts
  export interface NotificationRecipient {
    userId: string;
    variables: Record<string, string>;
    /** Restrict the fan-out to these channels. Absent means every channel the template declares. */
    channels?: NotificationChannel[];
  }
  /** Template keys whose job is to PROVE control of an address, so it cannot already be proven. */
  export const UNVERIFIED_DESTINATION_TEMPLATES: ReadonlySet<string>;
  export const allowsUnverifiedDestination: (templateKey: string) => boolean;
  export const BINDINGS: NotificationBinding[]; // four entries

  // recipients.service.ts
  export async function resolveDestination(
    reader: Reader,
    userId: string,
    channel: NotificationChannel,
    options?: { allowUnverified?: boolean },
  ): Promise<Destination | undefined>;
  ```

- [ ] **Step 1: Write the failing binding tests**

`test/modules/notify/domain/binding.test.ts`:

```ts
it('binds the four identity events the catalogue already has templates for', () => {
  expect(BINDINGS.map((b) => b.event.eventType).sort()).toEqual([
    'identity.device.signed_in', 'identity.otp.requested',
    'identity.password.changed', 'identity.session.reuse_detected',
  ]);
});

it('supplies exactly the variables each bound template declares', () => {
  // for each binding, the keys of recipients(samplePayload)[0].variables must equal the union of
  // `variables` across CATALOGUE.templates with that templateKey — the boot check asserts the same
  // thing against the database; this one fails in CI without one
});

it('sends an OTP only on the channel the challenge was issued for', () => {
  const [r] = otpBinding.recipients({ userId, challengeId, purpose: 'REGISTRATION',
    channels: ['SMS'], code: '482913', expiresInMinutes: 5 });
  expect(r.channels).toEqual(['SMS']);
});

it('mirrors to email when the event asks for both', () => {
  // channels: ['SMS','EMAIL'] → recipient.channels is ['SMS','EMAIL']
});

it('notifies nobody for a challenge with no user (the forgot-password decoy)', () => {
  expect(otpBinding.recipients({ userId: null, … })).toEqual([]);
});

it('lets an OTP reach an address nobody has verified, and nothing else', () => {
  expect(allowsUnverifiedDestination('identity.otp.requested')).toBe(true);
  expect(allowsUnverifiedDestination('identity.password.changed')).toBe(false);
  expect(allowsUnverifiedDestination('identity.device.new_sign_in')).toBe(false);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/notify/domain/binding.test.ts`

- [ ] **Step 3: Write the dispatch and send integration tests (do not run)**

Add to `test/modules/notify/services/dispatch.int.test.ts`:

```ts
it('sends only the channels the recipient names', async () => {
  // identity.otp.requested has an SMS and an EMAIL template; a recipient with channels ['SMS']
  // produces exactly one notification row
});
it('throws when a recipient names a channel the template does not have', async () => {
  // silence here would be a security-critical message nobody sent and nobody logged
});
it('addresses an OTP to an unverified primary phone', async () => {
  // a PENDING_VERIFICATION user with one unverified primary phone gets a QUEUED row, not DEAD_LETTERED
});
it('still refuses an unverified address for every other template', async () => {
  // identity.password.changed to a user with only an unverified email → DEAD_LETTERED, no_destination
});
it('prefers the verified contact when both exist', async () => {
  /* … */
});
```

Add to `test/modules/notify/jobs/send.int.test.ts`:

```ts
it('re-resolves an OTP destination with the same unverified allowance dispatch used', async () => {
  // otherwise the row is QUEUED at dispatch and dead-letters at send, which is worse than either
});
```

- [ ] **Step 4: Implement**

- `recipients.service.ts`: both the EMAIL and the phone query become one statement filtered on `is_primary`, ordered `verified_at NULLS LAST`, `LIMIT 1`; the row is returned only when `verified_at` is set **or** `options.allowUnverified` is true. The existing comment ("Unverified is the same as absent here…") stays and gains the exception and its reason: a registration OTP is the thing that _makes_ an address verified, so demanding verification first is a cycle no user can break.
- `binding.ts`: `channels` on `NotificationRecipient`; `UNVERIFIED_DESTINATION_TEMPLATES` with a comment naming the one key and why it is a set rather than a flag on the template row (a template row is operator-editable data, and this is a security decision); the four bindings.
- `dispatch.service.ts`: `dispatchToRecipient` filters `templates` by `recipient.channels` when present and throws when the filter empties a non-empty list; `dispatchOne` passes `{ allowUnverified: allowsUnverifiedDestination(templateKey) }` to `resolveDestination`.
- `send.job.ts`: the same option, derived from `claimed.templateKey`.

The `identity.device.signed_in` binding fills `deviceLabel` from the payload, `location` from the payload's `location` (the IP, or `'an unrecognised location'` when there is none — we have no geo-IP, and the template promises a place), and `signedInAt` formatted in `Africa/Lagos`.

- [ ] **Step 5: Run the unit tests and confirm they pass**

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/notify`

- [ ] **Step 6: Typecheck, lint, commit**

```bash
git commit -m "feat(notify): target a binding's channels and let an OTP reach an unverified address"
```

---

### Task 11: Wiring, the whole flow, and the enumeration suite

**Files:**

- Modify: `src/modules/identity/index.ts`
- Test: `test/modules/identity/index.test.ts` (unit, extend), `test/modules/identity/registration-flow.int.test.ts` (int — write, do not run)
- Modify: `docs/tickets/03-identity.md`

**Interfaces:**

- Consumes: everything above.
- Produces: `createIdentityAuth` additionally builds `registrationRoutes` and `passwordRoutes`; `IdentityAuthOptions` gains nothing (the pepper, the flags and the terms versions all come off the `config` it already takes).

- [ ] **Step 1: Write the failing barrel tests**

Extend `test/modules/identity/index.test.ts`:

```ts
it('refuses to build without IDENTITY_HMAC_PEPPER, naming the variable', () => {
  expect(() => createIdentityAuth({ …, config: configWithoutPepper }))
    .toThrow(/IDENTITY_HMAC_PEPPER/);
});
it('serves every route M1 §10.1 names for this ticket', () => {
  const paths = createIdentityAuth(deps).routes!.map((r) => `${r.method.toUpperCase()} ${r.path}`);
  expect(paths).toEqual(expect.arrayContaining([
    'POST /auth/register', 'POST /auth/otp/resend', 'POST /auth/verify-otp', 'POST /auth/login',
    'POST /auth/password/forgot', 'POST /auth/password/reset', 'POST /auth/password/change',
    'GET /me/terms', 'POST /me/terms/accept',
  ]));
});
it('passes assertRouteInvariants over the whole module', () => {
  expect(() => assertRouteInvariants(createIdentityAuth(deps).routes!)).not.toThrow();
});
it('exports the new surface and nothing internal', () => {
  // the barrel exports hashPassword, checkPasswordPolicy, otpPurposeLabel, the nine events,
  // createSession (T-031) …
});
```

- [ ] **Step 2: Run, confirm failure, wire `createIdentityAuth`, run, confirm PASS**

`createIdentityAuth` builds one `HmacHasher` from `config.identity.hmacPepper`, throwing with the variable name when it is absent (the same shape as `createTokenSigner`), assembles `AuthDeps` once, and concatenates `authRoutes`, `usernameRoutes`, `registrationRoutes` and `passwordRoutes`.

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/identity`

- [ ] **Step 3: Write the whole-flow integration test (do not run)**

`test/modules/identity/registration-flow.int.test.ts` — one file that walks E2 → E3 → E4 → AC2 → AC3 end to end against the real app, plus:

```ts
it('takes a phone-first user from signup to a CONSUMER session and CONTACT_VERIFIED', async () => {
  // register (phone) → read the code out of the outbox payload → verify-otp → session
  // → set a password via /auth/password/change with no currentPassword
  // → claim a username (T-033's route) → register the email → verify it
  // → users.verification_level is CONTACT_VERIFIED and nextStep is DONE
});
it('queues one SMS and no email for a phone registration', async () => {
  // exactly one notify.notifications row, channel SMS, status QUEUED
});
it('mirrors the OTP to email when IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL is on', async () => {
  /* … */
});
it('never writes an OTP code or a password into identity_audit_log', async () => {
  // scan every metadata jsonb written during the flow
});
it('survives a replayed /auth/register with the same Idempotency-Key', async () => {
  // the route is retryable: false, so the second call is a genuine second attempt and answers 409
});
```

- [ ] **Step 4: Run the whole unit suite and the whole-repo checks**

```bash
pnpm --filter @komtru/backend-api test
pnpm -w exec turbo run typecheck lint test --force
pnpm -w exec prettier --check .
```

- [ ] **Step 5: Commit, then request a fresh whole-branch review**

```bash
git commit -m "feat(identity): wire registration, login and password routes into the module"
```

Then: `superpowers:requesting-code-review` with a fresh subagent over the whole branch; `superpowers:receiving-code-review` for the fix pass; `superpowers:verification-before-completion` before claiming anything passes.

- [ ] **Step 6: Mark the ticket done**

Add under `### T-032` in `docs/tickets/03-identity.md` a `- **Status:** Done (2026-10-06). Plan: docs/superpowers/plans/2026-10-06-t-032-registration.md.` line with a substantial note in T-031's voice, and a `- **Deferred:**` line covering at least: MFA and the `mfaRequired` login branch (T-036), social login (T-034), `invitationToken` binding (T-035), staff and logistics login (T-037), the register endpoint's 409 being an enumeration oracle, the OTP code living in the outbox payload and in `notify.notifications.rendered_body` with no retention, and `/auth/otp/resend` re-reading the destination from the primary contact rather than from the challenge.

Do **not** run `pnpm tickets:index`.

---

## Self-Review

**Spec coverage.** Every T-032 acceptance criterion maps to a task: phone-first and email registration (7), OTP through notify (4, 10), wrong-code state (4, 7), login by email/phone/username (8), forgot and reset (9), change revoking other sessions (9), argon2id with transparent rehash (1, 6), breach check behind the flag (1, 6), uniform failures and the <5ms suite (8), rate limits per IP/identifier/device (2, 7, 8, 9), OTP verify cap (4), terms at registration and re-acceptance (2, 7), and the four named events plus the five the notify catalogue and §11 need (3).

**Not covered, and deliberately:** `/auth/mfa/verify` and the `mfaRequired` login branch (T-036); social login (T-034); `invitationToken` (T-035) — the field is rejected with a 422 rather than silently ignored; staff and logistics login (T-037); `/me/sessions` (no ticket owns it yet).

**Type consistency.** `AuthDeps` is defined in Task 7 and consumed by Tasks 8, 9 and 11. `VerifyOutcome` is defined in Task 4 and reused in Tasks 7 and 9. `PasswordRejection` is defined in Task 1 and reused in Tasks 6, 7 and 9. `NextStep` and `PublicUser` are defined in Task 7 and reused in Task 8. `PasswordHasher` is defined in Task 1 and injected in Tasks 6 and 8.

**Review Focus coverage.** (1) Task 5, "turns a lost race for a verified address into a 409". (2) Task 9, "allows a first password with no currentPassword". (3) Task 10, "addresses an OTP to an unverified primary phone". (4) Task 10, "sends only the channels the recipient names". (5) Task 7, "drops an unparseable X-Forwarded-For".
