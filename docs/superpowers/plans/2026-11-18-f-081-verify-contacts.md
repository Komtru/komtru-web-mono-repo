# F-081 — Verify your email and phone from /account/verification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in person add and verify their email address and their phone number from `/account/verification`,
with a badge per channel, so an account can reach `CONTACT_VERIFIED` without re-registering.

**Architecture:** Four `/me` routes over one service that handles both channels, because the invariants (never touch a
proven contact, never let two accounts verify one address) are the same for each and belong in one place. The OTP
machinery, the per-destination send budget and the level transition already exist and are reused unchanged. No migration.

**Tech Stack:** Node 22, Express, Drizzle, Zod, Vitest, Next 15, React 19, `@komtru/ui-kit`.

**Spec:** No separate spec document. The design is §Design below; the ticket entry is `docs/tickets/FEATURE_MAP.md`
(F-081), added in Task 0.

## Design

Scope is **add + verify only** (owner's call, 2026-11-18). Changing an _already verified_ address stays impossible.
That single rule is what keeps this off the account-takeover path: `start` only ever writes an **unverified** row, so no
request in this feature can move a contact somebody has already proven. No step-up gate is needed, unlike F-045's phone
change.

Three account states exist in the wild, because `/auth/register` takes `channel: PHONE` with `email` optional:
no address on file, an unverified address, a verified one. `start` handles the first two (supplying an address when none
is on file; replacing the unverified one when it was a typo) and refuses the third.

What already exists and must NOT be rebuilt:

- `EMAIL_VERIFICATION` and `PHONE_VERIFICATION` are already in the `identity.otp_purpose` enum, and currently unused.
- `issueOtp` / `consumeOtp` (`identity/services/otp.service.ts`) carry code issue, expiry, the five-attempt cap and the
  per-destination send budget that F-045 added as the toll-fraud cap.
- `applyVerificationProgress` (`identity/services/contact.service.ts:306`) moves `status` to ACTIVE on the first proven
  channel and `verification_level` to `CONTACT_VERIFIED` only when BOTH are proven, and publishes the event.
- The database already holds the uniqueness invariant: `user_emails_verified_unique` is UNIQUE on `email_normal`
  WHERE `verified_at IS NOT NULL`, with the twin `user_phones_verified_unique` on `phone_e164`. Two accounts may hold
  the same _unverified_ address; only one can ever verify it.

## Global Constraints

- Nothing is pushed to any remote (owner's hard rule until T-183). Local merge into `main` only.
- Conventional commits; the subject starts with a lower-case verb. Merge commits are `chore(merge): merge F-081 ...`.
- No migration. Both tables already carry every column and index this feature needs.
- No step-up token on any route in this feature.
- Email is normalised with `normaliseEmail` from `src/platform/identifiers.ts` before it is stored, compared or hashed;
  phone with the matching `normalisePhone`. The stored `email_normal` is what uniqueness is decided on.
- Rate limits copy F-045's: start is `{ points: 5, durationSeconds: 3600, by: ['user','ip'] }`, confirm is
  `{ points: 10, durationSeconds: 60, by: ['user','ip'] }`.
- Outcome-to-HTTP mapping follows the existing `verifyOtp` mapping in
  `identity/http/controllers/registration.controller.ts`; do not invent new codes for `WRONG_CODE`, `EXPIRED`,
  `NO_ATTEMPTS_LEFT` or `UNKNOWN`.

## Review Focus

1. **Two accounts race on one address.** Both hold `foo@x.com` unverified, both confirm. The loser hits the partial
   unique index; it must answer 409 `CONTACT_TAKEN`, never a 500. Pinned in Task 3.
2. **Start on an already-verified channel.** Must answer 409 `ALREADY_VERIFIED` and issue no code — otherwise this
   feature quietly becomes the change-address flow the owner excluded. Pinned in Task 2.
3. **Case and whitespace.** `Foo@X.com` and `foo@x.com` are one address. Without normalising before the uniqueness
   check, both verify and the invariant is bypassed. Pinned in Task 2.
4. **A challenge that is not yours.** Confirm with another user's `challengeId`, or one issued for the other channel,
   must answer `UNKNOWN` and verify nothing. Pinned in Task 3.
5. **Send budget spent.** `issueOtp` returns `delivered: false, throttled: true`; the response must say so truthfully
   rather than claim a code was sent. Pinned in Task 2.

---

### Task 0: Ticket entry

**Files:**

- Modify: `docs/tickets/FEATURE_MAP.md`

- [ ] **Step 1: Add the F-081 entry** after F-080, in the format the other `#### F-0xx` entries use: Journey
      (Account, trust & support), Actor (buyer, seller), Backend scope, Frontend scope, Status (In progress),
      Depends on (F-045), MVP (yes). State in the note that scope is add + verify only and that changing a verified
      address is deliberately excluded.

- [ ] **Step 2: Commit**

```bash
git add docs/tickets/FEATURE_MAP.md docs/superpowers/plans/2026-11-18-f-081-verify-contacts.md
git commit -m "docs(tickets): add F-081 for contact verification"
```

---

### Task 1: Contact state on `GET /me`

The screen cannot draw a badge from `verificationLevel` alone — it needs per-channel state. `getMe` currently selects
four columns from `users` and knows nothing about emails or phones.

**Files:**

- Modify: `apps/backend-api/src/modules/identity/http/validations/lifecycle.validation.ts` (`meResponse`, ~line 40)
- Modify: `apps/backend-api/src/modules/identity/http/controllers/lifecycle.controller.ts` (`getMe`, line 45)
- Test: `apps/backend-api/test/modules/identity/http/me.routes.int.test.ts` (add to the existing suite)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `meResponse.contacts`, shape
  `{ email: { present: boolean; masked: string | null; verified: boolean }, phone: { same } }`. Tasks 5 and 6 read it.

- [ ] **Step 1: Write the failing test**

```ts
it('reports each contact channel, masked, with its verified state', async () => {
  // a user with a verified phone and an unverified email
  const body = await getMe(user);
  expect(body.contacts.phone).toEqual({
    present: true,
    masked: expect.stringContaining('*'),
    verified: true,
  });
  expect(body.contacts.email).toEqual({
    present: true,
    masked: expect.stringContaining('*'),
    verified: false,
  });
});

it('reports a channel the account does not have at all', async () => {
  const body = await getMe(phoneOnlyUser);
  expect(body.contacts.email).toEqual({ present: false, masked: null, verified: false });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/http/me.routes.int.test.ts`
Expected: FAIL — `contacts` is undefined.

- [ ] **Step 3: Add `contacts` to `meResponse`, then populate it in `getMe`**

Read the primary row per channel from `identity.user_emails` / `identity.user_phones`. Mask with the same helper the
OTP responses use for `maskedDestination`; if it is not exported, export it rather than writing a second masking rule.

- [ ] **Step 4: Run it and watch it pass**

Run: `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/http/me.routes.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(identity): report contact channels and their verified state on /me"
```

---

### Task 2: `startContactVerification`

**Files:**

- Create: `apps/backend-api/src/modules/identity/services/contact-verify.service.ts`
- Test: `apps/backend-api/test/modules/identity/services/contact-verify.service.int.test.ts`

**Interfaces:**

- Consumes: `issueOtp` and `IssuedOtp` from `otp.service.ts`; `normaliseEmail` from `src/platform/identifiers.ts`.
- Produces:

```ts
export interface ContactVerifyDeps {
  db: Db;
  logger: Logger; /* plus OtpDeps */
}

export type ContactChannel = 'EMAIL' | 'PHONE';

export type StartContactVerificationResult =
  | {
      outcome: 'STARTED';
      challengeId: string;
      maskedDestination: string;
      expiresAt: Date;
      delivered: boolean;
    }
  | { outcome: 'ALREADY_VERIFIED' }
  | { outcome: 'NO_ADDRESS' } // none on file and none supplied
  | { outcome: 'INVALID_ADDRESS' }
  | { outcome: 'TAKEN' }; // already verified by somebody else

export async function startContactVerification(
  deps: ContactVerifyDeps,
  input: {
    userId: string;
    channel: ContactChannel;
    address?: string;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<StartContactVerificationResult>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('sends a code to the unverified address already on file', async () => {
  const result = await startContactVerification(deps, {
    userId,
    channel: 'EMAIL',
    ip: null,
    userAgent: null,
  });
  expect(result).toMatchObject({ outcome: 'STARTED', delivered: true });
});

it('replaces an unverified address when a new one is supplied', async () => {
  await startContactVerification(deps, {
    userId,
    channel: 'EMAIL',
    address: 'typo@x.com',
    ip: null,
    userAgent: null,
  });
  await startContactVerification(deps, {
    userId,
    channel: 'EMAIL',
    address: 'right@x.com',
    ip: null,
    userAgent: null,
  });
  expect(await emailsOf(userId)).toEqual([expect.objectContaining({ email_normal: 'right@x.com' })]);
});

it('refuses a channel that is already verified, and issues no code', async () => {
  const before = await challengeCount();
  expect(
    await startContactVerification(deps, {
      userId: verifiedUser,
      channel: 'PHONE',
      ip: null,
      userAgent: null,
    }),
  ).toEqual({ outcome: 'ALREADY_VERIFIED' });
  expect(await challengeCount()).toBe(before);
});

it('normalises case and whitespace before storing', async () => {
  await startContactVerification(deps, {
    userId,
    channel: 'EMAIL',
    address: '  Foo@X.com ',
    ip: null,
    userAgent: null,
  });
  expect(await emailsOf(userId)).toEqual([expect.objectContaining({ email_normal: 'foo@x.com' })]);
});

it('refuses an address somebody else has already verified', async () => {
  expect(
    await startContactVerification(deps, {
      userId,
      channel: 'EMAIL',
      address: othersVerifiedEmail,
      ip: null,
      userAgent: null,
    }),
  ).toEqual({ outcome: 'TAKEN' });
});

it('reports a spent send budget truthfully', async () => {
  // exhaust the budget for that destination first
  expect(
    await startContactVerification(deps, { userId, channel: 'EMAIL', ip: null, userAgent: null }),
  ).toMatchObject({ outcome: 'STARTED', delivered: false });
});

it('requires an address when the account has none', async () => {
  expect(
    await startContactVerification(deps, {
      userId: phoneOnlyUser,
      channel: 'EMAIL',
      ip: null,
      userAgent: null,
    }),
  ).toEqual({ outcome: 'NO_ADDRESS' });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/services/contact-verify.service.int.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `startContactVerification`**

One transaction. Lock the user row with `.for('update')` before reading the channel's rows, so two concurrent starts
cannot both insert — the same guard `startPhoneChange` uses. Refuse before writing anything when the channel is already
verified. Insert or update the unverified row (never `is_primary` on an unverified phone: the
`user_phones_change_state_unproven` check rejects it). Then `issueOtp` with the channel's purpose, and pass through
`delivered`.

- [ ] **Step 4: Run them and watch them pass**

Run: `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/services/contact-verify.service.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(identity): start email and phone verification for a signed-in user"
```

---

### Task 3: `confirmContactVerification`

**Files:**

- Modify: `apps/backend-api/src/modules/identity/services/contact-verify.service.ts`
- Test: `apps/backend-api/test/modules/identity/services/contact-verify.service.int.test.ts`

**Interfaces:**

- Consumes: `consumeOtp` and `VerifyOutcome` from `otp.service.ts`; `applyVerificationProgress` from
  `contact.service.ts`; Task 2's `ContactChannel`.
- Produces:

```ts
export type ConfirmContactVerificationResult =
  | { outcome: 'VERIFIED'; verificationLevel: string; maskedDestination: string }
  | { outcome: 'WRONG_CODE'; attemptsRemaining: number }
  | { outcome: 'NO_ATTEMPTS_LEFT' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'UNKNOWN' }
  | { outcome: 'TAKEN' };

export async function confirmContactVerification(
  deps: ContactVerifyDeps,
  input: { userId: string; channel: ContactChannel; challengeId: string; code: string },
): Promise<ConfirmContactVerificationResult>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('marks the address verified and reports the new level', async () => {
  const result = await confirmContactVerification(deps, { userId, channel: 'EMAIL', challengeId, code });
  expect(result).toMatchObject({ outcome: 'VERIFIED', verificationLevel: 'CONTACT_VERIFIED' });
});

it('leaves the level alone when only one channel is proven', async () => {
  const result = await confirmContactVerification(deps, {
    userId: emailOnlyUser,
    channel: 'EMAIL',
    challengeId,
    code,
  });
  expect(result).toMatchObject({ outcome: 'VERIFIED', verificationLevel: 'UNVERIFIED' });
});

it('answers UNKNOWN for a challenge belonging to another user', async () => {
  expect(
    await confirmContactVerification(deps, {
      userId,
      channel: 'EMAIL',
      challengeId: othersChallengeId,
      code,
    }),
  ).toEqual({ outcome: 'UNKNOWN' });
});

it('answers UNKNOWN for a challenge issued for the other channel', async () => {
  expect(
    await confirmContactVerification(deps, { userId, channel: 'PHONE', challengeId: emailChallengeId, code }),
  ).toEqual({ outcome: 'UNKNOWN' });
});

it('answers TAKEN when the address was verified by somebody else in the meantime', async () => {
  // both accounts hold it unverified; the other verifies between this start and this confirm
  expect(await confirmContactVerification(deps, { userId, channel: 'EMAIL', challengeId, code })).toEqual({
    outcome: 'TAKEN',
  });
});

it('charges an attempt on a wrong code', async () => {
  expect(
    await confirmContactVerification(deps, { userId, channel: 'EMAIL', challengeId, code: '000000' }),
  ).toMatchObject({ outcome: 'WRONG_CODE' });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/services/contact-verify.service.int.test.ts`
Expected: FAIL — `confirmContactVerification` is not exported.

- [ ] **Step 3: Implement `confirmContactVerification`**

`consumeOtp` first, then check the challenge's `userId` and `purpose` match the caller and channel — a mismatch is
`UNKNOWN`, not a verification. On a match set `verified_at` and call `applyVerificationProgress`, returning the level it
reports. Catch the unique violation from `user_emails_verified_unique` / `user_phones_verified_unique` (Postgres
`23505`) and return `TAKEN`; let every other error throw.

Note the comment on `consumeOtp`: the caller's transaction must COMMIT on a wrong code too, or the attempt is not
charged. Do not roll back a `WRONG_CODE`.

- [ ] **Step 4: Run them and watch them pass**

Run: `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/services/contact-verify.service.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(identity): confirm an email or phone verification code"
```

---

### Task 4: The four routes

**Files:**

- Create: `apps/backend-api/src/modules/identity/http/validations/contact-verify.validation.ts`
- Create: `apps/backend-api/src/modules/identity/http/controllers/contact-verify.controller.ts`
- Create: `apps/backend-api/src/modules/identity/http/routes/contact-verify.routes.ts`
- Modify: `apps/backend-api/src/modules/identity/index.ts` (import beside `phoneChangeRoutes` line 43; spread beside
  line 462)
- Test: `apps/backend-api/test/modules/identity/http/contact-verify.routes.int.test.ts`

**Interfaces:**

- Consumes: Tasks 2 and 3's two service functions and their result unions.
- Produces: `export type ContactVerifyControllerDeps = ContactVerifyDeps;` (the controller adds nothing, exactly as
  `PhoneChangeControllerDeps` does), `contactVerifyRoutes(deps: ContactVerifyControllerDeps): RouteDefinition[]`, and
  these four routes —
  `POST /me/email/verify/start`, `POST /me/email/verify/confirm`, `POST /me/phone/verify/start`,
  `POST /me/phone/verify/confirm`. Task 5 mirrors the paths and bodies.

Bodies: start is `{ address?: string }` (`z.string().trim().min(3).max(254)`); confirm is
`{ challengeId: z.uuid(), code: z.string().trim().min(1).max(64) }`. Start's response is
`{ challengeId, maskedDestination, expiresAt, delivered }`; confirm's is
`{ status: 'VERIFIED', verificationLevel, maskedDestination }`. All four are `scope: 'CONSUMER'`, `retryable: false`.

- [ ] **Step 1: Write the failing tests**

```ts
it('verifies an email end to end over HTTP', async () => {
  const started = await post('/v1/me/email/verify/start', { address: 'me@x.com' }, token).expect(200);
  const confirmed = await post(
    '/v1/me/email/verify/confirm',
    { challengeId: started.body.challengeId, code },
    token,
  );
  expect(confirmed.status).toBe(200);
  expect(confirmed.body).toMatchObject({ status: 'VERIFIED' });
});

it('answers 409 ALREADY_VERIFIED when the channel is done', async () => {
  const res = await post('/v1/me/phone/verify/start', {}, verifiedToken);
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('ALREADY_VERIFIED');
});

it('answers 409 CONTACT_TAKEN when somebody else verified it', async () => {
  /* ... */
});

it('refuses an anonymous caller', async () => {
  await post('/v1/me/email/verify/start', {}, undefined).expect(401);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/http/contact-verify.routes.int.test.ts`
Expected: FAIL — 404, routes not registered.

- [ ] **Step 3: Write the validations, controller and routes, then wire them in `index.ts`**

Map outcomes to HTTP: `ALREADY_VERIFIED` → 409 `ALREADY_VERIFIED`; `TAKEN` → 409 `CONTACT_TAKEN`; `NO_ADDRESS` → 422
`CONTACT_REQUIRED`; `INVALID_ADDRESS` → 422 `INVALID_CONTACT`. For `WRONG_CODE`, `EXPIRED`, `NO_ATTEMPTS_LEFT` and
`UNKNOWN`, copy the mapping `verifyOtp` already uses in `registration.controller.ts`.

- [ ] **Step 4: Run them and watch them pass**

Run: `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api exec vitest run test/modules/identity/http/contact-verify.routes.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(identity): expose contact verification over /me"
```

---

### Task 5: Client contracts and hooks

**Files:**

- Modify: `packages/api-client/src/account.ts` (beside the change-phone block, line 450 onward)
- Modify: `packages/api-client/src/react/account.ts`
- Test: `packages/api-client/test/account.test.ts`

**Interfaces:**

- Consumes: Task 4's four paths and bodies; Task 1's `contacts` block.
- Produces: endpoints `startEmailVerification`, `confirmEmailVerification`, `startPhoneVerification`,
  `confirmPhoneVerification`; hooks `useStartContactVerification()` and `useConfirmContactVerification()`, each taking
  `{ channel: 'EMAIL' | 'PHONE' }`. Both invalidate the `me` query on success. Task 6 calls them.

- [ ] **Step 1: Write the failing contract test**

```ts
it('names the four contact verification routes', () => {
  expect(startEmailVerification.path).toBe('/me/email/verify/start');
  expect(confirmPhoneVerification.path).toBe('/me/phone/verify/confirm');
});

it('carries contacts on the me response', () => {
  expect(() => me.schema.response.parse(meFixtureWithContacts)).not.toThrow();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @komtru/api-client test`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the endpoints with `defineEndpoint`, the `contacts` block on the `me` response, and the two hooks**

Follow the change-phone block directly above for shape and comment style.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @komtru/api-client test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api-client): add contact verification contracts and hooks"
```

---

### Task 6: The contact section on VF1

**Files:**

- Create: `apps/web-app-ui/src/account/VerifyContact.tsx`
- Modify: `apps/web-app-ui/src/account/Verification.tsx` (render the section above the KYC content)
- Test: `apps/web-app-ui/test/account-verify-contact.test.tsx`

**Interfaces:**

- Consumes: Task 5's two hooks and `useMe().data.contacts`.
- Produces: `<ContactChecks />`, rendered by `Verification`.

- [ ] **Step 1: Write the failing tests**

```ts
it('badges a verified channel and offers no action', () => {
  render(<ContactChecks contacts={{ phone: verified, email: unverified }} />);
  expect(within(phoneRow()).getByText('Verified')).toBeInTheDocument();
  expect(within(phoneRow()).queryByRole('button', { name: /verify/i })).toBeNull();
});

it('offers to verify an unverified channel', () => {
  expect(within(emailRow()).getByText('Not verified')).toBeInTheDocument();
  expect(within(emailRow()).getByRole('button', { name: /verify/i })).toBeEnabled();
});

it('asks for an address when the account has none', async () => {
  render(<ContactChecks contacts={{ phone: verified, email: absent }} />);
  await user.click(screen.getByRole('button', { name: /add email/i }));
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
});

it('tells the person when no code was sent', async () => {
  // start resolves { delivered: false }
  expect(await screen.findByText(/couldn’t send/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @komtru/web-app-ui test -- account-verify-contact`
Expected: FAIL — module not found.

- [ ] **Step 3: Build `ContactChecks` and its code sheet**

Two `TermRow`s under a `SectionLabel`, each with a `Chip` for the badge — both are already imported by
`Verification.tsx`. The code entry reuses the sheet pattern in `ChangePhone.tsx`; do not write a second one. A channel
with `present: false` offers "Add email" / "Add phone" and collects the address first.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @komtru/web-app-ui test -- account-verify-contact`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web-app-ui): verify your email and phone from the verification screen"
```

---

### Task 7: Whole-feature verification

- [ ] **Step 1: Run the repo's own gates**

Run: `pnpm -w exec turbo run lint typecheck test --force`
Expected: all green.

- [ ] **Step 2: Walk it once in the browser**

With one frontend running only (two share the `komtru_rt` cookie and race the refresh rotation), sign in, open
`/account/verification`, verify the email, and confirm the badge flips and `GET /me` reports
`verificationLevel: CONTACT_VERIFIED`.

- [ ] **Step 3: Mark the ticket Done**

Add `- **Status:** Done (2026-11-18). Plan: docs/superpowers/plans/2026-11-18-f-081-verify-contacts.md` to the F-081
entry, then run `pnpm tickets:index`.

- [ ] **Step 4: Commit**

```bash
git commit -am "docs(tickets): mark F-081 done and regenerate the index"
```
