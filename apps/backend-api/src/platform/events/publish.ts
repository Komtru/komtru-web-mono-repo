// The write half of the transactional outbox (design §4.3): a domain event is a row written in the
// same transaction as the state change that caused it, so a rollback publishes nothing and a commit
// cannot lose the event. The relay (relay.ts) does the publishing afterwards.
import {
  SYSTEM_ACTOR,
  type EventActor,
  type EventDefinition,
  type EventEnvelope,
} from '@komtru/shared-types';
import { v7 as uuidv7 } from 'uuid';
import type { z } from 'zod';
import type { Db } from '../../db/index.js';
import { outbox } from '../../db/platform-schema.js';

/** The transaction a caller is already inside. Handlers and services pass this around, never `Db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface PublishInput<P> {
  payload: P;
  /** The thing the event is about. Per-aggregate ordering is the only order the relay promises. */
  aggregateType?: string;
  aggregateId?: string;
  /** The request or job that started the chain, and the event immediately before this one. */
  correlationId?: string;
  causationId?: string;
  actor?: EventActor;
  /** Supplied only when the caller must control the id (e.g. to make a retry idempotent). */
  eventId?: string;
  occurredAt?: string;
}

export async function publish<S extends z.ZodType>(
  tx: Tx,
  definition: EventDefinition<S>,
  input: PublishInput<z.input<S>>,
): Promise<EventEnvelope<z.output<S>>> {
  // Parsed here, at the publisher, so a bad payload fails the caller's transaction rather than
  // every subscriber's job five minutes later.
  const payload = definition.payload.parse(input.payload) as z.output<S>;
  const envelope: EventEnvelope<z.output<S>> = {
    eventId: input.eventId ?? uuidv7(),
    eventType: definition.eventType,
    version: definition.version,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    correlationId: input.correlationId,
    causationId: input.causationId,
    actor: input.actor ?? SYSTEM_ACTOR,
    payload,
  };

  await tx.insert(outbox).values({
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    version: envelope.version,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    occurredAt: new Date(envelope.occurredAt),
    correlationId: envelope.correlationId,
    causationId: envelope.causationId,
    actor: envelope.actor,
    payload: envelope.payload,
  });

  return envelope;
}

/**
 * For the few publishers with no transaction of their own — a job that failed, a scheduled sweep.
 * Anything that changes state must use `publish` inside that change's transaction instead.
 */
export const publishInOwnTransaction = <S extends z.ZodType>(
  db: Db,
  definition: EventDefinition<S>,
  input: PublishInput<z.input<S>>,
): Promise<EventEnvelope<z.output<S>>> => db.transaction((tx) => publish(tx, definition, input));
