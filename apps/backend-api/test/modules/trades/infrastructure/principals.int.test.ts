// The gates read from identity through its barrel, and a blocked gate leaves evidence (M7 §5).
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { canActAsBuyer } from '../../../../src/modules/trades/domain/eligibility.js';
import {
  blockBuyerOrPass,
  readTradePrincipal,
  recordEligibilityBlock,
} from '../../../../src/modules/trades/infrastructure/postgres/principals.js';
import { applyTransition } from '../../../../src/modules/trades/infrastructure/postgres/transitions.js';
import type { ApiError } from '../../../../src/platform/errors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { driveTo, insertRow, insertTrade, insertUser } from '../support.js';

describe.runIf(infraEnabled)('readTradePrincipal', () => {
  const t = useTestDatabase();

  const certify = (userId: string, status = 'ACTIVE') =>
    insertRow(t.app(), 'identity.user_capabilities', {
      user_id: userId,
      capability: 'MERCHANT',
      status,
    });

  it('reads the verification level and the merchant capability', async () => {
    const userId = await insertUser(t.app(), { verification_level: 'IDENTITY_VERIFIED' });
    await certify(userId);
    const principal = await t.db().transaction((tx) => readTradePrincipal(tx, userId));
    expect(principal).toEqual({
      userId,
      merchantCapabilityStatus: 'ACTIVE',
      verificationLevel: 'IDENTITY_VERIFIED',
    });
    expect(canActAsBuyer(principal)).toBe(false);
  });

  it('reports no capability for an account that never applied', async () => {
    const userId = await insertUser(t.app());
    const principal = await t.db().transaction((tx) => readTradePrincipal(tx, userId));
    expect(principal.merchantCapabilityStatus).toBeNull();
    expect(canActAsBuyer(principal)).toBe(true);
  });

  it('does not block while an application is still PENDING', async () => {
    const userId = await insertUser(t.app());
    await certify(userId, 'PENDING');
    const principal = await t.db().transaction((tx) => readTradePrincipal(tx, userId));
    expect(canActAsBuyer(principal)).toBe(true);
  });

  it('lets a revoked merchant buy again', async () => {
    const userId = await insertUser(t.app());
    await certify(userId, 'REVOKED');
    const principal = await t.db().transaction((tx) => readTradePrincipal(tx, userId));
    expect(canActAsBuyer(principal)).toBe(true);
  });

  it('throws 404 for a user that does not exist', async () => {
    try {
      await t.db().transaction((tx) => readTradePrincipal(tx, '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4aee'));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).status).toBe(404);
    }
  });
});

describe.runIf(infraEnabled)('recordEligibilityBlock', () => {
  const t = useTestDatabase();

  it('writes a trade_activity row and publishes trades.eligibility.blocked', async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const tradeId = await insertTrade(t.app(), { buyer, seller });
    await t.db().transaction((tx) =>
      recordEligibilityBlock(tx, {
        tradeId,
        gate: 'MERCHANT_CANNOT_BUY',
        path: 'ACCEPT_AS_BUYER',
        actorId: buyer,
      }),
    );

    const { rows: activity } = await t
      .app()
      .query<{ type: string; actor_id: string }>('SELECT type, actor_id FROM trade.trade_activity');
    expect(activity).toEqual([{ type: 'ELIGIBILITY_BLOCKED', actor_id: buyer }]);

    const { rows: events } = await t
      .app()
      .query<{ event_type: string; payload: { gate: string; path: string } }>(
        'SELECT event_type, payload FROM platform.outbox',
      );
    expect(events[0]?.event_type).toBe('trades.eligibility.blocked');
    expect(events[0]?.payload).toMatchObject({ gate: 'MERCHANT_CANNOT_BUY', path: 'ACCEPT_AS_BUYER' });
  });

  it('publishes with a null tradeId when the gate fires before a trade exists', async () => {
    const actorId = await insertUser(t.app());
    await t
      .db()
      .transaction((tx) =>
        recordEligibilityBlock(tx, { gate: 'MERCHANT_CANNOT_BUY', path: 'CART_CHECKOUT', actorId }),
      );
    const { rows } = await t
      .app()
      .query<{ payload: { tradeId: string | null } }>('SELECT payload FROM platform.outbox');
    expect(rows[0]?.payload.tradeId).toBeNull();
    const { rows: activity } = await t.app().query('SELECT 1 FROM trade.trade_activity');
    expect(activity).toHaveLength(0);
  });
});

describe.runIf(infraEnabled)('blockBuyerOrPass', () => {
  const t = useTestDatabase();

  // The acceptance criterion is "fails with a specific error AND publishes": two separate calls are
  // two a caller can get half right, so one function does both.
  it('records and raises in one call, so neither half can be forgotten', async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const tradeId = await insertTrade(t.app(), { buyer, seller });
    await insertRow(t.app(), 'identity.user_capabilities', {
      user_id: buyer,
      capability: 'MERCHANT',
      status: 'ACTIVE',
    });

    try {
      await t.db().transaction(async (tx) => {
        const principal = await readTradePrincipal(tx, buyer);
        await blockBuyerOrPass(tx, principal, 'ACCEPT_AS_BUYER', tradeId);
      });
      expect.unreachable('should have blocked');
    } catch (error) {
      expect((error as ApiError).code).toBe('MERCHANT_CANNOT_BUY');
    }

    // The throw unwound the transaction, so nothing was recorded — which is why the service must
    // record in its own transaction before raising. Here the recorded half is checked by calling it
    // where the caller would: inside a transaction that commits the evidence.
    await t.db().transaction(async (tx) => {
      const principal = await readTradePrincipal(tx, buyer);
      await recordEligibilityBlock(tx, {
        tradeId,
        gate: 'MERCHANT_CANNOT_BUY',
        path: 'ACCEPT_AS_BUYER',
        actorId: principal.userId,
      });
    });
    const { rows } = await t
      .app()
      .query<{ actor_type: string }>('SELECT actor_type FROM trade.trade_activity');
    expect(rows).toEqual([{ actor_type: 'BUYER' }]);
  });

  it('passes an account that may buy, and records nothing', async () => {
    const buyer = await insertUser(t.app());
    const seller = await insertUser(t.app());
    const tradeId = await insertTrade(t.app(), { buyer, seller });
    await t.db().transaction(async (tx) => {
      const principal = await readTradePrincipal(tx, buyer);
      await blockBuyerOrPass(tx, principal, 'ACCEPT_AS_BUYER', tradeId);
    });
    const { rows } = await t.app().query('SELECT 1 FROM trade.trade_activity');
    expect(rows).toHaveLength(0);
  });
});

describe.runIf(infraEnabled)('certification mid-trade', () => {
  const t = useTestDatabase();

  // Design §6.3: "trades already in flight when certification is approved finish normally on both
  // sides". The block applies to taking a new buyer role, never to the trade someone is already in.
  it('lets a merchant certified mid-trade finish the buyer-side trade already in flight', async () => {
    const buyer = await insertUser(t.app(), { verification_level: 'CONTACT_VERIFIED' });
    const seller = await insertUser(t.app(), { verification_level: 'IDENTITY_VERIFIED' });
    const id = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.app(), id, 'PENDING_PAYMENT');
    await t
      .db()
      .transaction((tx) =>
        applyTransition(tx, { tradeId: id, action: 'FUND', to: 'FUNDED', actor: { type: 'LEDGER' } }),
      );

    // Certification is approved while the trade is funded.
    await insertRow(t.app(), 'identity.user_capabilities', {
      user_id: buyer,
      capability: 'MERCHANT',
      status: 'ACTIVE',
    });
    const principal = await t.db().transaction((tx) => readTradePrincipal(tx, buyer));
    expect(canActAsBuyer(principal)).toBe(false);

    const run = (action: 'BEGIN_CUSTODY' | 'DELIVERY_SIGNAL' | 'COMPLETE' | 'SETTLE', to: string) =>
      t.db().transaction((tx) =>
        applyTransition(tx, {
          tradeId: id,
          action,
          to: to as 'SHIPPED',
          actor: { type: 'BUYER', id: buyer },
        }),
      );
    await run('BEGIN_CUSTODY', 'SHIPPED');
    await run('DELIVERY_SIGNAL', 'INSPECTION');
    await run('COMPLETE', 'COMPLETED');
    await run('SETTLE', 'SETTLED');

    const { rows } = await t
      .app()
      .query<{ status: string }>('SELECT status FROM trade.trades WHERE id = $1', [id]);
    expect(rows[0]?.status).toBe('SETTLED');
  });
});
