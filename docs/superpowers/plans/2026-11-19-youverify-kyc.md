# Youverify KYC Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Youverify the real KYC provider across all five `KycProviderAdapter` methods, and give a user a way to start a verification — which no screen offers today.

**Architecture:** Four of the five checks (NIN, BVN, CAC, bank name-match) are synchronous server-to-server calls behind the existing adapter seam, so they are implementation with no new structure. Liveness inverts: the browser runs Youverify's web SDK, and a signed webhook resolves a request parked at `PROVIDER_PENDING` — which also closes an existing hole where `PROVIDER_PENDING` had no exit but expiry.

**Tech Stack:** TypeScript, Express, BullMQ, Drizzle/Postgres, Vitest, Next.js 15, `youverify-web-sdk` (CDN, browser global).

**Spec:** `docs/superpowers/specs/2026-11-19-youverify-kyc-design.md`

## Global Constraints

- **Branch off `staging`, merge to `staging`.** Never push to `main`.
- **Conventional Commits**, lower-case verb, header under 100 chars.
- **Never commit a `.env`.** Credentials live in `docs/specs/backend-apis.env` (git-ignored) and are never printed in a log, PR body or reply.
- **D1 holds absolutely:** no raw NIN or BVN is stored, logged, or placed in Redis in plaintext. Job payloads seal the whole claim via `encryption.encrypt(JSON.stringify(claim))`.
- **No mapper is written against a response nobody has received.** Task 1 gates Tasks 4 onward.
- **Run only your own tests.** Never `turbo run lint typecheck test` across the repo. Integration tests need `KOMTRU_INFRA_TESTS=1` and an agent-specific `KOMTRU_TEST_DB_PREFIX`.
- **Only one migration-bearing branch in flight.** Run `pnpm migration:safety` before any deploy. Next number is `0056`.
- `TRUST_KYC_PROVIDER` stays `FAKE` locally and is flipped only in Task 9.

## Review Focus

Five failure modes the spec implies that no obvious task would otherwise exercise. Each line's test is attached to the task named.

1. **A webhook arrives for a request the sweep already expired.** Expected: it grants nothing and does not resurrect the request. (Task 7)
2. **A webhook's `metadata.reference` is missing, unknown, or belongs to another user.** Expected: recorded with a `processing_error`, acknowledged 200, nothing resolved. (Task 7)
3. **Youverify answers `402 Insufficient fund`.** Expected: the user never sees "not approved"; the request stays open for retry and the condition is distinguishable in logs. (Task 5)
4. **A webhook body containing non-ASCII characters.** Expected: the signature verifies against the raw bytes and would fail against a re-serialised body. (Task 6)
5. **`status: found` with `allValidationPassed: false`.** Expected: a deliberate, tested verdict — not an accidental pass because only `status` was read. (Task 4)
6. **A worker dies holding a delivery in `PROCESSING`.** Expected: the stale sweep returns it for a bounded number of retries and it never silently disappears. (Task 7)

---

## Task 0: Branch

- [ ] **Step 1: Branch off `staging`**

```bash
git fetch origin && git checkout staging && git pull && git checkout -b f-045-youverify-kyc
```

---

## Task 1: Capture real sandbox responses (GATE)

Nothing downstream is written until this task's fixtures exist. It also answers three open spec questions empirically.

**Files:**

- Create: `apps/backend-api/test/fixtures/youverify/*.json`
- Create (throwaway, scratchpad only): a probe script — **not** committed

**Interfaces:**

- Produces: fixture files named `nin-found.json`, `nin-not-found.json`, `bvn-found.json`, `bank-match.json`, `company-basic.json`, `company-advance.json`, and `liveness-webhook.json` if obtainable.

- [ ] **Step 1: Write a throwaway probe script in the scratchpad**

Reads `YOUVERIFY_SECRET_TOKEN` and `YOUVERIFY_BASE_URL` from `apps/backend-api/.env`. Calls, with `isSubjectConsent: true` and the documented sandbox test id `12345678901`:

- `POST {base}/v2/api/identity/ng/nin`
- the BVN equivalent
- the bank account resolution endpoint
- `POST {base}/v2/api/verifications/ng/company/basic`
- `POST {base}/v2/api/verifications/global/company-advance-check`

- [ ] **Step 2: Run it and record every response verbatim**

Capture status code and body for each, including failures. A 403 on the advance check is a _result_, not an error to retry.

- [ ] **Step 3: Answer the spec's open questions in writing**

Append findings to `docs/superpowers/specs/2026-11-19-youverify-kyc-design.md` §10, converting each question to an answer with the evidence:

- Is `company-advance-check` reachable, and does it return `keyPersonnel`?
- Is it `premiumNIN` or `premiumNin`?
- Which field carries the webhook dedup key?
- What are the real verdict/status values, and which mean "low confidence" rather than "failed"?

- [ ] **Step 4: Confirm liveness entitlement**

Check the Youverify dashboard for liveness on this account. **If liveness is not enabled, STOP and report** — `domain/levels.ts` requires an identifier **plus** liveness for level 2, so Tasks 6–8 would build a path nobody can complete.

- [ ] **Step 5: Save fixtures with secrets stripped**

Redact any token echoed in a response. Fixtures are committed; the probe script is not.

- [ ] **Step 6: Commit**

```bash
git add apps/backend-api/test/fixtures/youverify docs/superpowers/specs/2026-11-19-youverify-kyc-design.md
git commit -m "test(trust): record real youverify sandbox responses as fixtures"
```

---

## Task 2: Keep the entity prefix on RC numbers

Independent of Youverify; fixes a live defect where `RC1487322`, `BN1487322` and `LLP1487322` all hash to the same duplicate key.

**Files:**

- Modify: `apps/backend-api/src/modules/trust/domain/identifiers.ts:69-99`
- Test: `apps/backend-api/test/modules/trust/identifiers.test.ts`

**Interfaces:**

- Produces: `normaliseRcNumber(raw: string): string` — upper-cases and strips non-alphanumerics but **retains** a leading `RC`/`BN`/`IT`/`LP`/`LLP`.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps the entity prefix', () => {
  expect(normaliseRcNumber('rc 1487322')).toBe('RC1487322');
  expect(normaliseRcNumber('BN-1487322')).toBe('BN1487322');
});
it('does not collapse different entity types to one key', () => {
  const codes = ['RC1487322', 'BN1487322', 'IT1487322', 'LP1487322', 'LLP1487322'];
  expect(new Set(codes.map(normaliseRcNumber)).size).toBe(5);
});
it('leaves a bare number alone', () => {
  expect(normaliseRcNumber('1487322')).toBe('1487322');
});
```

- [ ] **Step 2: Run them and watch the second one fail with size 1**

Run: `pnpm --filter @komtru/backend-api exec vitest run test/modules/trust/identifiers.test.ts`

- [ ] **Step 3: Drop the `.replace(RC_PREFIX, '')` and widen `isValidRcNumber`**

`RC_MIN`/`RC_MAX` must still accept a prefixed value; `RC_PREFIX` stays exported only if something else uses it.

- [ ] **Step 4: Run the trust unit tests**

Expected: PASS, including the existing `rcNumberHash` normalisation guard.

- [ ] **Step 5: Record the consequence for existing rows**

Add a note to the spec §6: rows written under the old rule keep the old hash and will not match a new submission. Per the spec's recommendation these are left as-is and counted, not backfilled.

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(trust): keep the CAC entity prefix so registrations stop colliding"
```

---

## Task 3: Config, the provider branch, and a refusing client

Makes `YOUVERIFY` selectable and loud about what it cannot yet do.

**Files:**

- Modify: `apps/backend-api/src/config/env.ts:203-213,304-320,540-544`
- Modify: `apps/backend-api/src/modules/trust/jobs/providers.ts`
- Create: `apps/backend-api/src/modules/trust/infrastructure/providers/youverify.client.ts`
- Modify: `apps/backend-api/.env.example`
- Test: `apps/backend-api/test/config/env.test.ts`

**Interfaces:**

- Produces: `YouverifyCredentials { secretToken: string; publicMerchantKey: string; webhookSecret: string; baseUrl: string }`; `createYouverifyClient(credentials: YouverifyCredentials, logger: Logger): KycProviderAdapter`.

- [ ] **Step 1: Write the failing config tests**

Assert `TRUST_KYC_PROVIDER=YOUVERIFY` parses; that `loadConfig` leaves `youverify` absent unless all four variables are set; and that selecting `YOUVERIFY` with none set throws `KycProviderNotConfiguredError` naming all four.

- [ ] **Step 2: Run and watch them fail on the enum**

- [ ] **Step 3: Add the four variables, the `KycProviderFlag` member and the credentials block**

Mirror the `DOJAH_*` shape exactly: all four optional, assembled only when all are present.

- [ ] **Step 4: Add the `YOUVERIFY` branch to `kycProvider()`**

Same shape as the `DOJAH` branch: missing credentials throw naming all four variables.

- [ ] **Step 5: Create `youverify.client.ts` with all five methods refusing**

A rejected promise, not a synchronous throw — a throw out of an adapter is an exception on the worker's call stack, not a failed job. Later tasks replace the bodies.

- [ ] **Step 6: Document the four variables in `.env.example`**

Required: `test/config/env-example-parity.test.ts` fails on any undocumented variable.

- [ ] **Step 7: Run config tests and typecheck the package**

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(trust): make youverify a selectable kyc provider"
```

---

## Task 4: Pure request construction and response mapping

The only file carrying vendor-specific knowledge. Written against Task 1's fixtures and nothing else.

**Files:**

- Create: `apps/backend-api/src/modules/trust/infrastructure/providers/youverify.requests.ts`
- Create: `apps/backend-api/src/modules/trust/infrastructure/providers/youverify.mapping.ts`
- Test: `apps/backend-api/test/modules/trust/youverify-mapping.test.ts`

**Interfaces:**

- Consumes: Task 1's fixtures; `IdentityClaim`, `BusinessClaim`, `BankAccountClaim` and the four result types from `domain/provider.ts`; `RejectionCode` from `domain/rejection.ts`.
- Produces: `ninRequest`, `bvnRequest`, `companyRequest`, `bankMatchRequest` in `youverify.requests.ts`, each returning `{ url, headers, body }`; `mapIdentity`, `mapBusiness`, `mapBankMatch` in `youverify.mapping.ts`, each taking the parsed JSON and returning the matching result type.

- [ ] **Step 1: Write the failing mapping tests against the fixtures**

One test per verdict branch, loading the real fixture. Required cases, with the exact values read from Task 1:

- a found identity maps to `PASSED` with a `providerReference`
- a not-found identity maps to `FAILED` with `failureCode: 'ID_NOT_FOUND'`
- a name mismatch maps to `failureCode: 'ID_NAME_MISMATCH'`
- **`status: found` with `allValidationPassed: false` does not map to `PASSED`** (Review Focus 5)
- whichever status Task 1 found to mean low confidence maps to `LOW_CONFIDENCE`, not `FAILED`
- a company response with `keyPersonnel` sets `officersMatch`; one without leaves it `undefined`

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement the two pure modules**

No network, no imports from `jobs/`. `youverify.requests.ts` uses the casing Task 1 confirmed for `premiumNIN`, sets `isSubjectConsent: true`, and sends the RC number **with** its prefix (Task 2).

- [ ] **Step 4: Run the mapping tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(trust): map youverify responses onto the adapter result types"
```

---

## Task 5: The four synchronous methods, live

**Files:**

- Modify: `apps/backend-api/src/modules/trust/infrastructure/providers/youverify.client.ts`
- Test: `apps/backend-api/test/modules/trust/youverify-client.test.ts`

**Interfaces:**

- Consumes: Task 4's request and mapping functions; `providerRequest(logger, request)` from `platform/providers/http.ts`.
- Produces: `verifyNin`, `verifyBvn`, `verifyBusiness`, `verifyBankAccountName` answering for real; `checkLiveness` still refusing until Task 8.

- [ ] **Step 1: Write the failing tests with a stubbed transport**

Assert each method sends the `token` header, hits the URL Task 4 builds, and returns the mapped result. Plus Review Focus 3: **a 402 response produces a distinguishable operational failure, not a `FAILED` verdict with a rejection code.**

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement the four methods**

Each is `providerRequest` plus the matching mapper. No hand-rolled fetch — the platform helper already carries the timeout, bounded retry, circuit breaker and redaction. `provider` is `'YOUVERIFY'`.

- [ ] **Step 4: Run the client tests, then lint and typecheck the package**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(trust): call youverify for nin, bvn, cac and bank name-match"
```

---

## Task 6: Webhook signature and the ingest surface

**Files:**

- Create: `apps/backend-api/src/modules/trust/infrastructure/providers/youverify.signature.ts`
- Create: `apps/backend-api/src/modules/trust/infrastructure/postgres/schema/provider-webhooks.ts`
- Create: `apps/backend-api/drizzle/0056_trust_provider_webhooks.sql` (generated)
- Modify: `apps/backend-api/src/modules/trust/infrastructure/postgres/schema/requests.ts`
- Test: `apps/backend-api/test/modules/trust/youverify-signature.test.ts`

**Interfaces:**

- Produces: `verifyYouverifySignature(raw: Buffer, header: string | undefined, secret: string): boolean`; table `trust.provider_webhooks`; column `verification_requests.provider_session_ref`.

- [ ] **Step 1: Write the failing signature tests**

```ts
it('accepts a signature over the raw bytes', () => {
  /* fixed vector */
});
it('rejects a tampered body', () => {
  /* ... */
});
it('rejects a missing header', () => {
  /* ... */
});
```

Plus Review Focus 4: a body containing non-ASCII verifies on the raw bytes and **fails** when the same object is re-serialised with `JSON.stringify`.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement with `createHmac('sha256', secret)` and `timingSafeEqual`**

Hex digest. Compare lengths before `timingSafeEqual`, which throws on a length mismatch.

- [ ] **Step 4: Add the schema, with a full delivery lifecycle**

`trust.provider_webhooks`. Modelled on `ledger.payment_provider_webhooks` but with an explicit
status, because that table records _received_ and _processed_ and nothing between — so a worker
that dies mid-job leaves a row indistinguishable from one that never started.

New enum `trust.webhook_status`: `RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`, `SKIPPED`.

| Column                                        | Purpose                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                                          | `bigserial` primary key                                                         |
| `provider`, `provider_event_id`, `event_type` | identity of the delivery                                                        |
| `payload`                                     | `jsonb`, the **full** body, written before anything is queued                   |
| `signature_valid`                             | whether the HMAC check passed; **no CHECK constraint**, unlike the ledger table |
| `raw_body_sha256`                             | digest of the bytes as they arrived, for invalid-signature rows                 |
| `status`                                      | the lifecycle above                                                             |
| `received_at`                                 | set on insert                                                                   |
| `processing_started_at`                       | set on the move to `PROCESSING`                                                 |
| `finished_at`                                 | set on `PROCESSED`, `FAILED` or `SKIPPED`                                       |
| `processing_error`                            | why it stopped without acting                                                   |
| `attempts`                                    | incremented on each move into `PROCESSING`                                      |
| `duplicate_count`                             | replays absorbed by the dedup index                                             |

Indexes: unique on `(provider, provider_event_id)`; partial on `received_at WHERE status IN
('RECEIVED','PROCESSING')` for the stale sweep.

**Every status transition is a guarded UPDATE that reports whether it applied** — the defect
shape T-050's review found three times over. Specifically:

- `RECEIVED|FAILED → PROCESSING` carries `WHERE id = $1 AND status IN ('RECEIVED','FAILED')`. Not
  applied means another worker holds it: stop, do not process.
- `PROCESSING → PROCESSED|FAILED|SKIPPED` carries `WHERE id = $1 AND status = 'PROCESSING'`.

**A delivery that fails the signature check is stored, not refused.** The ledger's
`payment_provider_webhooks` forbids this with a CHECK that `signature_valid` is always true; this
table deliberately does not, because a rotated or mistyped webhook key otherwise makes deliveries
vanish with no symptom but verifications that never resolve — the exact failure this lifecycle
exists to surface. Such a row is written at `SKIPPED`, is **never enqueued**, and stores a
truncated payload (first 4 KB) plus `raw_body_sha256` rather than the whole body, because the
route is public and this is the one unauthenticated write surface in the module. The existing
600/min/IP rate limit bounds it.

`SKIPPED` is terminal and not retried — a delivery naming a reference that does not exist will
never become placeable, so retrying it forever only hides it.

Also add `verification_requests.provider_session_ref` with a partial unique index over open
requests.

- [ ] **Step 5: Generate and review the migration, then run `pnpm migration:safety`**

- [ ] **Step 6: Run the signature tests and the db tests**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(trust): add the youverify webhook signature check and dedup table"
```

---

## Task 7: The webhook route and the resolve job

**Files:**

- Create: `apps/backend-api/src/modules/trust/http/webhook.routes.ts`
- Create: `apps/backend-api/src/modules/trust/services/webhookIngest.service.ts`
- Create: `apps/backend-api/src/modules/trust/jobs/resolve-liveness.job.ts`
- Modify: `apps/backend-api/src/modules/trust/domain/queues.ts`, `module.ts`
- Test: `apps/backend-api/test/modules/trust/youverify-webhook.int.test.ts`

**Interfaces:**

- Consumes: `verifyYouverifySignature` (Task 6); `rawBody` and `WEBHOOK_PATH_PREFIX` from `platform/http/raw-body.js`; `applyLivenessOutcome`, `evaluateLevel`, `pushOutcome` from the existing job helpers.
- Produces: `POST /v1/webhooks/youverify`; `TRUST_QUEUES.RESOLVE_LIVENESS = 'trust.resolve-liveness'`; `ResolveLivenessJob { webhookId: string }` — the table's id is `bigserial`, so the job carries it as a string because BullMQ job data must be JSON-serialisable and `bigint` is not.

- [ ] **Step 1: Write the failing integration tests**

Needs `KOMTRU_INFRA_TESTS=1` and an agent-specific `KOMTRU_TEST_DB_PREFIX`.

- a signed delivery resolves a pending liveness request and grants level 2
- a replay of the same delivery grants nothing a second time
- an unsigned delivery is **stored at `SKIPPED` with `signature_valid` false**, is never enqueued, and resolves nothing
- an unsigned delivery stores a truncated payload and a `raw_body_sha256`, not the whole body
- **Review Focus 1:** a delivery for an already-`EXPIRED` request grants nothing and does not move it back
- **Review Focus 2:** a delivery whose reference is absent, unknown, or another user's is acknowledged 200, records a `processing_error`, and resolves nothing

- [ ] **Step 2: Run them and watch them fail**

Run: `KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=yv pnpm --filter @komtru/backend-api exec vitest run test/modules/trust/youverify-webhook.int.test.ts`

- [ ] **Step 3: Implement the route**

Signature over `rawBody(ctx.req)` **before** anything is stored. `scope: 'PUBLIC'`, `retryable: false`, IP rate limit `{ points: 600, durationSeconds: 60, by: ['ip'] }`. Assert at module load that the path sits under `WEBHOOK_PATH_PREFIX`, as the ledger route does. Return `{ received: true }` without waiting on the job.

- [ ] **Step 4: Implement the ingest service and the resolve job**

Ingest, in this order and no other: verify the signature over the raw bytes, insert the row, then
enqueue only if the signature was valid, then return 200. A valid delivery is stored at
`RECEIVED` with the **full** payload; an invalid one is stored at `SKIPPED` with a truncated
payload and its digest, and nothing is queued. The row exists before the job does, so a
delivery is never lost to a Redis failure between the two.

Resolve job:

1. Move the row `RECEIVED → PROCESSING`. If the guarded update did not apply, another worker has
   it — return without processing.
2. Look up the request by `provider_session_ref`; re-check it is still `PROVIDER_PENDING` and
   belongs to the expected user.
3. Run the existing tail: `applyLivenessOutcome`, then `evaluateLevel` when it passed, then
   `pushOutcome`.
4. Move the row to `PROCESSED` on success, `FAILED` with a `processing_error` when the job threw
   and may be retried, or `SKIPPED` when the delivery can never be placed (unknown reference, a
   request already decided).

- [ ] **Step 5: Add the stale-processing sweep**

A row left in `PROCESSING` past a bounded age means the worker died holding it. The sweep returns
such rows to `FAILED` so they can be retried, up to a bounded `attempts`, after which they stay
`FAILED` and are visible rather than silently re-queued forever. Reuse the existing scheduler
registration pattern in `module.ts`.

- [ ] **Step 6: Check the sweep window against the webhook retry window**

Spec §8. `requestTtlMinutes` governs when `expire-stale.job.ts` closes an open request as
`EXPIRED`, which publishes `trust.verification.rejected`. If that fires before Youverify has
finished retrying a delivery, a successful liveness check reads to the user as a rejection they
never earned. Read the current TTL, compare it to the retry window observed in Task 1, and raise
the TTL if it is shorter. Add a test that a delivery arriving inside the TTL still resolves.

- [ ] **Step 7: Run the integration tests**

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(trust): resolve liveness checks from signed youverify webhooks"
```

---

## Task 8: The liveness session endpoint and the VF1 entry point

**Files:**

- Modify: `apps/backend-api/src/modules/trust/http/{routes,controllers,validations}.ts`
- Modify: `packages/api-client/src/react/account.ts`
- Modify: `apps/web-app-ui/src/account/Verification.tsx:134-149`
- Test: `apps/backend-api/test/modules/trust/liveness-session.test.ts`, `apps/web-app-ui/test/account/Verification.test.tsx`

**Interfaces:**

- Consumes: Task 7's `provider_session_ref` column.
- Produces: `POST /verification/liveness/session` returning `{ publicMerchantKey, sandbox, reference }`; `useStartLivenessSession()` in `api-client`.

- [ ] **Step 1: Write the failing backend test**

The endpoint creates a request, parks it at `PROVIDER_PENDING`, and returns a reference that is **not** the request UUID and is unguessable (assert it is not derived from any column the caller can see).

- [ ] **Step 2: Write the failing UI tests**

With `requirements.identifier` false and nothing in flight, the screen renders a **"Verify your ID"** control — today it renders only "Nothing to fix". With the identifier done and liveness outstanding, it renders **"Take a selfie check"**. With both done, the existing "You're verified" is unchanged.

- [ ] **Step 3: Run both and watch them fail**

- [ ] **Step 4: Implement the endpoint**

Mint the reference with the platform's id helper; store it on the request row. Rate-limit per user: each session is a billable provider interaction.

- [ ] **Step 5: Implement the UI**

Load the SDK lazily from CDN on click — it is a browser global and does not belong in the bundle. Wire `onSuccess`/`onFailure`/`onClose` to UI state **only**; neither writes a verdict. The screen then waits on the existing socket push. Remove the selfie `FileDropzone` from the liveness path; leave the rejection resubmit path untouched.

- [ ] **Step 6: Run the touched tests; lint and typecheck only the touched packages**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(trust): let a user start id and liveness verification from VF1"
```

---

## Task 9: Staging cutover

- [ ] **Step 1: Set the four variables on the staging backend**

`/srv/komtru/.env.backend` is root-only. `TRUST_KYC_PROVIDER=YOUVERIFY`, `YOUVERIFY_BASE_URL=https://api.sandbox.youverify.co`. Local stays `FAKE`.

- [ ] **Step 2: Register the webhook**

Cowork dashboard, Settings → API KEY / Webhook: `https://staging-api.komtru.com/v1/webhooks/youverify`. Send the dashboard's test event and confirm a 200.

- [ ] **Step 3: Capture the first real delivery and fold it into the fixtures**

Replace any guessed field in `liveness-webhook.json` with what actually arrived, and re-run Task 7's tests against it.

- [ ] **Step 4: Walk the flow in a browser**

Sign in on staging, start a verification from `/account/verification`, complete the SDK, and confirm the screen updates from the socket push without a reload.

- [ ] **Step 5: Merge to `staging` and read the workflow**

Conventional merge message: `chore(merge): merge f-045-youverify-kyc`. Never push to `main`.

- [ ] **Step 6: Update the feature map**

Record against F-045 and F-040 what is now real and what is still fake, then run `pnpm progress:write`.
