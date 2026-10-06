// Both trade logs only grow: the trigger stops the owner, and komtru_app simply lacks the privilege.
// Resolves m2 §13.1 (conflict C6) — a rejection is evidence, and evidence that can be rewritten is
// not evidence. Skipped unless KOMTRU_INFRA_TESTS=1.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { grantRuntimeAccess } from '../../../../src/db/roles.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { driveTo, insertTrade, insertUser, sqlState } from '../support.js';

describe.runIf(infraEnabled)('trade append-only logs', () => {
  const t = useTestDatabase();

  const aTrade = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    return insertTrade(t.app(), { buyer, seller });
  };

  // The only way a state-change row comes into being: a transition. A direct INSERT is refused
  // (migration 0021), which is the point of the test two describes below.
  const appendStateChange = async (pool: pg.Pool, tradeId: string) => {
    await driveTo(pool, tradeId, 'AWAITING_ACCEPTANCE');
  };

  const appendActivity = (pool: pg.Pool, tradeId: string) =>
    pool.query(
      `INSERT INTO trade.trade_activity (trade_id, type, actor_type, summary)
       VALUES ($1, 'PROPOSAL_DECLINED', 'BUYER', 'Not the model I wanted')`,
      [tradeId],
    );

  const tables = [
    ['trade.trade_state_changes', appendStateChange],
    ['trade.trade_activity', appendActivity],
  ] as const;

  it.each(tables)('lets the runtime role append to and read %s', async (table, append) => {
    const tradeId = await aTrade();
    await append(t.app(), tradeId);
    const { rows } = await t.app().query(`SELECT 1 FROM ${table}`);
    expect(rows).toHaveLength(1);
  });

  it.each(tables)('denies the runtime role UPDATE on %s', async (table, append) => {
    const tradeId = await aTrade();
    await append(t.app(), tradeId);
    expect(await sqlState(t.app().query(`UPDATE ${table} SET metadata = '{}'::jsonb`))).toBe('42501');
  });

  it.each(tables)('denies the runtime role DELETE on %s', async (table, append) => {
    const tradeId = await aTrade();
    await append(t.app(), tradeId);
    expect(await sqlState(t.app().query(`DELETE FROM ${table}`))).toBe('42501');
  });

  it.each(tables)('raises KT001 on an owner UPDATE of %s', async (table, append) => {
    const tradeId = await aTrade();
    await append(t.owner(), tradeId);
    expect(await sqlState(t.owner().query(`UPDATE ${table} SET metadata = '{}'::jsonb`))).toBe('KT001');
  });

  it.each(tables)('raises KT001 on an owner DELETE of %s', async (table, append) => {
    const tradeId = await aTrade();
    await append(t.owner(), tradeId);
    expect(await sqlState(t.owner().query(`DELETE FROM ${table}`))).toBe('KT001');
  });

  it.each(tables)(
    'keeps %s append-only after a later migrate refreshes the grants',
    async (table, append) => {
      const tradeId = await aTrade();
      const client = await t.owner().connect();
      try {
        await grantRuntimeAccess(client);
      } finally {
        client.release();
      }
      await append(t.app(), tradeId);
      expect(await sqlState(t.app().query(`UPDATE ${table} SET metadata = '{}'::jsonb`))).toBe('42501');
    },
  );
});

describe.runIf(infraEnabled)('trade.trade_state_changes forgery', () => {
  const t = useTestDatabase();

  // Append-only stops the log being edited; it does not stop a row being invented. An audit trail
  // anyone can write to is one anyone can forge — so only the recorder trigger may write here.
  const forge = (pool: pg.Pool, tradeId: string) =>
    pool.query(
      `INSERT INTO trade.trade_state_changes
         (occurred_at, trade_id, from_status, to_status, action, actor_type, actor_id)
       VALUES (now() - interval '3 days', $1, 'INSPECTION', 'COMPLETED', 'COMPLETE', 'BUYER', $2)`,
      [tradeId, '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a21'],
    );

  const aTrade = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    return insertTrade(t.app(), { buyer, seller });
  };

  it('refuses a hand-written row from the runtime role', async () => {
    expect(await sqlState(forge(t.app(), await aTrade()))).toBe('KT001');
  });

  it('refuses a hand-written row from the owner too', async () => {
    expect(await sqlState(forge(t.owner(), await aTrade()))).toBe('KT001');
  });

  it('still lets the transition trigger write', async () => {
    const tradeId = await aTrade();
    await driveTo(t.app(), tradeId, 'AWAITING_ACCEPTANCE');
    const { rows } = await t
      .app()
      .query('SELECT 1 FROM trade.trade_state_changes WHERE trade_id = $1', [tradeId]);
    expect(rows).toHaveLength(1);
  });

  it('refuses a state change that names a buyer but no buyer id', async () => {
    const tradeId = await aTrade();
    expect(
      await sqlState(
        t.app().query(
          `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_action = 'SEND',
                  status_actor_type = 'BUYER', status_revision = status_revision + 1
            WHERE id = $1`,
          [tradeId],
        ),
      ),
    ).toBe('KT010');
  });

  // A trade that has moved can never be deleted: the cascade fires the append-only trigger, and the
  // evidence outlives the row it describes.
  it('refuses to delete a trade that has a history', async () => {
    const tradeId = await aTrade();
    await driveTo(t.app(), tradeId, 'AWAITING_ACCEPTANCE');
    expect(await sqlState(t.app().query('DELETE FROM trade.trades WHERE id = $1', [tradeId]))).toBe('KT001');
  });
});
