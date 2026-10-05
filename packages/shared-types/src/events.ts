// Domain events. One envelope for the whole platform (M1 §11), published through the transactional
// outbox (design §4.3) and delivered at least once, so every consumer is idempotent on `eventId`.
import { z } from 'zod';
import { uuidSchema } from './ids.js';
import { SESSION_SCOPES } from './enums.js';

/** `module.thing.happened`: three lower-case segments, so the module that owns an event is obvious. */
export const eventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/, 'Event types look like identity.user.registered');

/** Who caused the event: the actor's session scope, or SYSTEM for a job or a scheduled sweep. */
export const eventActorSchema = z.object({
  type: z.enum([...SESSION_SCOPES, 'SYSTEM']),
  id: uuidSchema.optional(),
});
export type EventActor = z.infer<typeof eventActorSchema>;

export const SYSTEM_ACTOR: EventActor = { type: 'SYSTEM' };

export const eventEnvelopeSchema = z.object({
  eventId: uuidSchema,
  eventType: eventTypeSchema,
  /** Bumped when a payload changes shape; consumers may handle more than one version. */
  version: z.number().int().min(1),
  occurredAt: z.iso.datetime(),
  /** The request or job that started the chain, and the event immediately before this one. */
  correlationId: uuidSchema.optional(),
  causationId: uuidSchema.optional(),
  actor: eventActorSchema.default(SYSTEM_ACTOR),
  payload: z.unknown(),
});

export type EventEnvelope<P = unknown> = Omit<z.infer<typeof eventEnvelopeSchema>, 'payload'> & {
  payload: P;
};

/** An event type, its version and its payload schema, declared once and imported by both sides. */
export interface EventDefinition<S extends z.ZodType = z.ZodType> {
  eventType: string;
  version: number;
  payload: S;
}

export function defineEvent<S extends z.ZodType>(
  eventType: string,
  version: number,
  payload: S,
): EventDefinition<S> {
  return {
    eventType: eventTypeSchema.parse(eventType),
    version: z.number().int().min(1).parse(version),
    payload,
  };
}

/**
 * Published when a job exhausts its attempts and lands in the dead-letter queue (T-023's
 * `onDeadLetter` hook). The first consumer is ops alerting.
 */
export const queueDeadLetteredEvent = defineEvent(
  'platform.queue.dead_lettered',
  1,
  z.object({
    queue: z.string().min(1),
    jobId: z.string().optional(),
    name: z.string().min(1),
    attempts: z.number().int().min(0),
    error: z.string(),
    failedAt: z.iso.datetime(),
  }),
);
