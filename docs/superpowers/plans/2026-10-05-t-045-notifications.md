# T-045 Notifications Delivery Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `notify` module that turns a domain event into a delivered message across EMAIL, SMS, PUSH and IN_APP — templates as versioned data, user preferences and per-user caps that a security-critical message bypasses, every provider call in a BullMQ job, and a delivery record that proves a user was told exactly once.

**Architecture:** A binding (code) names the domain event, the template key and how to pull recipients and variables out of the payload; `notify.notification_event_mappings` (data) is the runtime on/off switch for that pair. The module registers one event subscriber per binding. The subscriber runs inside the platform's handler transaction and writes **one `notify.notifications` row per (event, template, channel, user) with a deterministic uuid v5 id** — that id, plus its primary key, is the idempotency boundary: an event redelivery, a handler retry, or two bindings racing all collapse onto the same row. Nothing external happens in that transaction; the row is enqueued to a per-channel BullMQ queue, and the send job claims the row with a conditional `UPDATE … WHERE status IN ('QUEUED','FAILED')` before it touches a provider, so a job that runs twice calls the provider once. A per-minute sweep re-enqueues rows whose job was lost and un-sticks rows left `SENDING` by a killed worker.

**Tech Stack:** drizzle-orm 0.45 (`pgSchema`, partial indexes, `check`), drizzle-kit 0.31 (migrations 0016 generated, 0017 custom), BullMQ 6, zod 4, uuid 14 (`v5`), Vitest 5 with the per-worker template-clone harness, `test/support/stub-server.ts` for providers.

**Spec:** `docs/specs/module-11-notifications-and-communications.md` (M11, authoritative for schema and delivery flow); ticket `### T-045` in `docs/tickets/04-files-notify-config.md`; design §4.2 (schema per module), §4.3 (outbox), §4.4 (every external call through BullMQ) in `docs/superpowers/specs/2026-10-05-komtru-platform-design.md`.

## Global Constraints

- Everything lives in the `notify` Postgres schema (design §4.2). Same-schema foreign keys are real with explicit `onDelete`; `user_id` is a plain `uuid` with no `REFERENCES` (cross-schema, M11 §4.3 "soft ref to identity.users(id)").
- `notifications.event_name` is `NOT NULL` — M11 D1: there is no code path that sends without an event behind it.
- Migrations: **0016** generated (`pnpm --filter @komtru/backend-api db:generate`, renamed `0016_notify_schema.sql`), **0017** custom (`--custom`, `0017_notify_append_only.sql`). Both need their `tag` fixed in `apps/backend-api/drizzle/meta/_journal.json`. No other migration numbers are ours.
- Every network call lives in `src/modules/notify/infrastructure/providers/*.client.ts`, goes through `providerRequest`, and is imported only from `src/modules/notify/jobs/` (`komtru/provider-clients` plus `test/platform/provider-boundaries.test.ts`). The dry-run decision is made in the job, never in a client.
- **Never call Mailjet, Termii or FCM for real.** Every provider test points the client at `startStubServer`. `apps/backend-api/.env` holds live keys: never print, commit or quote it.
- Infra tests: `cd apps/backend-api && KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_t045 KOMTRU_TEST_REDIS_URL=redis://localhost:56379/4 pnpm exec vitest run`. Never run `pnpm infra:up/down/reset`.
- TypeScript 6 strict, ESM with `.js` extensions on relative imports, plain exported functions (no classes), zod 4, exact dependency versions. Comments are sparse and explain _why_.
- New env vars are **optional with defaults**: `pnpm env:backend` writes `.env` from `docs/specs/backend-apis.env`, not from `.env.example`, so a required variable would stop the API booting on every developer's machine.
- Integration tests are `*.int.test.ts` under `test/modules/notify/…`, inside `describe.runIf(infraEnabled)` with `useTestDatabase()`.

## Review Focus

1. **A security-critical notification must never be silently dropped.** A `notification_preferences` row that opts a user out of `SECURITY`, a user over their per-channel cap, and a user with no verified phone must each still produce a visible outcome for an `is_security_critical` template — sent in the first two cases, `DEAD_LETTERED` with `notification.dead_lettered` published in the third. Tested in Tasks 4 and 6.
2. **A redelivered event must not send twice.** The relay is at-least-once and `platform.processed_events` is the platform's guard, but an operator retrying a 29-day-old failed BullMQ job has no such guard. The claim `UPDATE` is what stops the second SMS, and it is tested on its own, without the event bus, in Task 6.
3. **A send job for a notification row that does not exist** (handler transaction rolled back after the enqueue) must be a logged no-op, not a dead-lettered job and not a crash. Task 6.
4. **A template with a placeholder no binding supplies, or a mapping whose template key does not exist,** must fail at boot naming the offender, not at render time. Tasks 3 and 8.
5. **Dry-run must be structural.** With `NOTIFY_SMS_DRY_RUN=true`, a stub server standing in for Termii must record **zero** hits while the notification is still rendered, recorded `SENT` and logged with the recipient masked. Task 7.

---

### Task 1: The `notify` schema

**Files:**

- Create: `apps/backend-api/src/modules/notify/infrastructure/postgres/schema/{columns,enums,templates,notifications,preferences,index}.ts`
- Create: `apps/backend-api/src/modules/notify/index.ts` (barrel; re-exports the schema only, for now)
- Modify: `packages/shared-types/src/enums.ts`
- Create: `apps/backend-api/drizzle/0016_notify_schema.sql`, `apps/backend-api/drizzle/0017_notify_append_only.sql`
- Modify: `apps/backend-api/drizzle/meta/_journal.json`
- Test: `apps/backend-api/test/modules/notify/infrastructure/postgres/schema.int.test.ts`

**Interfaces:**

- Produces, from `packages/shared-types/src/enums.ts`:
  - `NOTIFICATION_CHANNELS = ['PUSH','EMAIL','SMS','WHATSAPP','VOICE','IN_APP'] as const`, `notificationChannelSchema`, `type NotificationChannel`
  - `NOTIFICATION_CATEGORIES = ['SECURITY','TRADE','PAYMENT','DISPUTE','TICKET','MARKETING','ACCOUNT'] as const`, `notificationCategorySchema`, `type NotificationCategory`
  - `NOTIFICATION_STATUSES = ['QUEUED','SENDING','SENT','DELIVERED','FAILED','DEAD_LETTERED','SUPPRESSED'] as const`, `notificationStatusSchema`, `type NotificationStatus`
- Produces, from the schema barrel: `notify` (`pgSchema('notify')`), the three pg enums `notificationChannel`, `notificationStatus`, `notificationCategory`, and the tables `notificationTemplates`, `notificationEventMappings`, `notifications`, `notificationDeliveryAttempts`, `notificationPreferences`, `notificationRateLimits`.

Columns follow M11 §4.2–4.4 exactly, with these additions, each of which a later task needs:

| Table                    | Added column                                                              | Why                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `notification_templates` | `variables text[] NOT NULL DEFAULT '{}'`                                  | the placeholders the body declares; the boot integrity check and the admin UI read it                          |
| `notifications`          | `event_id uuid NOT NULL`                                                  | the outbox event this row traces to (M11 D1 traceability)                                                      |
| `notifications`          | `template_version integer NOT NULL`                                       | which version of the copy the user actually got                                                                |
| `notifications`          | `attempt_count integer NOT NULL DEFAULT 0`, `last_attempt_at timestamptz` | the claim `UPDATE` and the stuck sweep both key on these                                                       |
| `notifications`          | `recipient_masked text`                                                   | `j•••@gmail.com` for support and for the dry-run log; the address itself is never duplicated out of `identity` |
| `notifications`          | `read_at timestamptz`                                                     | M11 §7 `POST /notifications/:id/mark-read`                                                                     |

Plus `check('notifications_suppressed_has_reason', sql\`status <> 'SUPPRESSED' OR failed_reason IS NOT NULL\`)` — a suppressed row with no reason is the "why did this user not get this message" question nobody can answer.

Indexes: M11 §4.2–4.3 verbatim, with `.desc().nullsFirst()` on every `DESC` ordering (see the comment in `identity/…/users.ts`), plus `notifications_feed_idx` on `(user_id, queued_at desc nulls first) WHERE channel = 'IN_APP'` for Task 8's feed.

- [ ] **Step 1: Write the failing test** `schema.int.test.ts`, inside `describe.runIf(infraEnabled)` with `useTestDatabase()`. Copy `sqlState` and `enumLabels` from `test/modules/identity/infrastructure/postgres/support.ts` into a local `test/modules/notify/support.ts`. Assertions:

```ts
it.each([
  ['notification_channel', ['PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'VOICE', 'IN_APP']],
  ['notification_status', ['QUEUED','SENDING','SENT','DELIVERED','FAILED','DEAD_LETTERED','SUPPRESSED']],
  ['notification_category', ['SECURITY','TRADE','PAYMENT','DISPUTE','TICKET','MARKETING','ACCOUNT']],
])('declares %s in the notify schema', async (name, labels) => {
  await expect(enumLabels(t.owner(), 'notify', name)).resolves.toEqual(labels);
});

it('rejects a SUPPRESSED notification with no reason', async () => {
  await expect(sqlState(insertNotification(t.app(), { status: 'SUPPRESSED' }))).resolves.toBe('23514');
});

it('rejects a second notification with the same id', async () => {
  const id = randomUUID();
  await insertNotification(t.app(), { id });
  await expect(sqlState(insertNotification(t.app(), { id }))).resolves.toBe('23505');
});

it('cascades delivery attempts when their notification is removed by the owner', async () => { … });

it('refuses an UPDATE of a delivery attempt by the runtime role', async () => {
  const id = await insertAttempt(t.app());
  await expect(sqlState(t.app().query('UPDATE notify.notification_delivery_attempts SET succeeded = false WHERE id = $1', [id])))
    .resolves.toBe('42501');
});

it('keeps one preference row per user, category and channel', async () => { … expect 23505 … });
```

- [ ] **Step 2: Run** `KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_t045 KOMTRU_TEST_REDIS_URL=redis://localhost:56379/4 pnpm exec vitest run test/modules/notify` — expect FAIL (`schema "notify" does not exist`).
- [ ] **Step 3: Add the three enum tuples to `packages/shared-types/src/enums.ts`** and run `pnpm --filter @komtru/shared-types build`.
- [ ] **Step 4: Write the drizzle schema files.** `columns.ts` holds only `export const notify = pgSchema('notify')`. `enums.ts` declares the three enums on `notify`, each built from the shared tuple (`notify.enum('notification_channel', NOTIFICATION_CHANNELS)`), so the database and the wire contract cannot drift. Tables split as in **Files**.
- [ ] **Step 5: Generate the migration.** `pnpm --filter @komtru/backend-api db:generate`, rename the emitted file to `drizzle/0016_notify_schema.sql`, set its `tag` in `drizzle/meta/_journal.json`, and **read the SQL**: confirm the schema is `notify`, every index is there, and nothing outside `notify` is touched.
- [ ] **Step 6: Generate the custom migration.** `pnpm --filter @komtru/backend-api db:generate --custom`, rename to `drizzle/0017_notify_append_only.sql`, fix its `tag`, and put `appendOnly('notify.notification_delivery_attempts')`'s output in it with a header saying why attempt history can only grow (it is the evidence that a user was or was not told). Note in the header that `notifications` is therefore effectively undeletable by the app; retention pruning belongs to a later ticket.
- [ ] **Step 7: Run the test** — expect PASS.
- [ ] **Step 8: Commit** `feat(backend-api): add the notify schema`

---

### Task 2: Notify configuration

**Files:**

- Modify: `apps/backend-api/src/config/env.ts`
- Modify: `apps/backend-api/.env.example`
- Test: `apps/backend-api/test/config/env.test.ts`

**Interfaces:**

- Produces, on `AppConfig`:

```ts
notify: {
  defaultLocale: string;              // NOTIFY_DEFAULT_LOCALE, default 'en-NG'
  maxAttempts: number;                // NOTIFY_MAX_ATTEMPTS, default 5
  retryBaseDelayMs: number;           // NOTIFY_RETRY_BASE_DELAY_MS, default 2000
  rateLimitWindowMinutes: number;     // NOTIFY_RATE_LIMIT_WINDOW_MINUTES, default 60
  rateLimitMaxPerWindow: number;      // NOTIFY_RATE_LIMIT_MAX_PER_WINDOW, default 20
  smsDryRun: boolean;                 // NOTIFY_SMS_DRY_RUN, default nodeEnv !== 'production'
  pushDryRun: boolean;                // NOTIFY_PUSH_DRY_RUN, default nodeEnv !== 'production'
  mailjet?: { apiKey: string; apiSecret: string; fromEmail: string; fromName: string; sandbox: boolean };
  termii?: { apiKey: string; senderId: string; baseUrl: string };
  fcm?: { projectId: string; clientEmail: string; privateKey: string; tokenUri: string };
}
```

- Each provider block is present only when its credentials are complete, so `config.notify.mailjet === undefined` is the one check a job makes. `FCM_SERVICE_ACCOUNT_JSON` is parsed and validated by zod (`{ client_email, private_key, token_uri }`), so a malformed service account fails at boot naming the variable rather than at the first push.

- [ ] **Step 1: Write the failing tests** in `test/config/env.test.ts`:

```ts
it('defaults SMS and push to dry run outside production', () => {
  expect(loadConfig(base({ NODE_ENV: 'development' })).notify).toMatchObject({
    smsDryRun: true,
    pushDryRun: true,
  });
});

it('sends for real in production unless told otherwise', () => {
  expect(loadConfig(base({ NODE_ENV: 'production' })).notify).toMatchObject({
    smsDryRun: false,
    pushDryRun: false,
  });
});

it('leaves the mailjet block absent until every credential is set', () => {
  expect(loadConfig(base({ MAILJET_API_KEY: 'k' })).notify.mailjet).toBeUndefined();
});

it('rejects a malformed FCM service account by name', () => {
  expect(() => loadConfig(base({ FCM_SERVICE_ACCOUNT_JSON: '{' }))).toThrow(/FCM_SERVICE_ACCOUNT_JSON/);
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run test/config/env.test.ts` — expect FAIL.
- [ ] **Step 3: Add the variables to `VARIABLES` and the `notify` block to `loadConfig`,** declared exactly as the existing entries are (`{ schema, required: false }`, `bool`, `int(min,max)`). The service-account JSON is one `z.string().transform(JSON.parse-in-a-try).pipe(z.object({…}))`; a parse failure must surface through the existing `invalid` list so `ConfigError` names it.
- [ ] **Step 4: Add the two new variables to `.env.example`** under `# --- Notifications ---` with a one-line comment saying they are what stops a local run texting a real person, and remove nothing that is there.
- [ ] **Step 5: Run the test** — expect PASS.
- [ ] **Step 6: Commit** `feat(backend-api): read the notification provider and tuning variables`

---

### Task 3: Templates as data — the catalogue, rendering and the boot check

**Files:**

- Create: `apps/backend-api/src/modules/notify/domain/template.ts` (types, zod, render)
- Create: `apps/backend-api/src/modules/notify/domain/catalogue.ts` (the shipped templates and mappings, plus the integrity check)
- Test: `apps/backend-api/test/modules/notify/domain/template.test.ts`, `apps/backend-api/test/modules/notify/domain/catalogue.test.ts`

**Interfaces:**

- Produces, from `domain/template.ts`:
  - `templateSchema` — zod for `{ templateKey, channel, category, locale, version, subject?, body, variables: string[], isSecurityCritical }`; `templateKey` matches `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`, `subject` is required for `EMAIL` and forbidden for every other channel.
  - `type NotificationTemplate = z.infer<typeof templateSchema>`
  - `placeholders(body: string, subject?: string): string[]` — every `{{name}}` found, deduplicated, in order.
  - `renderTemplate(template: NotificationTemplate, variables: Record<string, string>): { subject?: string; body: string }` — substitutes `{{name}}`; **throws** `TemplateRenderError` naming the template key and the variable when one is missing. No HTML escaping and no partials: a template is plain text, and anything cleverer is a copy-authoring feature M17 owns.
  - `mappingSchema` / `type NotificationMapping = { eventName: string; templateKey: string; enabled: boolean }`
- Produces, from `domain/catalogue.ts`:
  - `CATALOGUE: { templates: NotificationTemplate[]; mappings: NotificationMapping[] }` — parsed through zod **at module load**, so a malformed template cannot be imported at all.
  - `assertCatalogueIntegrity(catalogue, defaultLocale: string): void` — throws one error listing every problem: a template whose `variables` do not cover its placeholders (or declare one the body never uses), a mapping whose `templateKey` has no template, a template key with no template in `defaultLocale`, a `SECURITY`-category template with `isSecurityCritical: false`, and a duplicate `(templateKey, channel, locale, version)`.

The seeded identity templates (ticket AC 6), `category: 'SECURITY'`, `isSecurityCritical: true`, locale `en-NG`, version 1:

| `templateKey`                     | channels                  | variables                               |
| --------------------------------- | ------------------------- | --------------------------------------- |
| `identity.otp.requested`          | `SMS`, `EMAIL`            | `code`, `purpose`, `expiresInMinutes`   |
| `identity.device.new_sign_in`     | `EMAIL`, `PUSH`, `IN_APP` | `deviceLabel`, `location`, `signedInAt` |
| `identity.password.changed`       | `EMAIL`, `PUSH`, `IN_APP` | `changedAt`                             |
| `identity.session.reuse_detected` | `EMAIL`, `SMS`, `IN_APP`  | `detectedAt`                            |

Mappings are seeded `enabled: true` against the event names T-031/T-034 will publish (`identity.otp.requested`, `identity.device.signed_in`, `identity.password.changed`, `identity.session.reuse_detected`). They are inert until a binding exists (Task 5), which is the point: the copy is reviewable now and a later ticket only adds the binding.

- [ ] **Step 1: Write the failing tests.** `template.test.ts`:

```ts
it('substitutes every placeholder', () => {
  expect(renderTemplate(t({ body: 'Your code is {{code}}' }), { code: '123456' })).toEqual({ body: 'Your code is 123456' });
});
it('names the template and the variable when one is missing', () => {
  expect(() => renderTemplate(t({ templateKey: 'identity.otp.requested', body: '{{code}}' }), {}))
    .toThrow(/identity\.otp\.requested.*code/);
});
it('leaves an unknown variable out rather than appending it', () => { … body unchanged … });
it('requires a subject on EMAIL and refuses one elsewhere', () => { … templateSchema.safeParse … });
```

`catalogue.test.ts`:

```ts
it('ships a catalogue that passes its own integrity check', () => {
  expect(() => assertCatalogueIntegrity(CATALOGUE, 'en-NG')).not.toThrow();
});
it('names a template whose body uses a variable it does not declare', () => { … /unknown_var/ … });
it('names a mapping with no template', () => { … /no template/ … });
it('refuses a SECURITY template that is not security critical', () => { … });
it('seeds the four identity templates', () => {
  expect(new Set(CATALOGUE.templates.map((x) => x.templateKey))).toEqual(new Set([
    'identity.otp.requested','identity.device.new_sign_in','identity.password.changed','identity.session.reuse_detected',
  ]));
});
it('marks every seeded identity template security critical', () => {
  expect(CATALOGUE.templates.every((x) => x.isSecurityCritical)).toBe(true);
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run test/modules/notify/domain` — expect FAIL.
- [ ] **Step 3: Implement `domain/template.ts`,** then `domain/catalogue.ts`. Write the copy for all four templates; SMS bodies stay under 160 characters so a message is one segment.
- [ ] **Step 4: Run the tests** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): ship the notification template catalogue`

---

### Task 4: The delivery decision

**Files:**

- Create: `apps/backend-api/src/modules/notify/domain/decide.ts`
- Test: `apps/backend-api/test/modules/notify/domain/decide.test.ts`

**Interfaces:**

- Produces:

```ts
export type SuppressionReason = 'PREFERENCE_OPT_OUT' | 'RATE_LIMITED' | 'NO_DESTINATION';
export type DeliveryDecision =
  | { kind: 'SEND' }
  | { kind: 'SUPPRESS'; reason: SuppressionReason }
  /** Security-critical and nowhere to send it: recorded DEAD_LETTERED and escalated, never suppressed. */
  | { kind: 'UNDELIVERABLE' };

export function decideDelivery(input: {
  securityCritical: boolean;
  category: NotificationCategory;
  hasDestination: boolean;
  optedIn: boolean;
  sendCountInWindow: number;
  maxPerWindow: number;
}): DeliveryDecision;

/** Fixed window start for a per-user cap, so two sends in the same window share a row. */
export function rateLimitWindowStart(now: Date, windowMinutes: number): Date;
```

Order, from M11 §5 and D2: no destination first (`UNDELIVERABLE` when security-critical, else `SUPPRESS NO_DESTINATION`); then `securityCritical` short-circuits to `SEND`; then the preference check; then the cap, which `category === 'SECURITY'` is exempt from even when the template is somehow not marked critical.

- [ ] **Step 1: Write the failing test** covering, one `it` each: a plain opted-in send; an opted-out non-critical suppressed with `PREFERENCE_OPT_OUT`; a security-critical template **sent** although `optedIn: false`; a security-critical template **sent** although `sendCountInWindow` is over the cap; a `SECURITY`-category template that is not `securityCritical` still exempt from the cap; a non-critical over the cap suppressed with `RATE_LIMITED`; a non-critical with no destination suppressed with `NO_DESTINATION`; a security-critical with no destination `UNDELIVERABLE`. Plus:

```ts
it('puts two sends a minute apart in the same hourly window', () => {
  expect(rateLimitWindowStart(new Date('2026-10-05T10:01:00Z'), 60)).toEqual(
    rateLimitWindowStart(new Date('2026-10-05T10:59:00Z'), 60),
  );
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run test/modules/notify/domain/decide.test.ts` — expect FAIL.
- [ ] **Step 3: Implement `decide.ts`.** `rateLimitWindowStart` floors epoch milliseconds to a multiple of the window.
- [ ] **Step 4: Run the test** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): decide suppression, caps and the security-critical bypass`

---

### Task 5: Dispatch — one row per send, inside the handler's transaction

**Files:**

- Create: `apps/backend-api/src/modules/notify/domain/identity.ts` (the deterministic notification id)
- Create: `apps/backend-api/src/modules/notify/domain/binding.ts` (the binding type and the empty shipped list)
- Create: `apps/backend-api/src/modules/notify/domain/events.ts`
- Create: `apps/backend-api/src/modules/notify/services/recipients.service.ts`
- Create: `apps/backend-api/src/modules/notify/services/dispatch.service.ts`
- Test: `apps/backend-api/test/modules/notify/domain/identity.test.ts`, `apps/backend-api/test/modules/notify/services/dispatch.int.test.ts`

**Interfaces:**

- Consumes: `CATALOGUE`, `renderTemplate`, `decideDelivery`, `rateLimitWindowStart`, `AppConfig['notify']`, the schema barrel, `publish`/`Tx` from `platform/events/publish.js`, `maskEmail`/`maskPhone` from `platform/identifiers.js`.
- Produces, from `domain/identity.ts`:
  - `NOTIFY_ID_NAMESPACE` — a fixed uuid constant.
  - `notificationIdFor(input: { eventId: string; templateKey: string; channel: NotificationChannel; userId: string }): string` — `uuidv5` over `${eventId}:${templateKey}:${channel}:${userId}`. **This is the idempotency boundary.** Everything downstream is keyed on it.
- Produces, from `domain/events.ts` (`defineEvent`, version 1):
  - `notificationSent` — `notify.notification.sent`, `{ notificationId, userId, channel, category, templateKey }`
  - `notificationFailed` — `notify.notification.failed`, `{ notificationId, channel, reason }`
  - `notificationDeadLettered` — `notify.notification.dead_lettered`, `{ notificationId, userId, channel, category, templateKey, reason }`
- Produces, from `domain/binding.ts`:

```ts
export interface NotificationRecipient { userId: string; variables: Record<string, string> }
export interface NotificationBinding<S extends z.ZodType = z.ZodType> {
  /** `notify.on-<something>`; the platform's subscriber name. */
  subscriber: string;
  event: EventDefinition<S>;
  templateKey: string;
  recipients: (payload: z.output<S>) => NotificationRecipient[];
}
export const defineBinding = <S extends z.ZodType>(b: NotificationBinding<S>): NotificationBinding => …;
/** Empty until a module publishes an event worth notifying on; T-031 and T-068 add the first entries. */
export const BINDINGS: NotificationBinding[] = [];
```

- Produces, from `services/recipients.service.ts`:
  - `resolveDestination(tx, userId, channel): Promise<{ address: string; masked: string } | undefined>` — `EMAIL` reads the primary **verified** `identity.user_emails` row, `SMS`/`WHATSAPP`/`VOICE` the primary verified `identity.user_phones` row, `PUSH` returns the count of `identity.devices` rows with a `push_token` and status `ACTIVE` or `TRUSTED` (`address` is the device count, `masked` is `devices:<n>`; the tokens themselves are re-read by the job), `IN_APP` always resolves. Reads identity through `src/modules/identity/index.js`, never its internals.
  - `resolveLocale(tx, userId, fallback): Promise<string>` — `identity.users.locale`.
- Produces, from `services/dispatch.service.ts`:

```ts
export interface DispatchDeps {
  config: AppConfig['notify'];
  logger: Logger;
}
export interface QueuedSend {
  notificationId: string;
  channel: NotificationChannel;
}
/** Runs inside the subscriber's own transaction. Returns what the caller must enqueue after commit. */
export function dispatchForEvent(
  deps: DispatchDeps,
  tx: Tx,
  input: { envelope: EventEnvelope<unknown>; templateKey: string; recipients: NotificationRecipient[] },
): Promise<QueuedSend[]>;
```

What `dispatchForEvent` does, per recipient: read the `notification_event_mappings` row for `(envelope.eventType, templateKey)` and return `[]` when it is missing or disabled; pick the user's locale and, per channel, the highest active `version` for `(templateKey, channel, locale)` falling back to `deps.config.defaultLocale`; resolve the destination; read the current `notification_rate_limits.send_count`; `decideDelivery`; render; `INSERT … ON CONFLICT (id) DO NOTHING RETURNING id` with `notificationIdFor(…)`, `correlation_id = envelope.eventId`, `status` from the decision (`QUEUED`, `SUPPRESSED` with `failed_reason` = the reason lower-cased, `DEAD_LETTERED` for `UNDELIVERABLE`); and only when a row was actually inserted, bump the rate-limit row and publish `notificationDeadLettered` for an `UNDELIVERABLE`. `IN_APP` is special: there is no provider, so the row is inserted `SENT` with `sent_at`, `notificationSent` is published in the same transaction, and it is **not** returned for enqueueing. Everything else is returned.

- [ ] **Step 1: Write the failing tests.** `identity.test.ts`:

```ts
it('is stable for the same event, template, channel and user', () => {
  expect(notificationIdFor(x)).toBe(notificationIdFor({ ...x }));
});
it('differs per channel and per user', () => { … });
```

`dispatch.int.test.ts` (`describe.runIf(infraEnabled)`, `useTestDatabase()`, a helper that seeds the catalogue rows and an identity user with a verified email and phone):

```ts
it('writes one QUEUED row per channel the template declares', async () => { … });
it('writes the same row and nothing more when the handler runs twice for one event', async () => {
  await t.db().transaction((tx) => dispatchForEvent(deps, tx, input));
  await t.db().transaction((tx) => dispatchForEvent(deps, tx, input));
  expect(await countNotifications()).toBe(2); // EMAIL + SMS, not four
  expect(await rateLimitCount()).toBe(1);     // the cap was charged once
});
it('suppresses a non-critical notification the user opted out of, with a reason', async () => { … status SUPPRESSED, failed_reason 'preference_opt_out' … });
it('sends a security-critical notification although the user opted out of SECURITY', async () => { … status QUEUED … });
it('suppresses over the cap but never a security-critical message', async () => { … });
it('dead-letters a security-critical SMS for a user with no verified phone and publishes it', async () => {
  // one notify.notification.dead_lettered row in platform.outbox
});
it('records an IN_APP notification SENT with no job to run', async () => {
  expect(queued.map((q) => q.channel)).not.toContain('IN_APP');
});
it('does nothing when the mapping is disabled', async () => { … });
it('falls back to the default locale when the user has none for this template', async () => { … });
```

- [ ] **Step 2: Run** `… vitest run test/modules/notify` — expect FAIL.
- [ ] **Step 3: Implement `domain/identity.ts`, `domain/events.ts`, `domain/binding.ts`, `services/recipients.service.ts` and `services/dispatch.service.ts`.** Every statement takes `tx`; no `prepare`, no session SQL (`komtru/pgbouncer-safe`).
- [ ] **Step 4: Run the tests** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): dispatch notifications from a domain event`

---

### Task 6: Delivery state — claiming, failing and dead-lettering

**Files:**

- Create: `apps/backend-api/src/modules/notify/services/delivery.service.ts`
- Test: `apps/backend-api/test/modules/notify/services/delivery.int.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ClaimedNotification {
  id: string;
  userId: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  templateKey: string;
  renderedSubject: string | null;
  renderedBody: string;
  recipientMasked: string | null;
  attemptNumber: number;
}
/** The guard that stops a second SMS: a conditional UPDATE, not a read-then-write. */
export function claimForSend(db: Db, notificationId: string): Promise<ClaimedNotification | undefined>;
export function markSent(
  db: Db,
  id: string,
  providerReference: string | undefined,
  attemptNumber: number,
): Promise<void>;
export function markFailed(db: Db, id: string, attemptNumber: number, reason: string): Promise<void>;
export function markDeadLettered(db: Db, id: string, attemptNumber: number, reason: string): Promise<void>;
/** Rows whose enqueue was lost, and rows a killed worker left SENDING. Returns how many were reset. */
export function releaseStuck(
  db: Db,
  now: Date,
  options: { queuedAfterMs: number; sendingAfterMs: number },
): Promise<{ notificationId: string; channel: NotificationChannel }[]>;
```

`claimForSend` is one statement: `UPDATE notify.notifications SET status='SENDING', attempt_count = attempt_count + 1, last_attempt_at = now() WHERE id = $1 AND status IN ('QUEUED','FAILED') RETURNING …`. No row back means somebody else already has it, or it is already `SENT`, `SUPPRESSED` or `DEAD_LETTERED` — the caller returns without touching a provider.

`markSent`/`markFailed`/`markDeadLettered` each do their `UPDATE`, insert the `notification_delivery_attempts` row, and `publish` the matching event, **all in one `db.transaction`** — so a delivery record and its event cannot disagree.

- [ ] **Step 1: Write the failing test** `delivery.int.test.ts`:

```ts
it('claims a QUEUED notification once', async () => {
  expect(await claimForSend(db, id)).toMatchObject({ attemptNumber: 1 });
  expect(await claimForSend(db, id)).toBeUndefined();          // already SENDING
});
it('claims again after a failure, with the next attempt number', async () => { … attemptNumber: 2 … });
it('never claims a SENT, SUPPRESSED or DEAD_LETTERED row', async () => { … });
it('returns undefined for a notification that does not exist', async () => { … });
it('records an attempt row and publishes notification.sent', async () => { … one outbox row … });
it('publishes notification.dead_lettered with the category, so support can open a ticket', async () => { … });
it('releases a row left SENDING by a killed worker and one whose enqueue was lost', async () => { … both come back … });
it('leaves a freshly queued row alone', async () => { … });
```

- [ ] **Step 2: Run** `… vitest run test/modules/notify/services/delivery.int.test.ts` — expect FAIL.
- [ ] **Step 3: Implement `delivery.service.ts`.**
- [ ] **Step 4: Run the test** — expect PASS.
- [ ] **Step 5: Commit** `feat(backend-api): claim a notification before any provider call`

---

### Task 7: The three provider clients and the send job

**Files:**

- Create: `apps/backend-api/src/modules/notify/infrastructure/providers/{mailjet,termii,fcm}.client.ts`
- Create: `apps/backend-api/src/modules/notify/jobs/send.job.ts`
- Create: `apps/backend-api/src/modules/notify/jobs/requeue-stuck.job.ts`
- Test: `apps/backend-api/test/modules/notify/infrastructure/providers/clients.test.ts`, `apps/backend-api/test/modules/notify/jobs/send.int.test.ts`

**Interfaces:**

- Produces, from the clients (each takes its credentials as an argument — nothing reads config, and `baseUrl` is always a parameter so a test points it at `startStubServer`):

```ts
// mailjet.client.ts   POST {baseUrl}/v3.1/send, HTTP basic api key:secret, SandboxMode from the caller.
export function sendEmail(
  logger: Logger,
  options: {
    baseUrl?: string;
    apiKey: string;
    apiSecret: string;
    fromEmail: string;
    fromName: string;
    sandbox: boolean;
    to: string;
    subject: string;
    text: string;
  },
): Promise<{ providerReference: string | undefined }>;

// termii.client.ts    POST {baseUrl}/api/sms/send, `channel: 'generic'`, type `plain`.
export function sendSms(
  logger: Logger,
  options: {
    baseUrl: string;
    apiKey: string;
    senderId: string;
    to: string;
    text: string;
  },
): Promise<{ providerReference: string | undefined }>;

// fcm.client.ts       OAuth2 JWT-bearer at tokenUri, then POST {baseUrl}/v1/projects/{projectId}/messages:send.
export function sendPush(
  logger: Logger,
  options: {
    baseUrl?: string;
    tokenUri: string;
    projectId: string;
    clientEmail: string;
    privateKey: string;
    tokens: string[];
    title: string;
    body: string;
  },
): Promise<{ providerReference: string | undefined; invalidTokens: string[] }>;
```

Every call goes through `providerRequest` with `idempotent: false` (a POST that sends a message must never be auto-repeated inside one attempt — the queue's backoff is the retry) and the provider's name and a stable `operation` (`mailjet`/`send`, `termii`/`sms.send`, `fcm`/`message.send`). `sendPush` signs an RS256 JWT with `node:crypto` (`createSign('RSA-SHA256')`), exchanges it for an access token with a short in-process cache keyed on `clientEmail`, and classifies an `UNREGISTERED`/`INVALID_ARGUMENT` per-token response into `invalidTokens` rather than failing the whole send.

- Produces, from `jobs/send.job.ts`:

```ts
export interface SendJobData {
  notificationId: string;
}
export interface SendJobDeps {
  db: Db;
  config: AppConfig['notify'];
  logger: Logger;
}
export function runSendJob(deps: SendJobDeps, data: SendJobData): Promise<void>;
```

Order, and the whole reason the job exists: `claimForSend` → return quietly when nothing was claimed (an already-handled row, or a row whose transaction rolled back after the enqueue — `logger.info`, never a throw, so it is not dead-lettered) → re-resolve the real destination from `identity` → **dry-run gate** (`SMS`/`WHATSAPP`/`VOICE` when `config.smsDryRun`, `PUSH` when `config.pushDryRun`, `EMAIL` when `config.mailjet` is undefined): log `{ channel, notificationId, recipient: row.recipientMasked }` and `markSent(…, 'dry-run', …)` **without importing or calling a client** → otherwise call the channel's client → `markSent` on success → on failure `markFailed` and rethrow so BullMQ retries, unless `attemptNumber >= config.maxAttempts`, in which case `markDeadLettered` and throw `UnrecoverableError` so the queue stops immediately rather than burning four more backoffs.

- Produces, from `jobs/requeue-stuck.job.ts`: `requeueStuck(deps: { db; queues: QueueFactory; config; logger }, firedAt: Date): Promise<number>` — calls `releaseStuck` and re-enqueues each result on its channel queue. No provider import.

- [ ] **Step 1: Write the failing client tests** `clients.test.ts` against `startStubServer` (no infra needed): Mailjet sends basic auth and `SandboxMode` when asked and returns the message id; Termii posts `to`, `sms`, `from` and `api_key` to `{baseUrl}/api/sms/send`; FCM fetches a token once and reuses it for a second send; FCM reports an `UNREGISTERED` token in `invalidTokens` instead of throwing; a 500 from any of them rejects with `ProviderHttpError` after exactly one attempt (`hits.length === 1`).
- [ ] **Step 2: Write the failing job tests** `send.int.test.ts`:

```ts
it('calls the provider once when the job runs twice for one notification', async () => {
  await runSendJob(deps, { notificationId: id });
  await runSendJob(deps, { notificationId: id });
  expect(stub.hits).toHaveLength(1);
  expect(await status(id)).toBe('SENT');
});
it('is a quiet no-op for a notification that does not exist', async () => {
  await expect(runSendJob(deps, { notificationId: randomUUID() })).resolves.toBeUndefined();
  expect(stub.hits).toEqual([]);
});
it('makes no provider call in SMS dry run, and still records the send with the recipient masked', async () => {
  const deps = { ...base, config: { ...base.config, smsDryRun: true } };
  await runSendJob(deps, { notificationId: id });
  expect(stub.hits).toEqual([]);
  expect(await row(id)).toMatchObject({ status: 'SENT', provider_reference: 'dry-run' });
  expect(logged()).toMatchObject({ recipient: expect.stringContaining('•') });
});
it('records a failed attempt and rethrows so the queue retries', async () => { … status FAILED, one attempt row … });
it('dead-letters on the last attempt and throws UnrecoverableError', async () => {
  await expect(runSendJob(depsAtLastAttempt, { notificationId: id })).rejects.toBeInstanceOf(UnrecoverableError);
  expect(await status(id)).toBe('DEAD_LETTERED');
});
it('re-enqueues a row whose job was lost', async () => { … requeueStuck … });
```

- [ ] **Step 3: Run** `… vitest run test/modules/notify` — expect FAIL.
- [ ] **Step 4: Implement the three clients, then the two jobs.**
- [ ] **Step 5: Run the tests, then `pnpm exec vitest run test/platform/provider-boundaries.test.ts`** — expect PASS on both; the boundary scan now has real files to check.
- [ ] **Step 6: Commit** `feat(backend-api): send notifications through mailjet, termii and fcm`

---

### Task 8: The module — subscribers, queues, schedule, HTTP and the boot check

**Files:**

- Create: `apps/backend-api/src/modules/notify/services/{feed,preferences,sync}.service.ts`
- Create: `apps/backend-api/src/modules/notify/http/routes.ts`
- Create: `apps/backend-api/src/modules/notify/module.ts`
- Modify: `apps/backend-api/src/modules/notify/index.ts` (barrel: schema, `notifyModule`, the three event definitions, `defineBinding`)
- Modify: `apps/backend-api/src/modules/index.ts`, `apps/backend-api/src/platform/module.ts`, `apps/backend-api/src/server.ts`, `apps/backend-api/src/worker-process.ts`
- Test: `apps/backend-api/test/modules/notify/http/routes.int.test.ts`, `apps/backend-api/test/modules/notify/module.int.test.ts`, `apps/backend-api/test/platform/module.test.ts`

**Interfaces:**

- **Platform change:** `ModuleContext` gains `config: AppConfig`. `server.ts` and `worker-process.ts` already hold `config` and pass it into the single `module.start?.({ queues, events, emitter, db })` call each. A module that needs a tuning variable has no other way to see one, and reading `process.env` inside a module would diverge from the `env` object the process was started with (which the integration tests craft by hand).
- Produces, from `services/sync.service.ts`: `syncCatalogue(db, catalogue): Promise<{ templates: number; mappings: number }>` — `INSERT … ON CONFLICT DO NOTHING` per `(template_key, channel, locale, version)` and per `(event_name, template_key)`. It never overwrites an existing row: a copy change ships as a **new version** (M11 D5), so an edit ops made in the database is not stamped on at the next deploy.
- Produces, from `services/feed.service.ts`: `listFeed(db, userId, { limit, cursor }): Promise<Paginated<FeedItem>>` (IN_APP only, newest first, cursor `{ queuedAt, id }`), `markRead(db, userId, notificationId): Promise<boolean>` (false when the row is not that user's — the route turns it into a 404 so one user cannot probe another's ids).
- Produces, from `services/preferences.service.ts`: `getPreferences(db, userId)` (every `category × channel` pair with its effective value, defaulting to opted in) and `setPreferences(db, userId, changes)`.
- Produces, from `module.ts`: `createNotifyModule(bindings?: NotificationBinding[]): KomtruModule` and `export const notifyModule = createNotifyModule()`.

The module:

- `name: 'notify'`.
- `queues`: `notify.send-email`, `notify.send-sms`, `notify.send-push`, each `concurrency: 4`, each `process: (data) => runSendJob(runtime(), data)`. Per-channel, so a stalled Termii cannot hold up email. Attempts and backoff are **not** on the definition (the API defines queues before `start`, where config is not yet in hand); they are passed per job at enqueue time from `ctx.config.notify`.
- `schedules`: `{ name: 'notify.requeue-stuck', cron: '* * * * *' }`.
- `routes`: the four below.
- `start(ctx)`: `assertCatalogueIntegrity(CATALOGUE, ctx.config.notify.defaultLocale)` **first**, so a bad template stops the process at boot; then `syncCatalogue`; then one `ctx.events.subscribe` per binding, whose handler calls `dispatchForEvent` and, after the transaction returns, enqueues each `QueuedSend` with `jobId: notificationId` and the configured attempts and backoff. The enqueue is outside the handler's transaction and is allowed to fail: `notify.requeue-stuck` is the floor underneath it.
- `stop()`: clears the runtime holder.

Routes (all `scope: 'CONSUMER'`; a shared `requireUser(actor)` turns the `anon` actor into a 401 `UNAUTHENTICATED`, which is every caller until T-031 supplies `resolveActor` — failing closed is the only safe default for a route that returns another person's messages):

| Route                               | Notes                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /notifications`                | `paginated: 'cursor'`, IN_APP feed, newest first                                                                                                                               |
| `POST /notifications/:id/mark-read` | `retryable: false` (marking a read message read again is harmless)                                                                                                             |
| `GET /notification-preferences`     | `paginated: 'cursor'` — it returns a collection, so the registry requires it                                                                                                   |
| `PUT /notification-preferences`     | `retryable: false`; **rejects `category: 'SECURITY'` with 422** — M11 D2 says that opt-out is ignored, and storing a preference the pipeline ignores is a lie told to the user |

- [ ] **Step 1: Write the failing tests.** `test/platform/module.test.ts`: a module's `start` receives the process's `config`. `routes.int.test.ts` (mount the routes with `mountRoutes` and a `resolveActor` stub, as `test/platform/http/*.int.test.ts` do):

```ts
it('answers 401 for an anonymous caller on every notify route', async () => { … });
it('returns only the caller\'s IN_APP notifications, newest first', async () => { … });
it('pages with a cursor', async () => { … });
it('marks one read and 404s on another user\'s id', async () => { … });
it('refuses to store a SECURITY opt-out', async () => {
  await expect(put({ category: 'SECURITY', channel: 'SMS', optedIn: false })).resolves.toMatchObject({ status: 422 });
});
it('stores and reads back a MARKETING opt-out', async () => { … });
```

`module.int.test.ts`:

```ts
it('refuses to start when a template declares a variable its body never uses', async () => {
  await expect(start(moduleWithBadCatalogue)).rejects.toThrow(/notify: /);
});
it('seeds the catalogue once, however many times it starts', async () => { … counts unchanged … });
it('never overwrites a template row an operator edited', async () => { … });
```

- [ ] **Step 2: Run** `… vitest run test/modules/notify test/platform/module.test.ts` — expect FAIL.
- [ ] **Step 3: Add `config` to `ModuleContext`** and pass it from `server.ts` and `worker-process.ts`.
- [ ] **Step 4: Implement the three services, the routes and `module.ts`,** and register `notifyModule` in `src/modules/index.ts`.
- [ ] **Step 5: Run the tests** — expect PASS.
- [ ] **Step 6: Commit** `feat(backend-api): wire the notify module into the api and the worker`

---

### Task 9: End to end, and the ticket record

**Files:**

- Create: `apps/backend-api/test/integration/notifications.int.test.ts`
- Modify: `docs/tickets/04-files-notify-config.md`

**Interfaces:**

- Consumes: `startApi`/`startWorker` with an injected module list, exactly as `test/integration/events.int.test.ts` does.

The test builds a throwaway binding over `defineEvent('test.notice.raised', 1, …)` mapped to a test template on the `SMS` channel, points Termii at a stub server, starts an API and a worker over the same database and Redis, publishes the event from a route, and asserts the whole path.

- [ ] **Step 1: Write the failing test:**

```ts
it('turns an event published in the api into exactly one provider call from the worker', async () => {
  await post(`/v1/notices/${id}`);
  await eventually(async () => stub.hits.length === 1);
  expect(await status()).toBe('SENT');
});

it('sends nothing more when the same event is relayed again', async () => {
  // re-publish with the SAME eventId, then wait out two relay ticks
  expect(stub.hits).toHaveLength(1);
  expect(await countNotifications()).toBe(1);
});

it('dead-letters after NOTIFY_MAX_ATTEMPTS against a provider that always fails, and publishes it', async () => {
  // NOTIFY_MAX_ATTEMPTS=2, NOTIFY_RETRY_BASE_DELAY_MS=10
  await eventually(async () => (await status()) === 'DEAD_LETTERED');
  expect(await outboxTypes()).toContain('notify.notification.dead_lettered');
});
```

- [ ] **Step 2: Run** `… vitest run test/integration/notifications.int.test.ts` — expect FAIL, then make it pass (no new production code should be needed; if any is, that is a gap Tasks 5–8 missed).
- [ ] **Step 3: Run the whole verification set** and record the counts:

```
pnpm exec turbo run build lint typecheck test --force
pnpm exec prettier --check .
cd apps/backend-api && KOMTRU_INFRA_TESTS=1 KOMTRU_TEST_DB_PREFIX=komtru_t045 KOMTRU_TEST_REDIS_URL=redis://localhost:56379/4 pnpm exec vitest run
```

- [ ] **Step 4: Mark the ticket done** in `docs/tickets/04-files-notify-config.md` under `### T-045` with `- **Status:** Done (2026-10-05). Plan: …` and `- **Deferred:** …`. Do **not** run `pnpm tickets:index`.
- [ ] **Step 5: Commit** `test(backend-api): prove the notification pipeline end to end`

---

## Deferred, and why

- **Quiet hours.** M11 names preferences and rate limits as the only gates on a send (§5) and says nothing about a time-of-day window, and neither does the ticket. Inventing one would mean deciding, with no spec, how long a trade notification may be held and which categories escape — and a quiet-hours rule that defers a security message is exactly the silent suppression D2 forbids. The structure is ready for it (`decideDelivery` is pure and takes everything it needs as arguments); the rule belongs with M17's configurable defaults (T-048).
- **Admin endpoints** (M11 §7: dead-letter list, manual retry, template versioning through `PUT /admin/notification-templates/:key`) — they need the RBAC permission catalogue (T-033) and the admin action log, neither of which exists.
- **`WHATSAPP` and `VOICE`** are in the enum (M11 §4.1) but have no adapter: Termii carries them, and nothing in the launch scope sends one.
- **HTML email.** A template is plain text; Mailjet gets a `TextPart`. A rich template is copy authoring, which M17 owns.
- **`NOTIFY_QUEUE_ENABLED`** (in `.env.example`) is not implemented: a flag that silently stops every notification is worse than a queue that is visibly down.
- **Socket push for the IN_APP feed.** The row and `notify.notification.sent` are the durable half; the push itself belongs to T-027, which owns the gateway and the user's room, and subscribes to that event.
- **`shared-types` wire schemas and `api-client` hooks** for the feed and preferences — the web app ticket that renders them owns the client contract.
