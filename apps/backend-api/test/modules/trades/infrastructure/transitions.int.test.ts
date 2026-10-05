// applyTransition is the only way a trade's status moves. The race below is the reason it is one
// conditional UPDATE and never a read followed by a write. Skipped unless KOMTRU_INFRA_TESTS=1.
import type { ApiError } from '../../../../src/platform/errors.js';
import { describe, expect, it } from 'vitest';
import { applyTransition } from '../../../../src/modules/trades/infrastructure/postgres/transitions.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { feeSnapshotColumnValues, insertTrade, insertUser, sqlState } from '../support.js';

const problem = async (run: Promise<unknown>): Promise<{ status: number; code: string }> => {
  try {
    await run;
  } catch (error) {
    const api = error as ApiError;
    return { status: api.status, code: api.code };
  }
  return { status: 0, code: 'no error' };
};

describe.runIf(infraEnabled)('applyTransition', () => {
  const t = useTestDatabase();

  const aTrade = async (overrides: Record<string, unknown> = {}) => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    return { buyer, seller, id: await insertTrade(t.app(), { buyer, seller }, overrides) };
  };

  const inInspection = async () => aTrade({ status: 'INSPECTION', ...feeSnapshotColumnValues() });

  it('moves the trade, writes the audit row and publishes one event in the same transaction', async () => {
    const { id, seller } = await aTrade();
    const result = await t.db().transaction((tx) =>
      applyTransition(tx, {
        tradeId: id,
        action: 'SEND',
        to: 'AWAITING_ACCEPTANCE',
        actor: { type: 'SELLER', id: seller },
      }),
    );
    expect(result).toMatchObject({ from: 'DRAFT', to: 'AWAITING_ACCEPTANCE' });

    const { rows: changes } = await t
      .app()
      .query<{ to_status: string; action: string }>(
        'SELECT to_status, action FROM trade.trade_state_changes WHERE trade_id = $1',
        [id],
      );
    expect(changes).toEqual([{ to_status: 'AWAITING_ACCEPTANCE', action: 'SEND' }]);

    const { rows: events } = await t
      .app()
      .query<{ event_type: string; aggregate_id: string; payload: { to: string; action: string } }>(
        'SELECT event_type, aggregate_id, payload FROM platform.outbox',
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('trades.trade.state_changed');
    expect(events[0]?.aggregate_id).toBe(id);
    expect(events[0]?.payload).toMatchObject({ to: 'AWAITING_ACCEPTANCE', action: 'SEND' });
  });

  it('publishes nothing when the surrounding transaction rolls back', async () => {
    const { id, seller } = await aTrade();
    await expect(
      t.db().transaction(async (tx) => {
        await applyTransition(tx, {
          tradeId: id,
          action: 'SEND',
          to: 'AWAITING_ACCEPTANCE',
          actor: { type: 'SELLER', id: seller },
        });
        throw new Error('the caller changed its mind');
      }),
    ).rejects.toThrow('changed its mind');

    const { rows } = await t.app().query('SELECT 1 FROM platform.outbox');
    expect(rows).toHaveLength(0);
    const { rows: status } = await t
      .app()
      .query<{ status: string }>('SELECT status FROM trade.trades WHERE id = $1', [id]);
    expect(status[0]?.status).toBe('DRAFT');
  });

  it('throws 409 INVALID_TRANSITION when the trade is not in a source status', async () => {
    const { id, buyer } = await aTrade();
    expect(
      await problem(
        t
          .db()
          .transaction((tx) =>
            applyTransition(tx, { tradeId: id, action: 'FUND', to: 'FUNDED', actor: { type: 'LEDGER' } }),
          ),
      ),
    ).toEqual({ status: 409, code: 'INVALID_TRANSITION' });
    expect(buyer).toBeTypeOf('string');
  });

  it('throws 409 for an action the machine never draws to that status', async () => {
    const { id } = await aTrade();
    expect(
      await problem(
        t
          .db()
          .transaction((tx) =>
            applyTransition(tx, { tradeId: id, action: 'SEND', to: 'SETTLED', actor: { type: 'SYSTEM' } }),
          ),
      ),
    ).toEqual({ status: 409, code: 'INVALID_TRANSITION' });
  });

  it('throws 404 for a trade that does not exist', async () => {
    expect(
      await problem(
        t.db().transaction((tx) =>
          applyTransition(tx, {
            tradeId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4aff',
            action: 'SEND',
            to: 'AWAITING_ACCEPTANCE',
            actor: { type: 'SELLER' },
          }),
        ),
      ),
    ).toEqual({ status: 404, code: 'NOT_FOUND' });
  });

  it('stamps the lifecycle timestamp the transition owns', async () => {
    const { id, buyer } = await inInspection();
    await t.db().transaction((tx) =>
      applyTransition(tx, {
        tradeId: id,
        action: 'COMPLETE',
        to: 'COMPLETED',
        actor: { type: 'BUYER', id: buyer },
      }),
    );
    await t
      .db()
      .transaction((tx) =>
        applyTransition(tx, { tradeId: id, action: 'SETTLE', to: 'SETTLED', actor: { type: 'LEDGER' } }),
      );
    const { rows } = await t
      .app()
      .query<{ completed_at: Date | null; settled_at: Date | null }>(
        'SELECT completed_at, settled_at FROM trade.trades WHERE id = $1',
        [id],
      );
    expect(rows[0]?.completed_at).toBeInstanceOf(Date);
    expect(rows[0]?.settled_at).toBeInstanceOf(Date);
  });

  it('lets exactly one of two concurrent transitions out of INSPECTION win', async () => {
    const { id, buyer } = await inInspection();

    let locked = (): void => undefined;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));

    const completing = t.db().transaction(async (tx) => {
      await applyTransition(tx, {
        tradeId: id,
        action: 'COMPLETE',
        to: 'COMPLETED',
        actor: { type: 'BUYER', id: buyer },
      });
      locked();
      await held;
    });

    await lockTaken;
    // Starts while the first transaction still holds the row: its UPDATE blocks, then re-evaluates
    // against the committed status and matches nothing.
    const disputing = t.db().transaction((tx) =>
      applyTransition(tx, {
        tradeId: id,
        action: 'DISPUTE',
        to: 'DISPUTED',
        actor: { type: 'BUYER', id: buyer },
      }),
    );
    release();

    await completing;
    expect(await problem(disputing)).toEqual({ status: 409, code: 'INVALID_TRANSITION' });

    const { rows: changes } = await t
      .app()
      .query<{ to_status: string }>('SELECT to_status FROM trade.trade_state_changes WHERE trade_id = $1', [
        id,
      ]);
    expect(changes).toEqual([{ to_status: 'COMPLETED' }]);
    const { rows: events } = await t.app().query('SELECT 1 FROM platform.outbox');
    expect(events).toHaveLength(1);
  });

  it('refuses the same race in the database when the caller omits the status condition', async () => {
    const { id, buyer } = await inInspection();
    await t.db().transaction((tx) =>
      applyTransition(tx, {
        tradeId: id,
        action: 'COMPLETE',
        to: 'COMPLETED',
        actor: { type: 'BUYER', id: buyer },
      }),
    );
    // What a careless service would write: the id, and nothing about the status it expected.
    expect(
      await sqlState(
        t
          .app()
          .query(
            `UPDATE trade.trades SET status = 'DISPUTED', status_action = 'DISPUTE', status_actor_type = 'BUYER' WHERE id = $1`,
            [id],
          ),
      ),
    ).toBe('KT010');
  });
});
