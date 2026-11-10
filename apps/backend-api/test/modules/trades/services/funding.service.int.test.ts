/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- raw `pg` rows and vi.fn spy calls are untyped */
// F-024: the trades module's answer to `ledger.payment.escrow_funded`. The ledger never moves a trade (T-072);
// this is the one place PENDING_PAYMENT becomes FUNDED, and the place money the trade will not take is held for
// review. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { paymentEscrowFundedEvent } from '../../../../src/modules/ledger/domain/events.js';
import { createTradesModule } from '../../../../src/modules/trades/module.js';
import { fundTrade, type FundInput } from '../../../../src/modules/trades/services/funding.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { testConfig, testLogger } from '../../identity/support.js';
import { outboxOf, statusOf, tradeAt } from './fulfilment-support.js';
import { placeHold, stateChanges, tradeRow } from './inspection-support.js';

describe.runIf(infraEnabled)('payment.escrow_funded: PENDING_PAYMENT to FUNDED (F-024)', () => {
  const t = useTestDatabase();

  const buyerTotal = async (tradeId: string): Promise<string> =>
    String((await tradeRow(t, tradeId)).buyer_total_minor);

  const input = async (tradeId: string, over: Partial<FundInput> = {}): Promise<FundInput> => {
    const attempt = randomUUID();
    const known = (await t.owner().query(`SELECT 1 FROM trade.trades WHERE id = $1`, [tradeId])).rows.length;
    return {
      tradeId,
      paymentAttemptId: attempt,
      journalEntryId: randomUUID(),
      reference: `fund-${attempt}`,
      currency: 'NGN',
      amountMinor: known ? await buyerTotal(tradeId) : '45878000',
      ...over,
    };
  };
  const funded = async (tradeId: string, over: Partial<FundInput> = {}) => {
    const given = await input(tradeId, over);
    return t.db().transaction((tx) => fundTrade(tx, given));
  };
  const reviews = (tradeId: string) => outboxOf(t.owner(), tradeId, 'trades.funding.review_required');
  const activity = async (tradeId: string) =>
    (
      await t
        .owner()
        .query(`SELECT type, actor_type, metadata FROM trade.trade_activity WHERE trade_id = $1`, [tradeId])
    ).rows;

  it('funds a trade awaiting payment as the ledger, once, and says so to everyone listening', async () => {
    const f = await tradeAt(t, 'PENDING_PAYMENT');
    const given = await input(f.tradeId);
    expect(await t.db().transaction((tx) => fundTrade(tx, given))).toBe('FUNDED');

    expect(await statusOf(t.owner(), f.tradeId)).toBe('FUNDED');
    const [change] = await stateChanges(t, f.tradeId, 'FUND');
    expect(change).toMatchObject({
      from_status: 'PENDING_PAYMENT',
      to_status: 'FUNDED',
      actor_type: 'LEDGER',
    });
    const row = await tradeRow(t, f.tradeId);
    expect(row.funded_at).not.toBeNull();
    expect(row.status_context).toMatchObject({
      journalEntryId: given.journalEntryId,
      paymentAttemptId: given.paymentAttemptId,
      reference: given.reference,
    });
    // The state change is what opens the delivery clock, tells the seller and pushes to both tabs.
    expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.state_changed')).toContainEqual(
      expect.objectContaining({ action: 'FUND', from: 'PENDING_PAYMENT', to: 'FUNDED' }),
    );
    expect(await activity(f.tradeId)).toContainEqual(
      expect.objectContaining({
        type: 'ESCROW_ACTION_SETTLED',
        actor_type: 'SYSTEM',
        metadata: expect.objectContaining({ event: 'ESCROW_FUNDED', journalEntryId: given.journalEntryId }),
      }),
    );
    expect(await reviews(f.tradeId)).toEqual([]);

    // A redelivered event changes nothing.
    expect(await t.db().transaction((tx) => fundTrade(tx, given))).toBe('ALREADY_FUNDED');
    expect(await stateChanges(t, f.tradeId, 'FUND')).toHaveLength(1);
  });

  it('funds even under a hold: the money has already moved', async () => {
    const f = await tradeAt(t, 'PENDING_PAYMENT');
    await placeHold(t, f.tradeId);
    expect(await funded(f.tradeId)).toBe('FUNDED');
  });

  it.each(['SHIPPED', 'INSPECTION', 'SETTLED'])(
    'treats a trade already past funding (%s) as funded, with nothing to review',
    async (status) => {
      const f = await tradeAt(t, status);
      expect(await funded(f.tradeId)).toBe('ALREADY_FUNDED');
      expect(await statusOf(t.owner(), f.tradeId)).toBe(status);
      expect(await reviews(f.tradeId)).toEqual([]);
    },
  );

  it.each(['CANCELLED', 'EXPIRED'])(
    'holds money for a trade that ended (%s) for review, durably, and never refunds it',
    async (status) => {
      const f = await tradeAt(t, status);
      const given = await input(f.tradeId);
      expect(await t.db().transaction((tx) => fundTrade(tx, given))).toBe('IGNORED');
      expect(await statusOf(t.owner(), f.tradeId)).toBe(status);
      expect(await reviews(f.tradeId)).toEqual([
        expect.objectContaining({
          reason: 'TRADE_NOT_AWAITING_PAYMENT',
          tradeStatus: status,
          paymentAttemptId: given.paymentAttemptId,
          journalEntryId: given.journalEntryId,
          amountMinor: given.amountMinor,
        }),
      ]);
      expect(await activity(f.tradeId)).toContainEqual(
        expect.objectContaining({
          metadata: expect.objectContaining({
            event: 'ESCROW_FUNDING_REVIEW',
            reason: 'TRADE_NOT_AWAITING_PAYMENT',
            reference: given.reference,
          }),
        }),
      );
      expect(await outboxOf(t.owner(), f.tradeId, 'trades.refund.requested')).toEqual([]);
    },
  );

  it('holds money for a trade that does not exist for review', async () => {
    const tradeId = randomUUID();
    expect(await funded(tradeId)).toBe('UNKNOWN_TRADE');
    expect(await reviews(tradeId)).toEqual([
      expect.objectContaining({ reason: 'UNKNOWN_TRADE', tradeStatus: null, expectedAmountMinor: null }),
    ]);
  });

  it.each([
    ['an amount that is not the snapshotted buyer total', { amountMinor: '1' }],
    ['another currency', { currency: 'USD' }],
  ])('does not fund on %s, and holds it for review', async (_, over) => {
    const f = await tradeAt(t, 'PENDING_PAYMENT');
    const expected = await buyerTotal(f.tradeId);
    expect(await funded(f.tradeId, over)).toBe('AMOUNT_MISMATCH');
    expect(await statusOf(t.owner(), f.tradeId)).toBe('PENDING_PAYMENT');
    expect(await reviews(f.tradeId)).toEqual([
      expect.objectContaining({ reason: 'AMOUNT_MISMATCH', expectedAmountMinor: expected }),
    ]);
  });

  it('is wired end to end: the ledger’s own event, through the module’s subscriber, funds the trade', async () => {
    const subscribe = vi.fn();
    const gateway = {
      registerRoomAuthorizer: vi.fn(),
      emitToRoom: vi.fn(),
      emitToUser: vi.fn(),
      disconnectUser: vi.fn(),
      connectionCount: () => 0,
    };
    await createTradesModule({
      gateway,
      db: t.db(),
      redis: {} as never,
      logger: testLogger,
      config: testConfig({ IDENTITY_HMAC_PEPPER: 'a-pepper-for-tests-0123456789abc' }),
    }).start?.({ events: { subscribe }, logger: testLogger } as never);
    const subscription = subscribe.mock.calls.find(([s]) => s.name === 'trades.on-escrow-funded')![0];

    const f = await tradeAt(t, 'PENDING_PAYMENT');
    const attempt = randomUUID();
    // What the ledger actually publishes, through the ledger's own schema, then the subscriber's (as the bus does).
    const published = paymentEscrowFundedEvent.payload.parse({
      tradeId: f.tradeId,
      paymentAttemptId: attempt,
      journalEntryId: randomUUID(),
      provider: 'PAYSTACK',
      reference: `fund-${attempt}`,
      currency: 'NGN',
      amountMinor: await buyerTotal(f.tradeId),
      itemAmountMinor: String((await tradeRow(t, f.tradeId)).item_amount_minor),
      buyerProtectionFeeMinor: String((await tradeRow(t, f.tradeId)).buyer_protection_fee_minor),
      fundedAt: new Date().toISOString(),
    });
    const payload = subscription.event.payload.parse(published);
    await t.db().transaction((tx) => subscription.handler({ payload }, tx));
    expect(await statusOf(t.owner(), f.tradeId)).toBe('FUNDED');
  });
});
