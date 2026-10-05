# T-026 Platform Crypto and Identifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One implementation each of authenticated encryption, domain-separated keyed hashing, unbiased randomness and identifier normalisation, under `src/platform/`, so no module ever rolls its own.

**Architecture:** The platform owns the primitives and takes its key material as an argument; it never imports `config`. `crypto/encryption.ts` exposes free functions over a 32-byte key plus a `createEncryption(config)` binding that reads `ENCRYPTION_KEY` once; `crypto/hmac.ts` exposes `hmac(key, domain, value)` plus `createHmacHasher(key)` so identity, logistics and the rest share one helper with their own pepper instead of each keeping a copy; `crypto/random.ts` is keyless. `identifiers.ts` sits at the platform root because it is pure string work with one dependency (`libphonenumber-js`) and no key.

**Tech Stack:** Node 22 `node:crypto` (AES-256-GCM, HMAC-SHA256, `randomInt`, `timingSafeEqual`), libphonenumber-js 1.13.14, Zod 4 for the config variable, Vitest.

**Spec:** design §11 cannibalization audit and §3.4 env reuse (`docs/superpowers/specs/2026-10-05-komtru-platform-design.md`), ticket T-026 in `docs/tickets/02-backend-platform.md`; cannibalized from `kumtru/backend-apis/src/modules/{utils/encryption.ts,identity/infrastructure/crypto.ts,identity/domain/identifiers.ts}` (T-001).

## Global Constraints

- Wire format is exactly `v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>`, AES-256-GCM, 12-byte random IV — unchanged from the old backend, so the reused `ENCRYPTION_KEY` keeps working.
- `ENCRYPTION_KEY` is 64 lowercase-or-uppercase hex characters (32 bytes). It is carried over verbatim by `scripts/env/populate-backend-env.mjs` (which copies every key from the old `.env`); nothing is regenerated.
- Platform code takes keys as parameters. No `src/platform/**` file imports `loadConfig`; the one config-reading binding takes `AppConfig` as an argument, like `createLogger`.
- Every new file opens with a `// Cannibalized from kumtru/backend-apis/src/modules/<path> (T-001), adapted: …` header naming what changed.
- Tests are pure unit tests under `apps/backend-api/test/platform/**`, Vitest, `*.test.ts`. No infra, no `KOMTRU_INFRA_TESTS`.
- Relative imports carry `.js`. Plain exported functions; no classes beyond the existing `ConfigError`.

## Review Focus

1. Tampering with any of the three ciphertext fields (iv, tag, data) must fail to decrypt, not return garbage — GCM only authenticates if the tag is actually checked and the key length is right.
2. A malformed payload (wrong part count, odd-length hex, non-hex characters, a truncated IV) must throw a named error, not be silently coerced — `Buffer.from('zz', 'hex')` yields an empty buffer rather than throwing.
3. Domain separation must be unambiguous: `hmac(k, 'otp a', 'b')` and `hmac(k, 'otp', 'a b')` must differ. The old `${domain} ${value}` framing collides here.
4. Constant-time compare must report a length mismatch as `false` without throwing, and never leak length through an early return.
5. `randomNumericCode(digits)` must be uniform and must reject a digit count where the range exceeds what `crypto.randomInt` accepts (2^48), instead of silently biasing.

---

### Task 1: `ENCRYPTION_KEY` in the boot config

**Files:**

- Modify: `apps/backend-api/src/config/env.ts` (`VARIABLES`, `AppConfig`, the return object)
- Test: `apps/backend-api/test/config/env.test.ts`

**Interfaces:**

- Produces: `AppConfig['crypto']: { encryptionKey?: string }`.

Optional, not required: the API, worker and every existing test build a config from `POSTGRES_URL` + `REDIS_URL` only, and a process that never encrypts must still boot. The key's absence is caught where it is used (Task 2), with the variable named.

- [ ] **Step 1: Write the failing tests** in `test/config/env.test.ts`

```ts
it('accepts a 32-byte hex encryption key and rejects anything else', () => {
  const key = 'a'.repeat(64);
  expect(loadConfig({ ...minimal, ENCRYPTION_KEY: key }).crypto.encryptionKey).toBe(key);
  expect(loadConfig(minimal).crypto.encryptionKey).toBeUndefined();
  expect(failure({ ...minimal, ENCRYPTION_KEY: 'a'.repeat(63) }).invalid).toEqual(['ENCRYPTION_KEY']);
  expect(failure({ ...minimal, ENCRYPTION_KEY: `${'a'.repeat(62)}zz` }).invalid).toEqual(['ENCRYPTION_KEY']);
});
```

- [ ] **Step 2: Run it and watch it fail** — `pnpm --filter @komtru/backend-api exec vitest run test/config/env.test.ts`. Expected: FAIL, `crypto` undefined.
- [ ] **Step 3: Add the variable** — `ENCRYPTION_KEY: { schema: z.string().regex(/^[0-9a-fA-F]{64}$/), required: false }` in `VARIABLES`, `crypto: { encryptionKey?: string }` on `AppConfig` with a one-line comment on why it is optional, and `crypto: { ...(v.ENCRYPTION_KEY ? { encryptionKey: v.ENCRYPTION_KEY } : {}) }` in the return, matching the `sentry.dsn` shape.
- [ ] **Step 4: Run it and watch it pass.**
- [ ] **Step 5: Commit** `feat(backend-api): parse encryption_key at boot`.

### Task 2: AES-256-GCM encryption

**Files:**

- Create: `apps/backend-api/src/platform/crypto/encryption.ts`
- Test: `apps/backend-api/test/platform/crypto/encryption.test.ts`

**Interfaces:**

- Consumes: `AppConfig` from Task 1.
- Produces:
  - `ENCRYPTION_PREFIX = 'v1'`
  - `parseEncryptionKey(hex: string): Buffer` — throws `Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)')`
  - `encrypt(key: Buffer, plaintext: string): string`
  - `decrypt(key: Buffer, payload: string): string`
  - `isEncrypted(value: string): boolean`
  - `interface Encryption { encrypt(plaintext: string): string; decrypt(payload: string): string; seal(plaintext: string): Buffer; open(sealed: Buffer): string }`
  - `createEncryption(config: AppConfig): Encryption` — throws when `config.crypto.encryptionKey` is absent, naming the variable. `seal`/`open` are the `bytea`-column form (`Buffer.from(wire, 'utf8')` and back), so `*_enc` columns and string columns share one implementation.

Lifted from `utils/encryption.ts`. Adapted: the key is a parameter rather than a `config` singleton import; the payload is strictly validated before any `Buffer.from(..., 'hex')`, because that call silently drops non-hex characters and would otherwise turn a corrupt row into a confusing GCM failure or, for the IV, a wrong-length-but-accepted nonce (Node's GCM accepts any IV length).

- [ ] **Step 1: Write the failing tests**

```ts
const key = randomBytes(32);

it('round-trips, including empty and unicode plaintext', …);           // '', 'héllo ⚡ naïve', 2 KB of text
it('produces a different ciphertext each time for the same plaintext', …); // two encrypts differ, both decrypt
it('writes the v1 wire format', …);  // /^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/
it.each(['iv', 'tag', 'data'])('fails to decrypt when the %s is tampered with', …); // flip one hex char in that field -> throws
it('fails to decrypt under a different key', …);
it.each([
  'v2:aa:bb:cc', 'v1:aa:bb', 'v1:aa:bb:cc:dd', 'not-encrypted', '',
])('rejects the malformed payload %s', …);                               // throws /Malformed ciphertext/
it('rejects a payload whose iv or tag is the wrong length or not hex', …); // 22-hex iv; 'zz'-padded tag
it('recognises its own output and nothing else', …);                     // isEncrypted
it('rejects a key that is not 32 bytes of hex', …);                      // parseEncryptionKey: 63 chars, 'zz…', ''
it('binds a key from config and fails loudly without one', …);           // createEncryption: round-trip; throws /ENCRYPTION_KEY/
it('seals to a buffer and opens it again', …);
```

- [ ] **Step 2: Run them and watch them fail** — `pnpm --filter @komtru/backend-api exec vitest run test/platform/crypto/encryption.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement the file.** Validation before use: split on `:`, require 4 parts and `v1`, require `/^[0-9a-f]+$/i` on each remaining part with even length, require the IV to be 24 hex chars and the tag 32. One shared `Error('Malformed ciphertext: expected v1:<iv>:<tag>:<data>')` for all of them — a caller that could distinguish "bad tag length" from "bad part count" learns nothing useful and the message would travel into logs.
- [ ] **Step 4: Run them and watch them pass.**
- [ ] **Step 5: Commit** `feat(backend-api): add aes-256-gcm encryption helpers`.

### Task 3: Domain-separated HMAC and constant-time compare

**Files:**

- Create: `apps/backend-api/src/platform/crypto/hmac.ts`
- Test: `apps/backend-api/test/platform/crypto/hmac.test.ts`

**Interfaces:**

- Produces:
  - `hmac(key: Buffer | string, domain: string, value: string | Buffer): Buffer` — HMAC-SHA256
  - `sha256(value: string | Buffer): Buffer`
  - `timingSafeEqualBuffers(a: Buffer, b: Buffer): boolean`
  - `interface HmacHasher { hmac(domain: string, value: string | Buffer): Buffer; matches(domain: string, value: string | Buffer, expected: Buffer): boolean }`
  - `createHmacHasher(key: Buffer | string): HmacHasher` — throws on an empty key.

Lifted from `identity/infrastructure/crypto.ts`. Adapted: the pepper is a parameter (one helper, each caller's own key) instead of a module-level `config.identity.hmacPepper` read, and the domain is **length-prefixed** rather than joined with a space.

The framing is the one algorithm the signature does not determine:

```
HMAC-SHA256(key, uint32be(domainBytes.length) ‖ domainBytes ‖ valueBytes)
```

The old `` `${domain} ${value}` `` is not injective: domain `'otp a'` with value `'b'` and domain `'otp'` with value `'a b'` hash identically, which is exactly the cross-table confirmation the domain argument exists to prevent. A length prefix is injective for every domain, including ones that contain a space.

- [ ] **Step 1: Write the failing tests**

```ts
it('is deterministic and 32 bytes', …);
it('separates domains', …);                      // hmac(k,'otp','1') !== hmac(k,'invite','1')
it('separates an ambiguous domain/value split', …); // hmac(k,'otp a','b') !== hmac(k,'otp','a b')
it('depends on the key', …);
it('accepts a string or buffer key and value', …);
it('hashes unkeyed with sha256', …);             // matches a known digest of 'komtru'
it('compares equal buffers in constant time', …);
it('reports unequal lengths as false without throwing', …); // (1 byte, 32 bytes), (0, 0) -> true
it('binds a key and verifies a digest', …);      // createHmacHasher: matches() true/false, wrong domain false
it('rejects an empty key', …);
```

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement the file.** `timingSafeEqualBuffers` keeps the old shape: on a length mismatch, run `crypto.timingSafeEqual(sha256(a), sha256(b))` for its cost and return `false`, because `timingSafeEqual` throws on unequal lengths and a throw is itself an oracle.
- [ ] **Step 4: Run them and watch them pass.**
- [ ] **Step 5: Commit** `feat(backend-api): add domain-separated hmac helpers`.

### Task 4: Unbiased random tokens and numeric codes

**Files:**

- Create: `apps/backend-api/src/platform/crypto/random.ts`
- Test: `apps/backend-api/test/platform/crypto/random.test.ts`

**Interfaces:**

- Produces:
  - `randomToken(bytes = 32): string` — base64url, throws below 16 bytes
  - `randomNumericCode(digits = 6): string` — zero-padded, uniform, throws outside 1..14

Lifted from `identity/infrastructure/crypto.ts`. Adapted: both arguments are range-checked. `crypto.randomInt` rejects a range above 2^48, so `randomNumericCode(16)` would throw deep inside Node with an opaque message; 14 digits is the largest safe power of ten (10^15 > 2^48 ≈ 2.8×10^14).

- [ ] **Step 1: Write the failing tests**

```ts
it('returns url-safe tokens of the requested entropy', …);    // /^[A-Za-z0-9_-]+$/, no '=', 32 bytes -> 43 chars
it('does not repeat', …);                                      // 1000 tokens, all distinct
it('rejects a token shorter than 16 bytes', …);
it.each([4, 6])('returns exactly %i digits, zero-padded', …);   // 2000 draws, /^\d{n}$/ every time
it('covers the whole range including the padded low end', …);   // 20k draws of 4 digits: sees a code < '1000' and one >= '9000'
it('is close to uniform', …);                                   // 60k draws of 1 digit, every digit within 15% of 6000
it.each([0, 15])('rejects %i digits', …);
```

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement the file** using `crypto.randomInt(0, 10 ** digits)` and `crypto.randomBytes(bytes).toString('base64url')`.
- [ ] **Step 4: Run them and watch them pass.**
- [ ] **Step 5: Commit** `feat(backend-api): add unbiased random token and code helpers`.

### Task 5: Identifier normalisation, masking and public ids

**Files:**

- Create: `apps/backend-api/src/platform/identifiers.ts`
- Modify: `apps/backend-api/package.json` (add `libphonenumber-js` 1.13.14 to `dependencies`, exact version, alphabetical)
- Test: `apps/backend-api/test/platform/identifiers.test.ts`

**Interfaces:**

- Produces: `NormalisedEmail { email, emailNormal, domain }`, `isValidEmail`, `normaliseEmail`, `isApplePrivateRelay`, `maskEmail`, `DEFAULT_COUNTRY: CountryCode = 'NG'`, `PHONE_REVERIFY_AFTER_DAYS = 365`, `NormalisedPhone { phoneE164, countryCode }`, `normalisePhone(raw, country?) : NormalisedPhone | null`, `maskPhone`, `phoneReverifyAfter(from: Date): Date`, `generatePublicId(prefix?): string`, `IdentifierKind`, `classifyIdentifier`.

Lifted from `identity/domain/identifiers.ts`: the ReDoS-free split-and-check domain validation, the provider folding sets, the Crockford-minus-ILOU public id alphabet and the leading-`@` username rule are all already right. It lives at the platform root, not under `identity/`, because trades, logistics and notifications all normalise the same identifiers.

Four behaviours are corrected rather than lifted, each with its own test above: `maskPhone` keeps a shrinking prefix so at least four characters are always hidden (the old fixed 7-and-4 showed 11 of the 12 characters of every US and Canadian E.164 number); `normaliseEmail` validates before canonicalising, so an undeliverable string cannot reach the column the verified-email unique index covers; `normalisePhone` leaves `countryCode` absent for a valid non-geographic number (`+800`) instead of defaulting it to `NG`; and `classifyIdentifier` accepts a leading `(`, which `(0801) 234-5678` needs.

- [ ] **Step 1: Write the failing tests**

```ts
// email
it('lowercases and trims, keeping the typed address', …);                  // '  Jane.Doe@Example.COM ' -> email 'jane.doe@example.com', emailNormal unchanged
it('folds dots and +tags for gmail, and googlemail onto gmail', …);        // 'j.ane+komtru@googlemail.com' -> 'jane@gmail.com', domain 'googlemail.com'
it('folds +tags only for outlook/yahoo/icloud/proton', …);                 // 'jane.doe+x@outlook.com' -> 'jane.doe@outlook.com'
it('leaves an unknown provider alone', …);                                 // 'j.a+n@komtru.com' unchanged
it('throws on a value that is not an email', …);
it.each(['jane@example.com', 'a@b.co', "o'brien@sub.example.ng"])('accepts %s', …);
it.each(['', 'jane', 'jane@', '@example.com', 'jane@localhost', 'ja ne@example.com', `${'a'.repeat(250)}@example.com`])('rejects %s', …);
it('validates a long non-matching domain in linear time', …);              // 'a@' + 'a'.repeat(50_000) returns false under 50 ms
it('spots an apple private relay address', …);
it('masks an email to its first character', …);                            // 'jane@gmail.com' -> 'j•••@gmail.com'; no '@' -> '•••'

// phone
it('normalises a local NG number to E.164', …);                            // '0801 234 5678' -> '+2348012345678', 'NG'
it('normalises an already-international number regardless of default', …); // '+447911123456' -> countryCode 'GB'
it('honours an explicit default country', …);                              // normalisePhone('(415) 555-2671', 'US')
it.each(['', '12', '0801234567', 'not a phone'])('returns null for %s', …);
it('masks a phone, always hiding at least four characters', …);            // '+2348012345678' -> '+23480•••5678'; '+14155552671' -> '+141•••2671'; short -> '•••'
it('re-verifies a year out', …);

// public id and classification
it('generates KMT-U-XXXXXX from the unambiguous alphabet', …);             // /^KMT-U-[0-9A-HJKMNP-TV-Z]{6}$/, no I L O U
it('honours a custom prefix and does not repeat', …);                      // 1000 ids distinct
it.each([['jane@x.com','EMAIL'], ['@janedoe','USERNAME'], ['+2348012345678','PHONE'], ['0801 234 5678','PHONE'], ['janedoe','USERNAME'], ['  @jane ','USERNAME']])('classifies %s as %s', …);
```

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Add the dependency** (`pnpm --filter @komtru/backend-api add libphonenumber-js@1.13.14`) **and write the file.**
- [ ] **Step 4: Run them and watch them pass.**
- [ ] **Step 5: Commit** `feat(backend-api): add identifier normalisation and masking`.

### Task 6: Verify, document, review

**Files:**

- Modify: `docs/tickets/02-backend-platform.md` (T-026 `Status` line)

- [ ] **Step 1: Run the full gate** — `pnpm exec turbo run build lint typecheck test --force` and `pnpm exec prettier --check .`. Read the output; every task is green or the ticket is not done.
- [ ] **Step 2: Request a fresh whole-branch review** (superpowers:requesting-code-review), triage it (superpowers:receiving-code-review), fix what is real, commit as `fix(backend-api): address T-026 review findings`.
- [ ] **Step 3: Mark the ticket done** with the `- **Status:** Done (2026-10-05). Plan: …` line, plus a `- **Deferred:** …` line for anything left, and commit `docs(tickets): mark T-026 done`.
