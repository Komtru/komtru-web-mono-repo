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
import { driveTo, errorMessage, insertTrade, insertUser, sqlState, transition } from '../support.js';

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

  const aTrade = async (status = 'DRAFT') => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const id = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.app(), id, status);
    return id;
  };

  const move = (id: string, to: string, action: string, actor = 'SYSTEM') =>
    t.app().query(
      `UPDATE trade.trades
          SET status = $2, status_action = $3, status_actor_type = $4,
              status_revision = status_revision + 1
        WHERE id = $1`,
      [id, to, action, actor],
    );

  it('allows an edge the map draws', async () => {
    const id = await aTrade();
    await move(id, 'AWAITING_ACCEPTANCE', 'SEND');
    const { rows } = await t
      .app()
      .query<{ status: string }>('SELECT status FROM trade.trades WHERE id = $1', [id]);
    expect(rows[0]?.status).toBe('AWAITING_ACCEPTANCE');
  });

  it('rejects a direct UPDATE that jumps AWAITING_ACCEPTANCE straight to FUNDED', async () => {
    const id = await aTrade('AWAITING_ACCEPTANCE');
    expect(await sqlState(move(id, 'FUNDED', 'FUND'))).toBe('KT010');
  });

  // Keying the guard on the status alone would let a status change through unvalidated whenever the
  // caller simply did not touch the revision.
  it('rejects a status change that does not bump the revision', async () => {
    const id = await aTrade();
    expect(
      await sqlState(
        t.app().query(
          `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_action = 'SEND',
                  status_actor_type = 'SYSTEM' WHERE id = $1`,
          [id],
        ),
      ),
    ).toBe('KT010');
  });

  it('rejects a revision that jumps by more than one', async () => {
    const id = await aTrade();
    expect(
      await sqlState(
        t.app().query(
          `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_action = 'SEND',
                  status_actor_type = 'SYSTEM', status_revision = status_revision + 2 WHERE id = $1`,
          [id],
        ),
      ),
    ).toBe('KT010');
  });

  // The counter-proposal keeps the turn, so the status does not move — and it is the transition
  // that changes the price, which makes it the last one that should go unguarded or unaudited.
  it('guards and records the counter-proposal that leaves the status where it is', async () => {
    const id = await aTrade('AWAITING_ACCEPTANCE');
    await transition(t.app(), id, { action: 'COUNTER_PROPOSE', to: 'AWAITING_ACCEPTANCE' });
    const { rows } = await t.app().query<{ from_status: string; to_status: string; action: string }>(
      `SELECT from_status, to_status, action FROM trade.trade_state_changes
          WHERE trade_id = $1 ORDER BY id DESC LIMIT 1`,
      [id],
    );
    expect(rows[0]).toEqual({
      from_status: 'AWAITING_ACCEPTANCE',
      to_status: 'AWAITING_ACCEPTANCE',
      action: 'COUNTER_PROPOSE',
    });
  });

  it('refuses a counter-proposal on a trade that has moved past acceptance', async () => {
    const id = await aTrade('FUNDED');
    expect(
      await sqlState(transition(t.app(), id, { action: 'COUNTER_PROPOSE', to: 'AWAITING_ACCEPTANCE' })),
    ).toBe('KT010');
  });

  it('rejects cancelling a funded trade however it is attempted (M7 D3)', async () => {
    const id = await aTrade('FUNDED');
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
    await move(id, 'AWAITING_ACCEPTANCE', 'SEND');
    const { rows } = await t
      .app()
      .query<{ from_status: string; to_status: string; action: string; actor_type: string }>(
        'SELECT from_status, to_status, action, actor_type FROM trade.trade_state_changes WHERE trade_id = $1',
        [id],
      );
    expect(rows).toEqual([
      { from_status: 'DRAFT', to_status: 'AWAITING_ACCEPTANCE', action: 'SEND', actor_type: 'SYSTEM' },
    ]);
  });

  it('stamps status_changed_at from the database clock, not from the caller', async () => {
    const id = await aTrade();
    const theYear2000 = '2000-01-01T00:00:00.000Z';
    await t.app().query(
      `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_action = 'SEND',
              status_actor_type = 'SYSTEM', status_revision = status_revision + 1,
              status_changed_at = $2 WHERE id = $1`,
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
        `UPDATE trade.trades SET status = 'AWAITING_ACCEPTANCE', status_action = 'SEND',
                status_actor_type = 'SYSTEM', status_revision = status_revision + 1 WHERE id = $1`,
        [id],
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const { rows } = await t.app().query('SELECT 1 FROM trade.trade_state_changes WHERE trade_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('writes no state change for an edit that is not a transition', async () => {
    const id = await aTrade();
    await t.app().query(`UPDATE trade.trades SET order_id = gen_random_uuid() WHERE id = $1`, [id]);
    const { rows } = await t.app().query('SELECT 1 FROM trade.trade_state_changes WHERE trade_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });
});
