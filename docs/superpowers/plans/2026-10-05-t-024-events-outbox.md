# T-024 Domain Events: Outbox and Typed Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every domain event is written to `platform.outbox` in the same transaction as the state change, relayed to subscriber queues at least once in per-aggregate order, and handled exactly once per subscriber.

**Architecture:** `publish(tx, event)` inserts one envelope row into `platform.outbox` using the caller's transaction, so a rollback publishes nothing. In the worker only, a relay loop claims unpublished rows with `FOR UPDATE SKIP LOCKED` ordered by `seq`, enqueues a copy to `events.<subscriber>` for every subscriber of that event type, and marks the row published in the same transaction — at-least-once, because the enqueue happens before the commit that marks it. Each subscriber queue's processor opens its own transaction, inserts `(eventId, subscriber)` into `platform.processed_events` with `ON CONFLICT DO NOTHING`, skips the handler when the row already existed, and otherwise runs the handler inside that transaction, so a handler failure rolls the marker back with its writes. The in-process typed emitter stays for effects that are safe to lose and recompute.

**Tech Stack:** drizzle-orm 0.45 (`pgSchema`, `db.transaction`), node-postgres, BullMQ 6 through the existing queue factory (T-023), zod 4 in `@komtru/shared-types`, uuid v14 (v7, time-ordered).

**Spec:** design §4.3 and §4.4 in `docs/superpowers/specs/2026-10-05-komtru-platform-design.md`; envelope from M1 §11 (`docs/specs/module-01-identity-and-user-management.md`); ticket T-024 in `docs/tickets/02-backend-platform.md`.

## Global Constraints

- Envelope is exactly `{ eventId, eventType, version, occurredAt, correlationId, causationId, actor, payload }` (M1 §11). At-least-once delivery; consumers are idempotent on `eventId`.
- Event types are `module.thing.happened`, lower case, dot-separated; payloads are zod schemas in `@komtru/shared-types`, never hand-rolled objects in the backend.
- Nothing lives in `public`: both tables are in the `platform` schema. Cross-module references are plain `uuid` with no `REFERENCES`.
- The API process never consumes and never relays: it defines subscriber queues (so attempts/backoff agree) and produces only. Only the worker consumes and relays.
- `komtru_app` is the runtime role: `grantRuntimeAccess()` must cover both new tables; no migration hand-grants.
- Redis keys keep the `komtru:` prefix; queues go through `createQueueFactory` (T-023) rather than new BullMQ objects.
- Relay tuning lives in code constants with per-call overrides (`pollMs` 500, `batchSize` 100, `outboxRetentionDays` 14, `processedRetentionDays` 30) — no new environment variables in this ticket.

## Review Focus

1. A handler that throws must not leave its `processed_events` marker behind, or the retry silently skips the work (Task 4).
2. Two workers relaying the same outbox at once must not publish a row twice per subscriber in the common case, and must never lose one — `FOR UPDATE SKIP LOCKED` plus mark-inside-the-claiming-transaction (Task 5).
3. An event type with no subscribers must still be marked published, or the relay spins on it forever (Task 5).
4. A subscriber whose queue enqueue fails (Redis down) must leave the row unpublished for the next tick rather than marking it published (Task 5).
5. `publish()` called with a payload that does not match its registered schema must fail at the call site, not at the subscriber (Task 3).

---

### Task 1: Event envelope and typed registry in `@komtru/shared-types`

**Files:**

- Create: `packages/shared-types/src/events.ts`
- Modify: `packages/shared-types/src/index.ts` (add `export * from './events.js';`)
- Test: `packages/shared-types/test/events.test.ts`

**Interfaces:**

- Produces:
  - `eventActorSchema` — `{ type: 'USER' | 'STAFF' | 'LOGISTICS' | 'SYSTEM', id?: string }`
  - `eventEnvelopeSchema` — `{ eventId: uuid, eventType: string, version: number ≥ 1, occurredAt: ISO datetime string, correlationId?: uuid, causationId?: uuid, actor: Actor, payload: unknown }`
  - `type EventEnvelope<P = unknown>`
  - `defineEvent<S extends z.ZodType>(eventType: string, version: number, payload: S): EventDefinition<S>` where `EventDefinition` is `{ eventType, version, payload }`
  - `eventTypeSchema` — regex `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$`
  - `queueDeadLetteredEvent` — `defineEvent('platform.queue.dead_lettered', 1, …)` with payload `{ queue, jobId?, name, attempts, error, failedAt }`

- [ ] **Step 1: Write the failing tests**

```ts
it('accepts the M1 §11 envelope', () => expect(eventEnvelopeSchema.parse(valid)).toMatchObject({ eventType: 'identity.user.registered' }));
it('rejects an event type that is not module.thing.happened', () => expect(eventTypeSchema.safeParse('userRegistered').success).toBe(false));
it('rejects a version below 1', …);
it('normalises eventId case through uuidSchema', …);
it('defineEvent keeps eventType, version and payload schema together', …);
```

- [ ] **Step 2: Run `pnpm --filter @komtru/shared-types test` — expect FAIL (module not found)**
- [ ] **Step 3: Implement `packages/shared-types/src/events.ts`** reusing `uuidSchema` from `./ids.js`; `actor` defaults to `{ type: 'SYSTEM' }`.
- [ ] **Step 4: Run `pnpm --filter @komtru/shared-types test` — expect PASS**
- [ ] **Step 5: Commit** `feat(shared-types): add domain event envelope and typed event registry`

---

### Task 2: `platform.outbox` and `platform.processed_events`

**Files:**

- Modify: `apps/backend-api/src/db/platform-schema.ts`
- Create: `apps/backend-api/drizzle/0002_platform_events.sql` (via `pnpm db:generate`)
- Test: `apps/backend-api/test/db/platform-events.int.test.ts`

**Interfaces:**

- Produces: `outbox` and `processedEvents` drizzle tables.
  - `outbox`: `seq` bigserial PK-ordering column, `eventId` uuid unique not null, `eventType` text, `version` integer, `aggregateType` text null, `aggregateId` uuid null, `occurredAt` timestamptz, `correlationId` uuid null, `causationId` uuid null, `actor` jsonb, `payload` jsonb, `publishedAt` timestamptz null, `createdAt` timestamptz default now.
  - Index `outbox_unpublished_idx` on `(seq)` `WHERE published_at IS NULL` (partial: the relay's only query).
  - `processedEvents`: composite PK `(eventId, subscriber)`, `processedAt` timestamptz default now.

- [ ] **Step 1: Write the failing integration test** (`describe.runIf(infraEnabled)`, `useTestDatabase()`): `komtru_app` can INSERT/SELECT/UPDATE `platform.outbox` and INSERT/SELECT `platform.processed_events`; a second insert of the same `(eventId, subscriber)` violates the primary key; `seq` increases.
- [ ] **Step 2: Run `pnpm --filter @komtru/backend-api test:int` — expect FAIL (relation does not exist)**
- [ ] **Step 3: Add both tables to `src/db/platform-schema.ts`, run `pnpm --filter @komtru/backend-api db:generate`, read the generated SQL** and confirm it only creates these two objects plus the index.
- [ ] **Step 4: Run `pnpm --filter @komtru/backend-api test:int` — expect PASS**
- [ ] **Step 5: Commit** `feat(backend-api): add platform outbox and processed_events tables`

---

### Task 3: `publish()` inside the caller's transaction

**Files:**

- Create: `apps/backend-api/src/platform/events/publish.ts`
- Test: `apps/backend-api/test/platform/events/publish.int.test.ts`

**Interfaces:**

- Consumes: Task 1's `EventDefinition`, Task 2's `outbox` table.
- Produces:
  - `publish<S>(tx: Tx, definition: EventDefinition<S>, input: PublishInput<S>): Promise<EventEnvelope<z.infer<S>>>` where `PublishInput` is `{ payload, aggregateType?, aggregateId?, correlationId?, causationId?, actor?, eventId?, occurredAt? }`.
  - `publishInOwnTransaction(db: Db, definition, input)` — opens a transaction for callers that have none (the dead-letter ops event).
  - `type Tx` — the drizzle transaction type, exported for handlers.

- [ ] **Step 1: Write the failing tests**

```ts
it('writes one row inside the caller transaction', …);          // db.transaction → row visible after commit
it('publishes nothing when the transaction rolls back', …);      // throw inside db.transaction → 0 rows
it('rejects a payload that does not match the schema', …);       // expect(...).rejects.toThrow(ZodError)
it('defaults actor to SYSTEM and occurredAt to now', …);
it('generates a time-ordered uuid v7 eventId when none is given', …);
```

- [ ] **Step 2: Run the file — expect FAIL (module not found)**
- [ ] **Step 3: Implement `publish.ts`** — parse `input.payload` with `definition.payload` before the insert; `uuidv7()` from `uuid`.
- [ ] **Step 4: Run the file — expect PASS**
- [ ] **Step 5: Commit** `feat(backend-api): add transactional outbox publish`

---

### Task 4: Subscriber registry and exactly-once handling

**Files:**

- Create: `apps/backend-api/src/platform/events/bus.ts`
- Create: `apps/backend-api/src/platform/events/index.ts` (barrel: publish, bus, emitter, relay)
- Test: `apps/backend-api/test/platform/events/bus.int.test.ts`

**Interfaces:**

- Consumes: `QueueFactory` (T-023), Task 2's `processedEvents`, Task 3's `publish`.
- Produces:
  - `createEventBus({ db, queues, logger, role: 'api' | 'worker' }): EventBus`
  - `EventBus.subscribe<S>(subscription: { name: string; event: EventDefinition<S>; handler: (envelope: EventEnvelope<z.infer<S>>, tx: Tx) => Promise<void>; attempts?: number; concurrency?: number }): void` — `name` is `<module>.<handler>`, queue name `events.<name>`; `concurrency` defaults to 1 so per-aggregate order survives delivery.
  - `EventBus.subscribers(eventType: string): string[]` — what the relay fans out to.
  - `EventBus.publish(tx, definition, input)` — re-exported `publish`.
  - `SUBSCRIBER_QUEUE_PREFIX = 'events.'`

- [ ] **Step 1: Write the failing tests**

```ts
it('runs the handler once and records the eventId for that subscriber', …);
it('is a no-op when the same envelope is delivered again', …);      // handler side effect count stays 1
it('lets a different subscriber process the same eventId', …);
it('rolls the processed_events marker back when the handler throws', …);  // row absent, side effect absent
it('rejects a duplicate subscriber name', …);
it('defines the queue but consumes nothing when role is api', …);   // queues.consume not called
```

- [ ] **Step 2: Run the file — expect FAIL**
- [ ] **Step 3: Implement `bus.ts`** — the queue processor parses the job data with `eventEnvelopeSchema` then `definition.payload`, and inside one `db.transaction`: `INSERT … ON CONFLICT DO NOTHING` returning the inserted row; when nothing was inserted, log at debug and return without calling the handler.
- [ ] **Step 4: Run the file — expect PASS**
- [ ] **Step 5: Commit** `feat(backend-api): add typed event bus with exactly-once subscribers`

---

### Task 5: The outbox relay

**Files:**

- Create: `apps/backend-api/src/platform/events/relay.ts`
- Test: `apps/backend-api/test/platform/events/relay.int.test.ts`

**Interfaces:**

- Consumes: Task 4's `EventBus.subscribers`, the queue factory's `producer`.
- Produces:
  - `startOutboxRelay({ db, bus, queues, logger, pollMs?, batchSize?, outboxRetentionDays?, processedRetentionDays? }): RunningRelay`
  - `RunningRelay.stop(): Promise<void>` — finishes the tick in flight, then stops.
  - `RunningRelay.tick(): Promise<number>` — one pass, returns rows published; exported so tests drive it without timers.
  - `OUTBOX_POLL_MS = 500`, `OUTBOX_BATCH_SIZE = 100`.

- [ ] **Step 1: Write the failing tests**

```ts
it('moves an unpublished row to every subscribed queue and marks it published', …);
it('marks an event with no subscribers published without enqueueing', …);
it('delivers one aggregate\'s events in seq order', …);              // three events, one aggregateId
it('leaves the row unpublished when the enqueue fails', …);          // producer stub throws → published_at null
it('claims rows with FOR UPDATE SKIP LOCKED', …);                    // concurrent tick in a second connection publishes disjoint rows
it('prunes published rows older than the retention window', …);
it('leaves unpublished rows alone however old', …);
```

- [ ] **Step 2: Run the file — expect FAIL**
- [ ] **Step 3: Implement `relay.ts`** — one transaction per tick: `SELECT … WHERE published_at IS NULL ORDER BY seq LIMIT $1 FOR UPDATE SKIP LOCKED`, enqueue per subscriber (`queues.producer('events.' + name).add(eventType, envelope, { jobId: eventId + ':' + name })` so a retry of the same row does not double-queue), then `UPDATE … SET published_at = now()` for the rows whose enqueues all resolved. Prune runs on one tick in sixty.
- [ ] **Step 4: Run the file — expect PASS**
- [ ] **Step 5: Commit** `feat(backend-api): add the outbox relay loop`

---

### Task 6: In-process emitter for lossy effects

**Files:**

- Create: `apps/backend-api/src/platform/events/emitter.ts`
- Test: `apps/backend-api/test/platform/events/emitter.test.ts`

**Interfaces:**

- Produces: `createInProcessEmitter(logger): InProcessEmitter` with `on(eventType, listener)` and `emit(eventType, payload)`; a listener that throws is logged and never reaches the caller.

- [ ] **Step 1: Write the failing tests**

```ts
it('delivers to every listener in registration order', …);
it('swallows and logs a listener error', …);                 // emit() still returns, other listeners ran
it('is in-process only: a second emitter instance sees nothing', …);
```

- [ ] **Step 2: Run the file — expect FAIL**
- [ ] **Step 3: Implement `emitter.ts`** — file header states the rule verbatim: in-process only, lossy, for effects that are safe to lose and recompute (cache invalidation, socket fan-out); anything that must survive a crash goes through the outbox.
- [ ] **Step 4: Run the file — expect PASS**
- [ ] **Step 5: Commit** `feat(backend-api): add the in-process emitter for lossy effects`

---

### Task 7: Wire the bus into both processes and the dead-letter ops event

**Files:**

- Modify: `apps/backend-api/src/platform/module.ts` (`ModuleContext` gains `events: EventBus`)
- Modify: `apps/backend-api/src/server.ts` (bus with `role: 'api'`)
- Modify: `apps/backend-api/src/worker-process.ts` (bus with `role: 'worker'`, relay started after modules, stopped before queues)
- Test: `apps/backend-api/test/integration/events.int.test.ts`, `apps/backend-api/test/platform/module.test.ts`

**Interfaces:**

- Consumes: Tasks 3–5.
- Produces: `ModuleContext.events`; the worker's `onDeadLetter` hook publishing `platform.queue.dead_lettered` through `publishInOwnTransaction`.

- [ ] **Step 1: Write the failing tests**

```ts
it('publishes from an api instance and handles in the worker', …);   // end-to-end: startApi + startWorker, one module, eventually(…)
it('publishes platform.queue.dead_lettered when a job dead-letters', …);
it('does not relay from the api process', …);                        // row stays unpublished with no worker running
it('stops the relay before closing queues on shutdown', …);
```

- [ ] **Step 2: Run the file — expect FAIL**
- [ ] **Step 3: Wire both processes** — the dead-letter publish is fire-and-forget with a `.catch` that logs; a failure there must never take the worker down.
- [ ] **Step 4: Run `pnpm --filter @komtru/backend-api test:int` — expect PASS**
- [ ] **Step 5: Commit** `feat(backend-api): wire the event bus into the api and worker processes`

---

### Task 8: Verification, docs and ticket status

- [ ] **Step 1:** `pnpm exec turbo run build lint typecheck test --force` and `pnpm exec prettier --check .` — all green.
- [ ] **Step 2:** `KOMTRU_INFRA_TESTS=1 pnpm --filter @komtru/backend-api test` — all green, note the test count.
- [ ] **Step 3:** Fresh whole-branch reviewer subagent; triage findings with superpowers:receiving-code-review; fix what is real.
- [ ] **Step 4:** Mark T-024 Done in `docs/tickets/02-backend-platform.md` with the plan link and a `- **Deferred:**` line for anything left; drop the "to be wired to the bus in T-024" clause from T-023's status line now that it is wired.
- [ ] **Step 5:** Commit and hand the branch to the merge step.
