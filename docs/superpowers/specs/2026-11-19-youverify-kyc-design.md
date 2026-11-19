# Youverify as the KYC provider — design

**Date:** 2026-11-19
**Feature:** F-045 (Verify yourself) and F-040 (merchant certification)
**Backend seam:** `KycProviderAdapter`, built by T-050 and extended by T-051
**Status:** design approved in conversation; implementation plan not yet written

---

## 1. What this is

Komtru has never made a real identity check. `TRUST_KYC_PROVIDER=FAKE` is the only
provider that has ever answered, both deployed backends run `NODE_ENV=development`
specifically because `loadConfig` refuses to boot a production process on the fake, and
no user can start a verification at all: the submission forms on VF1 render only inside
a rejection branch, so a person who has never verified sees "Nothing to fix" and no
button.

This design makes Youverify the real provider across all five adapter methods, and adds
the missing entry point so a user can start.

### Goal

A signed-in user taps a button on `/account/verification`, proves their identity with a
NIN or BVN and a liveness check, and reaches verification level 2. A merchant submits an
RC number and reaches level 3. Both outcomes are attested by a real vendor and recorded
as `provider = 'YOUVERIFY'`.

### Non-goals

- The J2 "Verification Details" screen and the rest of T-126. The start button goes on
  VF1, which exists and is already reachable from Account.
- Address proof and social proof. §6.6 gives `address_checks` no provider columns at
  all; social proof has no purchasable vendor (see `socialProofAdapter`).
- Dojah. Its adapter stays as the documented seam it is.

---

## 2. What already exists

Most of this work is implementation behind a seam that was built for it.

| Piece                                                               | State                                |
| ------------------------------------------------------------------- | ------------------------------------ |
| `KycProviderAdapter` — all five methods                             | built, T-050 + T-051                 |
| `POST /verification/{nin,bvn,bank-account}`, CAC submission         | built, live routes                   |
| Identity, business and bank-match jobs                              | built, synchronous, call the adapter |
| `decideLevelChange`, append-only level log, duplicate detection     | built                                |
| Rejection taxonomy and VF1 failure copy                             | built                                |
| Socket push on outcome (`VERIFICATION_SOCKET_EVENT`)                | built                                |
| `YOUVERIFY` as a `kyc_provider` enum member                         | already present                      |
| Webhook ingest pattern (raw-body signature, dedup, queue, fast 200) | built in `ledger` for Paystack       |

What does not exist: any real provider call, any webhook in `trust`, and any way for a
first-time user to begin.

---

## 3. Decisions

### D1 — Our forms, Youverify's SDK for liveness only

Youverify's web SDK (`youverify-web-sdk`, 2.2.1, zero dependencies) offers three
modules: `vForm`, `liveness` and `documentCapture`. We use **`liveness` only**.

`vForm` would own the whole journey and need the least code, but its fields, copy and
validation live in Youverify's dashboard rather than this repository. That would bypass
`domain/rejection.ts`, the VF1 resubmit flow and the reference screens — "what does the
user see when a check fails" would stop being a question this codebase can answer, and
the vendor would become load-bearing in the UI, which M6 D3 explicitly designed against.

Identity, CAC and bank match stay server-to-server, which is how the existing jobs
already work.

### D2 — The browser decides nothing

The SDK is keyed by `publicMerchantKey`, which is public by design and sits in browser
code. Its liveness `onSuccess` callback takes **no payload** — it reports that the modal
finished, not that the person passed, and anyone can invoke it from a console.

Therefore: `onSuccess` only moves the UI to "we're checking". `onFailure` offers a
retry. Neither writes anything. The verdict exists only when a signed webhook delivers
it. This is the same posture as the backend's standing rule that the client is never
trusted to say which data it may see.

### D3 — Liveness resolves through a webhook, and this closes an existing hole

`checkLiveness` today is a call that returns a verdict. With the SDK the browser
captures and Youverify pushes, so the check inverts: the request is parked at
`PROVIDER_PENDING` when the session is minted, and a webhook resolves it.

`CheckVerdict` already has `PENDING` as a first-class answer, and
`liveness_checks.selfie_storage_ref` is already nullable — the schema anticipated this.
M20 drops out of the liveness path entirely, because Youverify captures the selfie and
we never hold the bytes. That dissolves the "stream bytes or hand over a signed URL?"
question T-050 parked rather than answering it.

It also closes a real defect. Today nothing resumes a `PROVIDER_PENDING` request:
`outcome.ts` returns early on it, and the only exit is the expiry sweep, which publishes
`trust.verification.rejected`. A slow provider currently reads to the user as "you were
rejected". The webhook is what makes `PENDING` mean what it says.

### D4 — The correlation reference is server-minted and opaque

`metadata` is the SDK's documented channel for passing data through to the webhook, and
it travels through the browser. A user could therefore echo back a reference that is not
theirs.

So the reference is an unguessable random token minted server-side, stored on the
request row, bound to the submitting user, and re-checked as still `PROVIDER_PENDING`
when the webhook resolves it. It is never the request UUID.

### D5 — All five methods, in one go

`kycProvider()` returns **one** adapter for all five methods. The moment
`TRUST_KYC_PROVIDER=YOUVERIFY`, any method left refusing stops being a fake pass and
becomes a hard failure — and `POST /verification/bank-account` is a live route that
enqueues a job calling `verifyBankAccountName`.

So bank name-match is not deferrable scope. The alternative considered and rejected was
splitting the flag per method: it would let a fake keep attesting something in
production, and would require reworking `loadConfig`'s refusal to boot production on
`FAKE` into a per-method guard — which is precisely the quiet production hole that
guard exists to prevent.

### D6 — Fix `normaliseRcNumber`, which currently destroys the entity type

`normaliseRcNumber` strips `/^(RC|BN|IT|LP|LLP)/`, so `RC1487322`, `BN1487322` and
`LLP1487322` all normalise to `1487322`. Those are different registrations at CAC.

Two consequences, one pre-existing and one new:

- **Pre-existing:** `rcNumberHash` collapses distinct businesses into one duplicate key,
  so §7 can flag two unrelated merchants as the same identity.
- **New:** Youverify's advance check requires the prefix attached with no spaces, and we
  cannot reconstruct it — the type is destroyed before the value is stored.

The fix is to normalise case and separators but **keep the prefix**, and to treat a bare
number (no prefix) as its own value rather than silently equal to a prefixed one.
`isValidRcNumber` loosens accordingly. This needs a migration and a decision about rows
already written — see §6.

### D7 — The advance tier, for officers

`POST /v2/api/verifications/global/company-advance-check` returns a `keyPersonnel` array
with name, designation and appointment/resignation dates, which answers `officersMatch`.
The basic endpoint returns name, status and type with no officer data, which does not.

So the CAC call uses the advance tier. This makes `decideBusinessOutcome`'s "officer
unknown, send it to a human" the exception rather than the normal path, which is the
question T-050's Dojah header called "the one to settle first". It carries a per-call
cost the owner has accepted.

**This decision is conditional on an unconfirmed permission.** The issued API key grants
"Company Lookup", which reads like the basic Nigerian company endpoint rather than the
global `company-advance-check`. If the key cannot reach the advance tier, `keyPersonnel`
is unavailable, `officersMatch` returns undefined on every call, and every CAC check
routes to a human reviewer — which is a working flow but not an automatic one, and it
puts the whole of merchant certification behind a queue that T-052 built but no one is
staffed to work. Confirm before implementing; if the tier is unavailable, D7 is void and
the owner needs to decide between buying the tier and accepting manual review.

---

## 4. Architecture

### The synchronous four

`createYouverifyClient` implements `verifyNin`, `verifyBvn`, `verifyBusiness` and
`verifyBankAccountName` as ordinary request/response calls through `providerRequest()`
from `platform/providers/http.ts` — which already carries the timeout, bounded retry,
circuit breaker and redaction, so the adapter hand-rolls no fetch.

Nothing else changes. The existing endpoints, jobs, decision rules, duplicate detection
and VF1 copy all stay exactly as they are. This is the config flip the seam was built
for.

Following the T-028 split the Dojah header prescribes:

| File                     | Role                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `youverify.requests.ts`  | pure: URL, headers, body construction                                    |
| `youverify.mapping.ts`   | pure: their JSON onto the four result types                              |
| `youverify.signature.ts` | pure: HMAC-SHA256 hex, timing-safe compare                               |
| `youverify.client.ts`    | the seam; the only file importing the other three plus `providerRequest` |

`youverify.mapping.ts` carries the one piece of vendor-specific knowledge the rest of
the module must not contain: which of Youverify's statuses mean `LOW_CONFIDENCE` rather
than `FAILED`, and which map to which `RejectionCode`.

### The liveness path

1. **`POST /verification/liveness/session`** — creates the request row, moves it
   `SUBMITTED` to `PROVIDER_PENDING`, mints the reference (D4), and returns
   `{ publicMerchantKey, sandbox, reference }`. No file upload.
2. **Browser** — lazily loads the SDK from CDN on click (it is a browser global, so it
   does not belong in the bundle), runs `YouverifySDK.liveness` with
   `metadata: { reference }`, and on any callback shows "we're checking".
3. **`POST /v1/webhooks/youverify`** — verifies `x-yv-signature` as an HMAC-SHA256 hex
   digest over the **raw bytes** (`rawBody(ctx.req)`, never a re-serialised body; the
   vendor's own Node sample gets this wrong and hashes `JSON.stringify(req.body)`),
   inserts the dedup row, queues a job, returns 200 without waiting. Mounted under the
   existing `WEBHOOK_PATH_PREFIX` as `PUBLIC` scope, IP rate-limited, modelled directly
   on `ledger/http/webhookRoutes.ts`.
4. **`jobs/resolve-liveness.job.ts`** — finds the request by reference and runs the
   existing tail unchanged: `applyLivenessOutcome` then `evaluateLevel` then
   `pushOutcome`. The last already pushes over the socket, so the screen the user is
   watching updates itself.

`run-liveness-check.job.ts` keeps its current synchronous body for the FAKE adapter;
its `if (!selfieStorageRef) throw` guard must not fire on the Youverify path, which
never has one.

### The UI

On `/account/verification`, in the branch that currently renders "Nothing to fix":

- `requirements.identifier` false, nothing in flight: **"Verify your ID"**, opening the
  existing NIN/BVN form — the one that today only appears inside a rejection.
- identifier done, `requirements.liveness` false: **"Take a selfie check"**, which calls
  the session endpoint and starts the SDK.
- both done: the existing "You're verified".

The `Failure` resubmit path is untouched. The selfie `FileDropzone` is removed from the
liveness path, since Youverify captures.

---

## 5. Data

Migration **0056** (0055 is current):

- `trust.provider_webhooks` — mirroring `ledger.payment_provider_webhooks`: provider,
  provider event id, event type, parsed payload, `signature_valid` with its CHECK,
  received/processed timestamps, processing error, duplicate and sweep counters, a
  unique dedup index on (provider, event id) and a partial index on unprocessed rows.
- `verification_requests.provider_session_ref` — the D4 reference, with a partial unique
  index over open requests.
- The `normaliseRcNumber` change from D6 (see §6).

No enum migration: `YOUVERIFY` is already a `kyc_provider` member. `selfie_storage_ref`
stays null on the Youverify path, which the column already permits.

Idempotency on the dedup key: the docs name `eventId` for KYT events and suggest
`data.id` or `data.verificationId` otherwise, and the envelope example does not show
`eventId` at all. The real key must be read off a captured delivery, not guessed — see
§8.

---

## 6. The RC number migration

D6 changes what `normaliseRcNumber` returns, which changes what `rcNumberHash` produces.
Rows written under the old rule hash differently from the same business submitted again
tomorrow.

The decision this needs from the owner: existing `business_verifications` rows have lost
their prefix irrecoverably. The options are to leave them (old rows keep the old hash and
simply never match a new submission, which fails open — a duplicate goes undetected), or
to re-verify them against Youverify on migration (costs one call each, and there are few
enough today that this is cheap).

**Recommendation:** leave them and log a count, because the population is small and a
missed duplicate flag is reviewable where a surprise migration-time spend is not. Confirm
before implementing.

---

## 7. Configuration and secrets

New variables, all optional at the schema level so both processes still boot without
them (the pattern every other provider credential follows):

| Variable                        | Used by                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `YOUVERIFY_SECRET_TOKEN`        | the `token` header on all four server-to-server calls                |
| `YOUVERIFY_PUBLIC_MERCHANT_KEY` | returned to the browser for the SDK                                  |
| `YOUVERIFY_WEBHOOK_SECRET`      | `x-yv-signature` verification; confirmed distinct from the API token |
| `YOUVERIFY_BASE_URL`            | `api.youverify.co` or `api.sandbox.youverify.co`                     |

The issued key's scopes cover NIN, BVN, bank account and company lookup — four of the
five methods. Liveness is driven by the SDK under `publicMerchantKey` and is expected not
to draw on the API key's scopes at all; §10 question 1 confirms that. "Tax ID lookup" and
"case management" are granted but unused: this module runs its own review queue (T-052)
and verifies no TINs.

`TRUST_KYC_PROVIDER` gains `YOUVERIFY`; `KycProviderFlag` and `kycProvider()` gain one
branch each, which refuses at boot naming the missing variables — the shape the DOJAH
branch already uses. `test/config/env-example-parity.test.ts` will fail until
`.env.example` documents all four.

Secrets live in `docs/specs/backend-apis.env`, which is git-ignored. They are never
printed in a log, a PR body or a reply.

Webhook URLs to register in the Cowork dashboard (Settings, API KEY / Webhook); both
hosts are already public HTTPS, so no DNS work is needed:

- sandbox: `https://staging-api.komtru.com/v1/webhooks/youverify`
- production: `https://api.komtru.com/v1/webhooks/youverify`

### Environments, and how a webhook is developed against

Youverify needs a publicly reachable HTTPS URL with no client authentication. The local
backend runs on `localhost:7813`, which it cannot reach — and the Cowork dashboard takes
**one** callback URL per account, so a developer pointing the sandbox at their own tunnel
takes it away from staging while they work.

So the environments split by provider rather than by tunnel:

| Environment | `TRUST_KYC_PROVIDER`     | Liveness path                                            |
| ----------- | ------------------------ | -------------------------------------------------------- |
| local       | `FAKE`                   | the existing synchronous fake; no webhook, works offline |
| staging     | `YOUVERIFY` (sandbox)    | the real webhook at `staging-api.komtru.com`             |
| production  | `YOUVERIFY` (production) | the real webhook at `api.komtru.com`                     |

Local development therefore never needs a tunnel and never competes for the sandbox's
single callback URL. The fake adapter keeps answering synchronously, which is what makes
the whole flow testable on a laptop with no network.

What local development _does_ need is a way to exercise the webhook code itself. That is
the integration test (§9), which posts a correctly signed body straight at the route —
built from deliveries captured once on staging and kept as fixtures. A real delivery is
only ever exercised on staging, and it is captured the first time it arrives so the
fixtures stay honest.

Consequence worth stating plainly: **a liveness session started on a laptop against the
real sandbox would never resolve** — the request would sit at `PROVIDER_PENDING` until
the sweep expired it and the user saw a rejection. Keeping local on `FAKE` is what
prevents that, and it is a configuration mistake worth guarding at boot if it proves easy
to make.

A knock-on worth stating: a real provider is what allows both backends to stop running
`NODE_ENV=development`, which they do today only because the fake refuses to boot under
production. Flipping that is a separate change with its own blast radius (it also
defaults SMS and push to live-fire) and is **not** part of this work.

---

## 8. Error handling

- **The sweep window must exceed Youverify's webhook retry window.** Otherwise a slow
  but successful liveness check still closes as `EXPIRED` and publishes
  `trust.verification.rejected` — the T-050 known minor, which this change makes newly
  reachable on the main path rather than only under outage.
- **`402 Insufficient fund` is not a rejection.** It means the Youverify balance is
  empty. It must never render to a user as "you were not approved"; it is an
  operational signal, and it is the natural first publisher of
  `verification.provider_degraded`, which T-050 left declared and unpublished.
- **An unknown reference in a webhook** is recorded in `processing_error` and
  acknowledged with 200, not retried — a delivery we cannot place will never become
  placeable.
- **A replayed delivery** is absorbed by the dedup index and grants nothing a second
  time.

---

## 9. Testing

Per the rule T-050 set and the reason the Dojah mapper was never written: **capture real
sandbox responses first**, then write the mappers against them. The sandbox test data
Youverify documents (NIN/BVN `12345678901`) is the starting point.

- `youverify.mapping.ts` — unit tests over recorded fixtures, one per verdict branch,
  including whichever statuses turn out to mean `LOW_CONFIDENCE`.
- `youverify.signature.ts` — a fixed known vector, plus a test that a re-serialised body
  fails where the raw bytes pass.
- `youverify.requests.ts` — URL and header construction, including the RC prefix.
- `normaliseRcNumber` / `rcNumberHash` — that the five prefixes no longer collide.
- Integration (`*.int.test.ts`, `KOMTRU_INFRA_TESTS=1`): a signed delivery resolves a
  pending liveness request and grants level 2; a replay of the same delivery grants
  nothing; an unsigned delivery is refused and stores nothing.

Per the repo rule, the implementer runs only these and lints only what it touched. CI on
`staging` runs the suites.

---

## 10. Open questions

> **Answered 2026-11-19 by probing the sandbox (Task 1).** Fixtures live in
> `apps/backend-api/test/fixtures/youverify/`. The findings below supersede the
> questions that follow where they disagree.
>
> **A. `premiumNin`, not `premiumNIN`.** The capitalised form is refused with a 400
> `ValidationError: "premiumNIN" is not allowed`. Question 5 closed.
>
> **B. NIN and BVN both work**, at `/v2/api/identity/ng/nin` and `/v2/api/identity/ng/bvn`,
> synchronous, verdict inline. The adapter seam fits as designed.
>
> **C. `allValidationPassed` is true when nothing was validated — a trap.** A NIN submitted
> with no `validations.data` returns `status: "found"`, `dataValidation: false` and
> **`allValidationPassed: true`**. And `dataValidation: true` means validation _ran_, not that
> it _passed_: a submission whose first and last name both mismatch still returns
> `dataValidation: true`, with `allValidationPassed: false` and the per-field booleans false.
> **Consequence:** the adapter must always send `validations.data`, and must read the per-field
> `validations.data.*.validated` booleans rather than either aggregate. Reading `dataValidation`
> as a pass, or omitting the claim, would grant level 2 to anyone who types a stranger's valid
> NIN. This supersedes the weaker framing in Review Focus item 5.
>
> **D. CAC is NOT available on this key.** Both `/v2/api/verifications/ng/company/basic` and
> `/v2/api/verifications/global/company-advance-check` answer **403 Permission denied** with
> well-formed requests. Question 2 closed, negatively: **D7 is void**, and merchant
> certification cannot use Youverify until the account is entitled.
>
> **E. Youverify requires the entity prefix, confirmed by its own validator:**
> `Invalid registration number. Valid format => RCxxxx, BNxxxxx, ITxxxxx, LPxxxxx or LLPxxxxx`.
> So D6 is not merely a latent hash defect — today's `normaliseRcNumber` output would be
> rejected on every CAC call. D6 is a hard prerequisite, not a cleanup.
>
> **F. Bank name-match endpoint not found.** Four plausible paths under
> `/v2/api/identity/ng/` and `/v2/api/verifications/ng/` all return 404. The real path must come
> from Youverify.
>
> **G. Per-ID rate limit, newly discovered.** Repeating a NIN within ten minutes returns
> **429** `Too many requests for this ID number in a short time. Please try again after 10mins.`
> A user who retries after a failure will hit this, and it must not render as a rejection.
>
> **H. Liveness entitlement still unconfirmed** — it is driven by `publicMerchantKey` through the
> browser SDK, so the API key cannot be probed for it. Needs a dashboard check.

1. **Is liveness entitled on this account at all?** The issued API key lists case
   management, NIN, BVN, bank account, company lookup and tax ID — **no liveness**. The
   web SDK authenticates with `publicMerchantKey` rather than the API token, so the key's
   permissions may simply not govern it. But if liveness is not enabled on the account,
   level 2 is unreachable by design (`domain/levels.ts` requires an identifier **plus**
   liveness) and this whole design stalls on its most important half. **Confirm first,
   before anything else here is built.**
2. **Can the key reach `company-advance-check`?** See D7. If not, officer matching is
   manual and merchant certification needs a staffed review queue.
3. **Does the standalone liveness module match the face against the NIN photo, or only
   prove a live human is present?** `liveness_checks.matched_against` and §4 both assume
   a match — §4 forbids a liveness check with nothing to match. If Youverify's module is
   liveness-only, then either the NIN call also carries `validations.selfie`, or
   `matched_against` stops claiming something it does not check. **Resolve by capturing a
   real sandbox response before writing the mapper.**
4. **The RC backfill** — §6, owner's call.
5. **`premiumNIN` vs `premiumNin`** — Youverify's schema and its own example disagree on
   the casing. Confirm against a real call.
6. **The webhook dedup key** — read it off a captured delivery rather than the docs,
   which are inconsistent about where `eventId` lives.

Questions 1 and 2 are account-entitlement questions for Youverify and gate the work.
Questions 3, 5 and 6 are answered by the same action: make real sandbox calls and record
what comes back, before any mapper is written.

---

## 11. Ticket impact

- **T-050 / T-051** are Done and stay Done; this is the provider their seam was built
  for.
- **F-045** is marked Done but its named outcome — "Verify yourself" — is not reachable
  by any user today. This work is what makes that status true rather than overstated.
- **F-040** merchant certification gains a real CAC check, and its open bank name-match
  criterion (unsigned off since 2026-11-15, where SO4 shows the reference banner while
  enforcing nothing) is closed by D5.
- This work needs its own ticket; it is not inside any existing one.
