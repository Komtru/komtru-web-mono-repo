// The trade realtime wire contract (T-068). `tradeUpdateSchema` in shared-types is what the workspace UI
// codes against; this test parses what the backend's push definitions ACTUALLY produce with it, so a
// push that changes shape, grows a field or drops one fails here rather than as a stale screen. The
// schema is strict: a field added to a push (a reason, an actor, an amount) is a failure, not a bonus.
import {
  TRADE_ROOM_PREFIX as SHARED_ROOM_PREFIX,
  TRADE_UPDATED_EVENT as SHARED_EVENT,
  TRADE_UPDATE_KINDS,
  tradeUpdateSchema,
} from '@komtru/shared-types';
import { pushDisposition } from '../../../../src/modules/trades/domain/visibility.js';
import { describe, expect, it, vi } from 'vitest';
import {
  TRADE_PUSHES,
  TRADE_ROOM_PREFIX,
  TRADE_UPDATED_EVENT,
  pushHandler,
} from '../../../../src/modules/trades/infrastructure/realtime.js';
import { transitionTriples } from '../../../../src/modules/trades/domain/stateMachine.js';
import { testLogger } from '../../identity/support.js';
import { SAMPLES, envelope, tradeCode, tradeId } from '../push-samples.js';

const produce = async (push: (typeof TRADE_PUSHES)[number], payload: unknown) => {
  const emitToRoom = vi.fn();
  const after = await pushHandler({ emitToRoom }, testLogger, push)(envelope(payload));
  await after();
  return emitToRoom.mock.calls[0] as [string, string, string, unknown];
};

describe('trade:updated wire contract', () => {
  it('is the room prefix and event name the shared contract declares', () => {
    expect(TRADE_ROOM_PREFIX).toBe(SHARED_ROOM_PREFIX);
    expect(TRADE_UPDATED_EVENT).toBe(SHARED_EVENT);
    expect(SHARED_EVENT).toBe('trade:updated');
  });

  it('parses every payload each push produces', async () => {
    for (const push of TRADE_PUSHES) {
      const [prefix, id, event, payload] = await produce(
        push,
        push.event.payload.parse(SAMPLES[push.event.eventType]),
      );
      expect(prefix).toBe(SHARED_ROOM_PREFIX);
      expect(id).toBe(tradeCode);
      expect(event).toBe(SHARED_EVENT);
      const parsed = tradeUpdateSchema.safeParse(payload);
      expect(parsed.success, `${push.subscriber}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('parses a state change for every edge of the state machine', async () => {
    const push = TRADE_PUSHES[0]!;
    for (const [action, from, to] of transitionTriples()) {
      // A change that would announce a review is not pushed at all, so there is nothing to parse.
      if (pushDisposition(from, to) === 'WITHHOLD') continue;
      const [, , , payload] = await produce(push, {
        tradeId,
        tradeCode,
        action,
        from,
        to,
        actorType: 'SYSTEM',
      });
      expect(tradeUpdateSchema.safeParse(payload).success, `${action} ${from}->${to}`).toBe(true);
    }
  });

  it('is produced for every declared kind, and by no undeclared one', async () => {
    const produced = new Set<string>();
    for (const push of TRADE_PUSHES) {
      const [, , , payload] = await produce(push, push.event.payload.parse(SAMPLES[push.event.eventType]));
      produced.add((payload as { kind: string }).kind);
    }
    expect([...produced].sort()).toEqual([...TRADE_UPDATE_KINDS].sort());
  });

  it('refuses a payload that carries anything the contract does not name', () => {
    const base = {
      tradeId,
      tradeCode,
      kind: 'REFUND_REQUESTED',
      occurredAt: '2026-11-09T10:00:00.000Z',
    };
    expect(tradeUpdateSchema.safeParse(base).success).toBe(true);
    for (const leak of [{ reason: 'staff note' }, { actorId: tradeId }, { amountMinor: '100' }]) {
      expect(tradeUpdateSchema.safeParse({ ...base, ...leak }).success).toBe(false);
    }
  });

  it('refuses a state change with no status, and a non-canonical trade code', () => {
    const base = { tradeId, tradeCode, occurredAt: '2026-11-09T10:00:00.000Z' };
    expect(tradeUpdateSchema.safeParse({ ...base, kind: 'STATE_CHANGED' }).success).toBe(false);
    expect(
      tradeUpdateSchema.safeParse({ ...base, kind: 'REFUND_REQUESTED', tradeCode: 'kmt-7398512' }).success,
    ).toBe(false);
  });
});
