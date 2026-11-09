// What a trade room is told (T-068). The payloads are a "refetch now" signal, so the tests pin both
// that every state change produces one and that nothing sensitive can ride along.
import { describe, expect, it, vi } from 'vitest';
import {
  TRADE_PUSHES,
  TRADE_UPDATED_EVENT,
  pushHandler,
} from '../../../../src/modules/trades/infrastructure/realtime.js';
import { tradeStateChangedEvent } from '../../../../src/modules/trades/domain/events.js';
import { transitionTriples } from '../../../../src/modules/trades/domain/stateMachine.js';
import { testLogger } from '../../identity/support.js';
import { SAMPLES, envelope, now, tradeCode, tradeId, user } from '../push-samples.js';

describe('trade pushes', () => {
  it('has one subscriber per event, with distinct, well-formed names', () => {
    const names = TRADE_PUSHES.map((push) => push.subscriber);
    expect(new Set(names).size).toBe(names.length);
    const events = TRADE_PUSHES.map((push) => push.event.eventType);
    expect(new Set(events).size).toBe(events.length);
    for (const name of names) expect(name).toMatch(/^trades\.[a-z][a-z0-9-]*$/);
  });

  it('has a sample payload that its own event schema accepts, for every push', () => {
    for (const push of TRADE_PUSHES) {
      const sample = SAMPLES[push.event.eventType];
      expect(sample, `no sample for ${push.event.eventType}`).toBeDefined();
      expect(push.event.payload.safeParse(sample).success).toBe(true);
    }
  });

  it('never carries a reason, an actor or any user id', async () => {
    for (const push of TRADE_PUSHES) {
      const emitToRoom = vi.fn();
      const after = await pushHandler(
        { emitToRoom },
        testLogger,
        push,
      )(envelope(push.event.payload.parse(SAMPLES[push.event.eventType])));
      await after();
      const sent = JSON.stringify(emitToRoom.mock.calls[0]?.[3]);
      expect(sent).not.toContain('reason');
      expect(sent).not.toContain('staff-only');
      expect(sent).not.toContain(user);
      expect(sent).not.toContain('actorId');
    }
  });

  it('addresses the canonical trade room with the trade:updated event', async () => {
    const push = TRADE_PUSHES.find((p) => p.event === tradeStateChangedEvent)!;
    const emitToRoom = vi.fn();
    const after = await pushHandler(
      { emitToRoom },
      testLogger,
      push,
    )(envelope(tradeStateChangedEvent.payload.parse(SAMPLES['trades.trade.state_changed'])));
    await after();
    expect(emitToRoom).toHaveBeenCalledWith('trade', tradeCode, TRADE_UPDATED_EVENT, {
      tradeId,
      tradeCode,
      kind: 'STATE_CHANGED',
      status: 'PENDING_PAYMENT',
      previousStatus: 'AWAITING_ACCEPTANCE',
      action: 'ACCEPT',
      occurredAt: now,
    });
  });

  it('does not emit until the transaction has committed', async () => {
    const push = TRADE_PUSHES[0]!;
    const emitToRoom = vi.fn();
    const after = await pushHandler(
      { emitToRoom },
      testLogger,
      push,
    )(envelope(push.event.payload.parse(SAMPLES[push.event.eventType])));
    expect(emitToRoom).not.toHaveBeenCalled();
    await after();
    expect(emitToRoom).toHaveBeenCalledTimes(1);
  });

  it('survives an emit that throws, because the HTTP read is the source of truth', async () => {
    const push = TRADE_PUSHES[0]!;
    const after = await pushHandler(
      {
        emitToRoom: () => {
          throw new Error('redis is away');
        },
      },
      testLogger,
      push,
    )(envelope(push.event.payload.parse(SAMPLES[push.event.eventType])));
    await expect(after()).resolves.toBeUndefined();
  });

  it('pushes for every edge of the state machine', async () => {
    const push = TRADE_PUSHES.find((p) => p.event === tradeStateChangedEvent)!;
    const triples = transitionTriples();
    expect(triples.length).toBeGreaterThan(20);
    for (const [action, from, to] of triples) {
      const emitToRoom = vi.fn();
      const after = await pushHandler(
        { emitToRoom },
        testLogger,
        push,
      )(envelope({ tradeId, tradeCode, action, from, to, actorType: 'SYSTEM' }));
      await after();
      expect(emitToRoom.mock.calls[0]?.[3]).toMatchObject({ kind: 'STATE_CHANGED', status: to, action });
    }
  });
});
