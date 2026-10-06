// applyTransition is the only way a trade's status moves. The race below is the reason it is one
// conditional UPDATE and never a read followed by a write. Skipped unless KOMTRU_INFRA_TESTS=1.
import type pg from 'pg';
import type { ApiError } from '../../../../src/platform/errors.js';
import { describe, expect, it } from 'vitest';
import { applyTransition } from '../../../../src/modules/trades/infrastructure/postgres/transitions.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  driveTo,
  insertTermsVersion,
  insertTrade,
  insertUser,
  sqlState,
  testFeeSnapshot,
} from '../support.js';
import { feeSnapshotColumns } from '../../../../src/modules/trades/domain/feeSnapshot.js';

const problem = async (run: Promise<unknown>): Promise<{ status: number; code: string }> => {
  try {
    await run;
  } catch (error) {
    const api = error as ApiError;
    return { status: api.status, code: api.code };
  }
  return { status: 0, code: 'no error' };
};

/**
 * Resolves once a backend in this test's database is blocked on a lock. The database is this
 * worker's alone, and the only contended row in it is the trade the test just locked. Matching on
 * the statement text would not work: the extended protocol keeps parameters out of `query`, so the
 * trade id never appears there.
 *
 * The probe runs on the owner pool, straight to Postgres: the blocked transaction is holding one of
 * PgBouncer's server connections while it waits, so a probe through the pooler can end up queued
 * behind the very thing it is waiting to observe.
 */
const waitForLockWait = async (pool: () => pg.Pool, timeoutMs = 10_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool().query<{ waiting: boolean }>(
      `SELECT true AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows.length) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe.runIf(infraEnabled)('applyTransition', () => {
  const t = useTestDatabase();

  const aTrade = async (status = 'DRAFT') => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const id = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.app(), id, status);
    return { buyer, seller, id };
  };

  const inInspection = () => aTrade('INSPECTION');

  /** Only the rows this test's own transition added; the fixture's route wrote the earlier ones. */
  const changesSince = async (id: string, from: number) =>
    (
      await t
        .app()
        .query<{ to_status: string }>(
          'SELECT to_status FROM trade.trade_state_changes WHERE trade_id = $1 ORDER BY id OFFSET $2',
          [id, from],
        )
    ).rows.map((row) => row.to_status);

  const countChanges = async (id: string) =>
    Number(
      (
        await t
          .app()
          .query<{ count: string }>(
            'SELECT count(*) AS count FROM trade.trade_state_changes WHERE trade_id = $1',
            [id],
          )
      ).rows[0]?.count ?? '0',
    );

  const currentRevision = async (id: string) =>
    Number(
      (
        await t
          .app()
          .query<{ status_revision: number }>('SELECT status_revision FROM trade.trades WHERE id = $1', [id])
      ).rows[0]?.status_revision ?? -1,
    );

  const outboxCount = async () =>
    Number(
      (await t.app().query<{ count: string }>('SELECT count(*) AS count FROM platform.outbox')).rows[0]
        ?.count ?? '0',
    );

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
    expect(result.revision).toBe(1);

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
    const seller = await insertUser(t.app());
    expect(
      await problem(
        t.db().transaction((tx) =>
          applyTransition(tx, {
            tradeId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4aff',
            action: 'SEND',
            to: 'AWAITING_ACCEPTANCE',
            actor: { type: 'SELLER', id: seller },
          }),
        ),
      ),
    ).toEqual({ status: 404, code: 'NOT_FOUND' });
  });

  // A counter-proposal leaves the status where it is, so the status condition cannot tell two of
  // them apart: the revision is what separates them, and forgetting it is a programming error.
  it('refuses a self-transition that does not say which revision it expects', async () => {
    const { id, buyer } = await aTrade('AWAITING_ACCEPTANCE');
    await expect(
      t.db().transaction((tx) =>
        applyTransition(tx, {
          tradeId: id,
          action: 'COUNTER_PROPOSE',
          to: 'AWAITING_ACCEPTANCE',
          actor: { type: 'BUYER', id: buyer },
        }),
      ),
    ).rejects.toThrow(/expectedRevision/);
  });

  it('records a counter-proposal and refuses a second one against the same revision', async () => {
    const { id, buyer } = await aTrade('AWAITING_ACCEPTANCE');
    const before = await countChanges(id);
    const counter = (expectedRevision: number) =>
      t.db().transaction((tx) =>
        applyTransition(tx, {
          tradeId: id,
          action: 'COUNTER_PROPOSE',
          to: 'AWAITING_ACCEPTANCE',
          actor: { type: 'BUYER', id: buyer },
          expectedRevision,
        }),
      );

    const first = await counter(before);
    expect(first).toMatchObject({ from: 'AWAITING_ACCEPTANCE', to: 'AWAITING_ACCEPTANCE' });
    expect(await problem(counter(before))).toEqual({ status: 409, code: 'INVALID_TRANSITION' });
    expect(await changesSince(id, before)).toEqual(['AWAITING_ACCEPTANCE']);
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

  it('freezes the fee snapshot through the acceptance transition', async () => {
    const { id, buyer, seller } = await aTrade('AWAITING_ACCEPTANCE');
    const termsId = await insertTermsVersion(t.app(), id, buyer);
    const snapshot = testFeeSnapshot();

    await t.db().transaction((tx) =>
      applyTransition(tx, {
        tradeId: id,
        action: 'ACCEPT',
        to: 'PENDING_PAYMENT',
        actor: { type: 'SELLER', id: seller },
        set: { ...feeSnapshotColumns(snapshot), acceptedTermsVersionId: termsId },
      }),
    );

    const { rows } = await t.app().query<{
      status: string;
      fee_schedule_version: string;
      buyer_total_minor: string;
      seller_proceeds_minor: string;
      platform_revenue_minor: string;
      fee_snapshot: typeof snapshot;
      accepted_terms_version_id: string;
    }>(
      `SELECT status, fee_schedule_version, buyer_total_minor, seller_proceeds_minor,
              platform_revenue_minor, fee_snapshot, accepted_terms_version_id
         FROM trade.trades WHERE id = $1`,
      [id],
    );
    const row = rows[0]!;
    expect(row.status).toBe('PENDING_PAYMENT');
    expect(row.fee_schedule_version).toBe(snapshot.version);
    expect(row.buyer_total_minor).toBe(snapshot.amounts.buyerTotalMinor);
    expect(row.seller_proceeds_minor).toBe(snapshot.amounts.sellerProceedsMinor);
    expect(row.platform_revenue_minor).toBe(snapshot.amounts.platformRevenueMinor);
    expect(row.accepted_terms_version_id).toBe(termsId);
    // Stored whole, amounts still strings: the refund treatment in force at acceptance has to be
    // readable years later without the fee file.
    expect(row.fee_snapshot).toEqual(snapshot);
    expect(row.fee_snapshot.terms.buyerProtectionRefundableOnFullRefund).toBe(true);
  });

  it('refuses a fee snapshot whose parts do not add up, before the database sees it', () => {
    const broken = testFeeSnapshot();
    broken.amounts.buyerTotalMinor = '1';
    expect(() => feeSnapshotColumns(broken)).toThrow();
  });

  it('lets exactly one of two concurrent transitions out of INSPECTION win', async () => {
    const { id, buyer } = await inInspection();
    const before = await countChanges(id);
    const eventsBefore = await outboxCount();

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
    const disputing = t.db().transaction((tx) =>
      applyTransition(tx, {
        tradeId: id,
        action: 'DISPUTE',
        to: 'DISPUTED',
        actor: { type: 'BUYER', id: buyer },
      }),
    );

    // Releasing before the second UPDATE has actually reached the server would test the sequential
    // case and prove nothing, so wait until Postgres reports a backend waiting on a lock. The
    // release is in a finally: leaving the first transaction holding the row would hang the suite.
    let blocked = false;
    try {
      blocked = await waitForLockWait(() => t.owner());
    } finally {
      release();
    }
    // The assertion that makes this a race test: if the loser never blocked, the two ran one after
    // the other and the rest proves only that a stale conditional UPDATE matches no row.
    expect(blocked).toBe(true);

    await completing;
    expect(await problem(disputing)).toEqual({ status: 409, code: 'INVALID_TRANSITION' });

    expect(await changesSince(id, before)).toEqual(['COMPLETED']);
    expect((await outboxCount()) - eventsBefore).toBe(1);
  });

  // The counter-proposal's own race. Two people cannot both flip the turn: the status is the same
  // before and after, so the revision is the only thing that can separate them.
  it('lets exactly one of two concurrent counter-proposals win', async () => {
    const { id, buyer, seller } = await aTrade('AWAITING_ACCEPTANCE');
    const before = await countChanges(id);
    const revision = await currentRevision(id);

    let locked = (): void => undefined;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));

    const counter = (actorId: string, hold: boolean) =>
      t.db().transaction(async (tx) => {
        const result = await applyTransition(tx, {
          tradeId: id,
          action: 'COUNTER_PROPOSE',
          to: 'AWAITING_ACCEPTANCE',
          actor: { type: 'BUYER', id: actorId },
          expectedRevision: revision,
        });
        if (hold) {
          locked();
          await held;
        }
        return result;
      });

    const first = counter(buyer, true);
    await lockTaken;
    const second = counter(seller, false);

    let blocked = false;
    try {
      blocked = await waitForLockWait(() => t.owner());
    } finally {
      release();
    }
    expect(blocked).toBe(true);

    await first;
    expect(await problem(second)).toEqual({ status: 409, code: 'INVALID_TRANSITION' });
    expect(await changesSince(id, before)).toEqual(['AWAITING_ACCEPTANCE']);
    expect(await currentRevision(id)).toBe(revision + 1);
  });

  it('refuses a stale unconditional UPDATE at the database level', async () => {
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
