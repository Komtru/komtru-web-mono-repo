// The read half of the outbox (design §4.3): one BullMQ queue per subscriber, and exactly-once
// handling on top of at-least-once delivery.
//
// A subscriber's processor opens one transaction, claims the event by inserting into
// platform.processed_events, and runs the handler inside that same transaction. A redelivery finds
// the row and does nothing; a handler that throws takes its marker down with its writes, so the
// retry runs the whole thing again.
import { eventEnvelopeSchema, type EventDefinition, type EventEnvelope } from '@komtru/shared-types';
import { UnrecoverableError } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../../db/index.js';
import { processedEvents } from '../../db/platform-schema.js';
import type { Logger } from '../logger.js';
import type { QueueDefinition, QueueFactory } from '../queue/factory.js';
import { publish, type PublishInput, type Tx } from './publish.js';

export const SUBSCRIBER_QUEUE_PREFIX = 'events.';

/** Work a handler defers until its transaction has committed. See `EventSubscription.handler`. */
export type AfterCommit = () => Promise<void>;

/** `module.handler`, e.g. `ledger.on-trade-completed`: the queue name and the processed_events key. */
const SUBSCRIBER_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9-]*$/;

export interface EventSubscription<S extends z.ZodType = z.ZodType> {
  name: string;
  event: EventDefinition<S>;
  /**
   * Runs inside the claim's transaction. Anything that must NOT happen until those writes are
   * visible — enqueueing a job that reads them, calling out to a provider — is returned as a
   * callback instead, and the bus runs it after the commit.
   *
   * Doing that work inside the handler races the commit: a worker can pick the job up and find no
   * row, which costs an attempt at best and dead-letters a perfectly good notification at worst.
   */
  handler: (envelope: EventEnvelope<z.output<S>>, tx: Tx) => Promise<AfterCommit | void>;
  attempts?: number;
  /**
   * One at a time by default, so a subscriber's queue is worked in the order the relay enqueued it.
   * Note this is not an ordering guarantee: a failed job waits out its backoff while BullMQ runs
   * the next one, so a handler must be commutative or carry its own guard. Raise it only for a
   * handler whose order plainly does not matter.
   */
  concurrency?: number;
}

export interface EventBus {
  subscribe<S extends z.ZodType>(subscription: EventSubscription<S>): void;
  /** Subscriber names for an event type, in registration order. The relay fans out to these. */
  subscribers(eventType: string): string[];
  /** Every subscriber queue name, for the relay's producers. */
  queueFor(subscriber: string): string;
  publish<S extends z.ZodType>(
    tx: Tx,
    definition: EventDefinition<S>,
    input: PublishInput<z.input<S>>,
  ): Promise<EventEnvelope<z.output<S>>>;
}

export interface EventBusOptions {
  db: Db;
  queues: QueueFactory;
  logger: Logger;
  /** The api defines subscriber queues so retry policy agrees fleet-wide, but consumes none. */
  role: 'api' | 'worker';
}

export const queueFor = (subscriber: string): string => `${SUBSCRIBER_QUEUE_PREFIX}${subscriber}`;

export function createEventBus({ db, queues, logger, role }: EventBusOptions): EventBus {
  const byEventType = new Map<string, string[]>();
  const names = new Set<string>();

  const subscribe = <S extends z.ZodType>(subscription: EventSubscription<S>): void => {
    const { name, event, handler } = subscription;
    if (!SUBSCRIBER_NAME.test(name)) {
      throw new Error(`event bus: subscriber '${name}' should look like module.on-thing-happened`);
    }
    if (names.has(name)) throw new Error(`event bus: duplicate subscriber '${name}'`);
    names.add(name);
    byEventType.set(event.eventType, [...(byEventType.get(event.eventType) ?? []), name]);

    const definition: QueueDefinition<unknown> = {
      name: queueFor(name),
      attempts: subscription.attempts,
      concurrency: subscription.concurrency ?? 1,
      process: async (data) => {
        const envelope = eventEnvelopeSchema.parse(data);
        if (envelope.version !== event.version) {
          // Deterministic: retrying it five times only delays the dead-letter and its alert.
          throw new UnrecoverableError(
            `event ${envelope.eventType} v${envelope.version} reached '${name}', which handles v${event.version}`,
          );
        }
        const payload = event.payload.parse(envelope.payload);
        let afterCommit: AfterCommit | undefined;
        await db.transaction(async (tx) => {
          const claimed = await tx
            .insert(processedEvents)
            .values({ eventId: envelope.eventId, subscriber: name })
            .onConflictDoNothing()
            .returning({ eventId: processedEvents.eventId });
          if (!claimed.length) {
            logger.debug({ subscriber: name, eventId: envelope.eventId }, 'events: already processed');
            return;
          }
          afterCommit = (await handler({ ...envelope, payload }, tx)) ?? undefined;
        });
        // Only once the writes above are visible to every other connection. A redelivery is already
        // a no-op by the claim, so a failure here is not retried by this path — which is why a
        // handler's deferred work is expected to carry its own floor, the way notify's sweep does.
        await afterCommit?.();
      },
    };

    if (role === 'worker') queues.consume(definition);
    else queues.define(definition);
  };

  return {
    subscribe,
    queueFor,
    subscribers: (eventType) => [...(byEventType.get(eventType) ?? [])],
    publish: (tx, definition, input) => publish(tx, definition, input),
  };
}

/** Whether a subscriber has already handled an event; for tests and ops queries. */
export const hasProcessed = async (db: Db, eventId: string, subscriber: string): Promise<boolean> => {
  const rows = await db
    .select({ eventId: processedEvents.eventId })
    .from(processedEvents)
    .where(and(eq(processedEvents.eventId, eventId), eq(processedEvents.subscriber, subscriber)));
  return rows.length > 0;
};
