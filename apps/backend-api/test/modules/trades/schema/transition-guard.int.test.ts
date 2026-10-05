// The database agrees with canTransition, and says so to anyone — a service, a job, a psql session.
// Every assertion here is raw SQL as komtru_app, because a guard that only applies when the service
// remembers to ask is not a guard. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import {
  TRADE_ACTIONS,
  TRADE_STATUSES,
  transitionTriples,
} from '../../../../src/modules/trades/domain/stateMachine.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { errorMessage, insertTrade, insertUser, sqlState } from '../support.js';

describe.runIf(infraEnabled)('trade.is_valid_transition', () => {
  const t = useTestDatabase();

  it('holds the same statuses and actions as the domain enums', async () => {
    const { rows } = await t.app().query<{ statuses: string[]; actions: string[] }>(
      `SELECT enum_range(NULL::trade.trade_status)::text[] AS statuses,
              enum_range(NULL::trade.trade_action)::text[] AS actions`,
    );
    expect(rows[0]?.statuses).toEqual([...TRADE_STATUSES]);
    expect(rows[0]?.actions).toEqual([...TRADE_ACTIONS]);
  });

  it('agrees with canTransition on every (action, from, to) triple', async () => {
    const { rows } = await t.app().query<{ action: string; from: string; to: string }>(
      `SELECT a::text AS action, f::text AS "from", s::text AS "to"
         FROM unnest(enum_range(NULL::trade.trade_action)) a,
              unnest(enum_range(NULL::trade.trade_status)) f,
              unnest(enum_range(NULL::trade.trade_status)) s
        WHERE trade.is_valid_transition(a, f, s)`,
    );
    const inDatabase = rows.map((row) => `${row.action} ${row.from}->${row.to}`).sort();
    const inDomain = transitionTriples()
      .map(([a, f, s]) => `${a} ${f}->${s}`)
      .sort();
    expect(inDatabase).toEqual(inDomain);
  });
});

describe.runIf(infraEnabled)('the trades status guard', () => {
  const t = useTestDatabase();

  const aTrade = async (overrides: Record<string, unknown> = {}) => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    return insertTrade(t.app(), { buyer, seller }, overrides);
  };

  const move = (id: string, to: string, action: string, actor = 'BUYER') =>
    t
      .app()
      .query(
        `UPDATE trade.trades SET status = $2, status_action = $3, status_actor_type = $4 WHERE id = $1`,
        [id, to, action, actor],
      );

  it('allows an edge the map draws', async () => {
    const id = await aTrade();
    await move(id, 'AWAITING_ACCEPTANCE', 'SEND', 'SELLER');
    const { rows } = await t
      .app()
      .query<{ status: string }>('SELECT status FROM trade.trades WHERE id = $1', [id]);
    expect(rows[0]?.status).toBe('AWAITING_ACCEPTANCE');
  });

  it('rejects a direct UPDATE that jumps AWAITING_ACCEPTANCE straight to FUNDED', async () => {
    const id = await aTrade({ status: 'AWAITING_ACCEPTANCE' });
    expect(await sqlState(move(id, 'FUNDED', 'FUND'))).toBe('KT010');
  });

  it('rejects cancelling a funded trade however it is attempted (M7 D3)', async () => {
    const id = await aTrade({ status: 'AWAITING_ACCEPTANCE' });
    await t.app().query(
      `UPDATE trade.trades
          SET status = 'PENDING_PAYMENT', status_action = 'ACCEPT', status_actor_type = 'SELLER',
              fee_schedule_version = '2026-10-05.1', item_amount_minor = 1000, buyer_protection_fee_minor = 15,
              buyer_total_minor = 1015, commission_minor = 0, seller_payout_minor = 1000,
              fee_snapshot = '{}'::jsonb, fees_snapshotted_at = now()
        WHERE id = $1`,
      [id],
    );
    await move(id, 'FUNDED', 'FUND', 'LEDGER');
    expect(await sqlState(move(id, 'CANCELLED', 'CANCEL'))).toBe('KT010');
  });

  it('rejects a status change with no action', async () => {
    const id = await aTrade();
    expect(
      await sqlState(
        t
          .app()
          .query(
            `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_actor_type = 'SELLER' WHERE id = $1`,
            [id],
          ),
      ),
    ).toBe('KT010');
  });

  it('rejects a status change with no actor', async () => {
    const id = await aTrade();
    expect(
      await sqlState(
        t
          .app()
          .query(
            `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_action = 'SEND' WHERE id = $1`,
            [id],
          ),
      ),
    ).toBe('KT010');
  });

  it('names the action and both statuses when it refuses', async () => {
    const id = await aTrade();
    const message = await errorMessage(move(id, 'FUNDED', 'FUND'));
    expect(message).toContain('FUND');
    expect(message).toContain('DRAFT');
    expect(message).toContain('FUNDED');
  });

  it('writes the state change row itself, with from, to, action and actor', async () => {
    const id = await aTrade();
    await move(id, 'AWAITING_ACCEPTANCE', 'SEND', 'SELLER');
    const { rows } = await t
      .app()
      .query<{ from_status: string; to_status: string; action: string; actor_type: string }>(
        'SELECT from_status, to_status, action, actor_type FROM trade.trade_state_changes WHERE trade_id = $1',
        [id],
      );
    expect(rows).toEqual([
      { from_status: 'DRAFT', to_status: 'AWAITING_ACCEPTANCE', action: 'SEND', actor_type: 'SELLER' },
    ]);
  });

  it('stamps status_changed_at from the database clock, not from the caller', async () => {
    const id = await aTrade();
    const theYear2000 = '2000-01-01T00:00:00.000Z';
    await t.app().query(
      `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_action = 'SEND',
              status_actor_type = 'SELLER', status_changed_at = $2 WHERE id = $1`,
      [id, theYear2000],
    );
    const { rows } = await t
      .app()
      .query<{ status_changed_at: Date }>('SELECT status_changed_at FROM trade.trades WHERE id = $1', [id]);
    expect(rows[0]?.status_changed_at.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('leaves no state-change row when the transaction rolls back', async () => {
    const id = await aTrade();
    const client = await t.app().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_action = 'SEND', status_actor_type = 'SELLER' WHERE id = $1`,
        [id],
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const { rows } = await t.app().query('SELECT 1 FROM trade.trade_state_changes WHERE trade_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('writes no state change when only the terms change (a counter-proposal keeps the turn)', async () => {
    const id = await aTrade({ status: 'AWAITING_ACCEPTANCE' });
    await t
      .app()
      .query(
        `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_reason = 'countered' WHERE id = $1`,
        [id],
      );
    const { rows } = await t.app().query('SELECT 1 FROM trade.trade_state_changes WHERE trade_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });
});
