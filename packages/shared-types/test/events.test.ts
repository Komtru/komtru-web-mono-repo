import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineEvent,
  eventActorSchema,
  eventEnvelopeSchema,
  eventTypeSchema,
  queueDeadLetteredEvent,
} from '../src/events.js';

const envelope = {
  eventId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b',
  eventType: 'identity.user.registered',
  version: 1,
  occurredAt: '2026-10-05T09:30:00.000Z',
  correlationId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c',
  causationId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5d',
  actor: { type: 'CONSUMER', id: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5e' },
  payload: { userId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5e' },
};

describe('eventEnvelopeSchema', () => {
  it('accepts the M1 §11 envelope', () => {
    expect(eventEnvelopeSchema.parse(envelope)).toMatchObject({
      eventType: 'identity.user.registered',
      version: 1,
      actor: { type: 'CONSUMER' },
    });
  });

  it('normalises eventId case', () => {
    const parsed = eventEnvelopeSchema.parse({
      ...envelope,
      eventId: '0199A2B3-C4D5-7E6F-8A9B-0C1D2E3F4A5B',
    });
    expect(parsed.eventId).toBe('0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b');
  });

  it('defaults the actor to SYSTEM', () => {
    const { actor, ...withoutActor } = envelope;
    expect(actor.type).toBe('CONSUMER');
    expect(eventEnvelopeSchema.parse(withoutActor).actor).toEqual({ type: 'SYSTEM' });
  });

  it('leaves correlationId and causationId optional', () => {
    const { correlationId, causationId, ...withoutTrace } = envelope;
    expect(correlationId && causationId).toBeTruthy();
    const parsed = eventEnvelopeSchema.parse(withoutTrace);
    expect(parsed.correlationId).toBeUndefined();
    expect(parsed.causationId).toBeUndefined();
  });

  it.each([
    ['a version below 1', { version: 0 }],
    ['a fractional version', { version: 1.5 }],
    ['an occurredAt that is not a timestamp', { occurredAt: 'yesterday' }],
    ['an event type that is not module.thing.happened', { eventType: 'userRegistered' }],
    ['an actor type outside the scopes', { actor: { type: 'ROBOT' } }],
  ])('rejects %s', (_label, override) => {
    expect(eventEnvelopeSchema.safeParse({ ...envelope, ...override }).success).toBe(false);
  });
});

describe('eventTypeSchema', () => {
  it.each(['identity.user.registered', 'platform.queue.dead_lettered', 'park.parcel.released'])(
    'accepts %s',
    (type) => expect(eventTypeSchema.parse(type)).toBe(type),
  );

  it.each(['userRegistered', 'identity.user', 'Identity.User.Registered', 'identity.user.registered.v2'])(
    'rejects %s',
    (type) => expect(eventTypeSchema.safeParse(type).success).toBe(false),
  );
});

describe('eventActorSchema', () => {
  it('accepts a system actor with no id', () => {
    expect(eventActorSchema.parse({ type: 'SYSTEM' })).toEqual({ type: 'SYSTEM' });
  });

  it('accepts every session scope as an actor type', () => {
    for (const type of ['CONSUMER', 'STAFF', 'LOGISTICS'] as const) {
      expect(eventActorSchema.parse({ type, id: envelope.eventId }).type).toBe(type);
    }
  });
});

describe('defineEvent', () => {
  it('keeps the event type, version and payload schema together', () => {
    const definition = defineEvent('trades.trade.completed', 2, z.object({ tradeId: z.uuid() }));
    expect(definition.eventType).toBe('trades.trade.completed');
    expect(definition.version).toBe(2);
    expect(definition.payload.parse({ tradeId: envelope.eventId })).toEqual({ tradeId: envelope.eventId });
  });

  it('rejects an event type that is not module.thing.happened', () => {
    expect(() => defineEvent('tradeCompleted', 1, z.object({}))).toThrow();
  });
});

describe('queueDeadLetteredEvent', () => {
  it('is the platform ops event a dead-lettered job publishes', () => {
    expect(queueDeadLetteredEvent.eventType).toBe('platform.queue.dead_lettered');
    expect(
      queueDeadLetteredEvent.payload.parse({
        queue: 'notify.sms',
        jobId: '42',
        name: 'send',
        attempts: 5,
        error: 'provider timeout',
        failedAt: '2026-10-05T09:30:00.000Z',
      }).queue,
    ).toBe('notify.sms');
  });

  it('requires the queue name', () => {
    expect(queueDeadLetteredEvent.payload.safeParse({ attempts: 1 }).success).toBe(false);
  });
});
