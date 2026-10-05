// The outbox and processed-events tables as the runtime role sees them. Skipped unless KOMTRU_INFRA_TESTS=1.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../support/db-urls.js';
import { useTestDatabase } from '../support/db.js';

const sqlState = async (query: Promise<unknown>) => {
  try {
    await query;
  } catch (error) {
    return (error as pg.DatabaseError).code;
  }
  return 'no error';
};

const EVENT_ID = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';

const insertEvent = (pool: pg.Pool, eventId = EVENT_ID, eventType = 'identity.user.registered') =>
  pool.query<{ seq: string }>(
    `INSERT INTO platform.outbox (event_id, event_type, version, actor, payload)
     VALUES ($1, $2, 1, '{"type":"SYSTEM"}'::jsonb, '{}'::jsonb) RETURNING seq`,
    [eventId, eventType],
  );

describe.runIf(infraEnabled)('platform.outbox', () => {
  const t = useTestDatabase();

  it('lets the runtime role insert, read and mark a row published', async () => {
    const { rows } = await insertEvent(t.app());
    const seq = rows[0]?.seq;
    expect(seq).toBeDefined();
    await t.app().query('UPDATE platform.outbox SET published_at = now() WHERE seq = $1', [seq]);
    const { rows: published } = await t
      .app()
      .query<{ published_at: Date | null; occurred_at: Date }>(
        'SELECT published_at, occurred_at FROM platform.outbox WHERE seq = $1',
        [seq],
      );
    expect(published[0]?.published_at).toBeInstanceOf(Date);
    expect(published[0]?.occurred_at).toBeInstanceOf(Date);
  });

  it('hands out increasing sequence numbers', async () => {
    const first = await insertEvent(t.app(), '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a01');
    const second = await insertEvent(t.app(), '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a02');
    expect(Number(second.rows[0]?.seq)).toBeGreaterThan(Number(first.rows[0]?.seq));
  });

  it('rejects a second row with the same event id', async () => {
    await insertEvent(t.app());
    expect(await sqlState(insertEvent(t.app()))).toBe('23505');
  });

  it('starts unpublished', async () => {
    await insertEvent(t.app());
    const { rows } = await t
      .app()
      .query('SELECT published_at FROM platform.outbox WHERE published_at IS NULL');
    expect(rows).toHaveLength(1);
  });
});

describe.runIf(infraEnabled)('platform.processed_events', () => {
  const t = useTestDatabase();

  const mark = (subscriber: string) =>
    t
      .app()
      .query('INSERT INTO platform.processed_events (event_id, subscriber) VALUES ($1, $2)', [
        EVENT_ID,
        subscriber,
      ]);

  it('records one row per event and subscriber', async () => {
    await mark('ledger.on-trade-completed');
    await mark('notify.on-trade-completed');
    const { rows } = await t.app().query('SELECT subscriber FROM platform.processed_events');
    expect(rows).toHaveLength(2);
  });

  it('rejects the same event twice for one subscriber', async () => {
    await mark('ledger.on-trade-completed');
    expect(await sqlState(mark('ledger.on-trade-completed'))).toBe('23505');
  });
});
