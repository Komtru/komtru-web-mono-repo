// platform.idempotency_keys as the runtime role sees it. Skipped unless KOMTRU_INFRA_TESTS=1.
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

describe.runIf(infraEnabled)('platform.idempotency_keys', () => {
  const t = useTestDatabase();

  const claim = (actor = 'anon', key = 'key-1', hash = 'hash-1') =>
    t.app().query(
      `INSERT INTO platform.idempotency_keys (scope, key, actor, request_hash, method, path)
       VALUES ('CONSUMER', $1, $2, $3, 'POST', '/v1/trades')`,
      [key, actor, hash],
    );

  it('lets the runtime role claim a key and store the response on it', async () => {
    await claim();
    await t
      .app()
      .query(
        `UPDATE platform.idempotency_keys SET status = 201, response = '{"id":"x"}'::jsonb, completed_at = now()`,
      );
    const { rows } = await t
      .app()
      .query<{ status: number; response: { id: string }; completed_at: Date }>(
        'SELECT status, response, completed_at FROM platform.idempotency_keys',
      );
    expect(rows[0]).toMatchObject({ status: 201, response: { id: 'x' } });
    expect(rows[0]?.completed_at).toBeInstanceOf(Date);
  });

  it('starts in flight: no status, no response, no completion', async () => {
    await claim();
    const { rows } = await t
      .app()
      .query<{ status: number | null; response: unknown; completed_at: Date | null }>(
        'SELECT status, response, completed_at FROM platform.idempotency_keys',
      );
    expect(rows[0]).toEqual({ status: null, response: null, completed_at: null });
  });

  it('rejects the same key twice for one scope and actor', async () => {
    await claim();
    expect(await sqlState(claim())).toBe('23505');
  });

  it("keeps one actor's key out of another actor's way", async () => {
    await claim('user:0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b');
    await claim('anon');
    const { rows } = await t.app().query('SELECT actor FROM platform.idempotency_keys');
    expect(rows).toHaveLength(2);
  });
});
