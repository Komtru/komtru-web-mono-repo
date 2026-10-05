// Both trade logs only grow: the trigger stops the owner, and komtru_app simply lacks the privilege.
// Resolves m2 §13.1 (conflict C6) — a rejection is evidence, and evidence that can be rewritten is
// not evidence. Skipped unless KOMTRU_INFRA_TESTS=1.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { grantRuntimeAccess } from '../../../../src/db/roles.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertTrade, insertUser, sqlState } from '../support.js';

describe.runIf(infraEnabled)('trade append-only logs', () => {
  const t = useTestDatabase();

  const aTrade = async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    return insertTrade(t.app(), { buyer, seller });
  };

  const appendStateChange = (pool: pg.Pool, tradeId: string) =>
    pool.query(
      `INSERT INTO trade.trade_state_changes (trade_id, from_status, to_status, action, actor_type)
       VALUES ($1, 'DRAFT', 'AWAITING_ACCEPTANCE', 'SEND', 'SELLER')`,
      [tradeId],
    );

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
    expect(await sqlState(t.app().query(`UPDATE ${table} SET actor_id = NULL`))).toBe('42501');
  });

  it.each(tables)('denies the runtime role DELETE on %s', async (table, append) => {
    const tradeId = await aTrade();
    await append(t.app(), tradeId);
    expect(await sqlState(t.app().query(`DELETE FROM ${table}`))).toBe('42501');
  });

  it.each(tables)('raises KT001 on an owner UPDATE of %s', async (table, append) => {
    const tradeId = await aTrade();
    await append(t.owner(), tradeId);
    expect(await sqlState(t.owner().query(`UPDATE ${table} SET actor_id = NULL`))).toBe('KT001');
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
      expect(await sqlState(t.app().query(`UPDATE ${table} SET actor_id = NULL`))).toBe('42501');
    },
  );
});
