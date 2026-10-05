// publish() against a real database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { defineEvent } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { publish, publishInOwnTransaction } from '../../../src/platform/events/publish.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

const tradeCompleted = defineEvent(
  'trades.trade.completed',
  3,
  z.object({ tradeId: z.uuid(), amountKobo: z.number().int() }),
);

const TRADE_ID = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';
const payload = { tradeId: TRADE_ID, amountKobo: 250_000 };

interface OutboxRow {
  event_id: string;
  event_type: string;
  version: number;
  aggregate_type: string | null;
  aggregate_id: string | null;
  actor: { type: string; id?: string };
  payload: typeof payload;
  occurred_at: Date;
  published_at: Date | null;
  correlation_id: string | null;
}

describe.runIf(infraEnabled)('publish()', () => {
  const t = useTestDatabase();
  const rows = () => t.app().query<OutboxRow>('SELECT * FROM platform.outbox ORDER BY seq');

  it('writes one row inside the caller transaction', async () => {
    await t.db().transaction(async (tx) => {
      await publish(tx, tradeCompleted, { payload, aggregateType: 'trade', aggregateId: TRADE_ID });
    });
    const { rows: written } = await rows();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      event_type: 'trades.trade.completed',
      version: 3,
      aggregate_type: 'trade',
      aggregate_id: TRADE_ID,
      payload,
      published_at: null,
    });
  });

  it('publishes nothing when the transaction rolls back', async () => {
    await expect(
      t.db().transaction(async (tx) => {
        await publish(tx, tradeCompleted, { payload });
        throw new Error('state change failed');
      }),
    ).rejects.toThrow('state change failed');
    expect((await rows()).rows).toHaveLength(0);
  });

  it('returns the envelope it wrote', async () => {
    const envelope = await t
      .db()
      .transaction((tx) => publish(tx, tradeCompleted, { payload, actor: { type: 'CONSUMER' } }));
    const [row] = (await rows()).rows;
    expect(envelope.eventId).toBe(row?.event_id);
    expect(envelope.eventType).toBe('trades.trade.completed');
    expect(envelope.occurredAt).toBe(row?.occurred_at.toISOString());
    expect(envelope.payload).toEqual(payload);
  });

  it('rejects a payload that does not match the event schema', async () => {
    await expect(
      // The type says string; the schema says uuid. The publisher is where that is caught.
      t
        .db()
        .transaction((tx) => publish(tx, tradeCompleted, { payload: { tradeId: 'nope', amountKobo: 1 } })),
    ).rejects.toThrow();
    expect((await rows()).rows).toHaveLength(0);
  });

  it('defaults the actor to SYSTEM', async () => {
    await t.db().transaction((tx) => publish(tx, tradeCompleted, { payload }));
    expect((await rows()).rows[0]?.actor).toEqual({ type: 'SYSTEM' });
  });

  it('generates time-ordered event ids', async () => {
    await t.db().transaction(async (tx) => {
      await publish(tx, tradeCompleted, { payload });
      await publish(tx, tradeCompleted, { payload });
    });
    const [first, second] = (await rows()).rows;
    expect(first?.event_id).not.toBe(second?.event_id);
    // uuid v7: the first 48 bits are a millisecond timestamp, so lexical order is time order.
    expect([first?.event_id, second?.event_id].sort()).toEqual([first?.event_id, second?.event_id]);
  });

  it('keeps a caller-supplied event id, correlation id and occurredAt', async () => {
    const occurredAt = '2026-10-05T09:30:00.000Z';
    await t.db().transaction((tx) =>
      publish(tx, tradeCompleted, {
        payload,
        eventId: TRADE_ID,
        correlationId: TRADE_ID,
        occurredAt,
      }),
    );
    const [row] = (await rows()).rows;
    expect(row?.event_id).toBe(TRADE_ID);
    expect(row?.correlation_id).toBe(TRADE_ID);
    expect(row?.occurred_at.toISOString()).toBe(occurredAt);
  });
});

describe.runIf(infraEnabled)('publishInOwnTransaction()', () => {
  const t = useTestDatabase();

  it('opens a transaction for callers that have none', async () => {
    await publishInOwnTransaction(t.db(), tradeCompleted, { payload });
    const { rows } = await t.app().query('SELECT event_type FROM platform.outbox');
    expect(rows).toEqual([{ event_type: 'trades.trade.completed' }]);
  });
});
