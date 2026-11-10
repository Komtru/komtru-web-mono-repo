/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- raw `pg` rows are untyped in assertions */
// F-024: the trades module's answer to `ledger.payment.escrow_funded`. The ledger never moves a trade (T-072);
// this is the one place PENDING_PAYMENT becomes FUNDED. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fundTrade } from '../../../../src/modules/trades/services/funding.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { outboxOf, statusOf, tradeAt } from './fulfilment-support.js';
import { placeHold, stateChanges, tradeRow } from './inspection-support.js';

describe.runIf(infraEnabled)('payment.escrow_funded: PENDING_PAYMENT to FUNDED (F-024)', () => {
  const t = useTestDatabase();
  const funded = (tradeId: string, over: Partial<Parameters<typeof fundTrade>[1]> = {}) => {
    const attempt = randomUUID();
    return t.db().transaction((tx) =>
      fundTrade(tx, {
        tradeId,
        paymentAttemptId: attempt,
        journalEntryId: randomUUID(),
        reference: `fund-${attempt}`,
        ...over,
      }),
    );
  };

  it('funds a trade awaiting payment as the ledger, once, and says so to everyone listening', async () => {
    const f = await tradeAt(t, 'PENDING_PAYMENT');
    const journal = randomUUID();
    const attempt = randomUUID();
    expect(
      await funded(f.tradeId, {
        journalEntryId: journal,
        paymentAttemptId: attempt,
        reference: `fund-${attempt}`,
      }),
    ).toBe('FUNDED');

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
      journalEntryId: journal,
      paymentAttemptId: attempt,
      reference: `fund-${attempt}`,
    });
    // The state change is what opens the delivery clock, tells the seller and pushes to both tabs.
    expect(await outboxOf(t.owner(), f.tradeId, 'trades.trade.state_changed')).toContainEqual(
      expect.objectContaining({ action: 'FUND', from: 'PENDING_PAYMENT', to: 'FUNDED' }),
    );
    const { rows } = await t
      .owner()
      .query(`SELECT type, actor_type, metadata FROM trade.trade_activity WHERE trade_id = $1`, [f.tradeId]);
    expect(rows).toContainEqual(
      expect.objectContaining({
        type: 'ESCROW_ACTION_SETTLED',
        actor_type: 'SYSTEM',
        metadata: expect.objectContaining({ event: 'ESCROW_FUNDED', journalEntryId: journal }),
      }),
    );

    // A redelivered event changes nothing.
    expect(await funded(f.tradeId, { journalEntryId: journal })).toBe('ALREADY_FUNDED');
    expect(await stateChanges(t, f.tradeId, 'FUND')).toHaveLength(1);
  });

  it('funds even under a hold: the money has already moved', async () => {
    const f = await tradeAt(t, 'PENDING_PAYMENT');
    await placeHold(t, f.tradeId);
    expect(await funded(f.tradeId)).toBe('FUNDED');
  });

  it.each(['SHIPPED', 'INSPECTION', 'SETTLED'])(
    'treats a trade already past funding (%s) as funded',
    async (status) => {
      const f = await tradeAt(t, status);
      expect(await funded(f.tradeId)).toBe('ALREADY_FUNDED');
      expect(await statusOf(t.owner(), f.tradeId)).toBe(status);
    },
  );

  it('leaves a trade that ended before the money arrived alone, and an unknown one', async () => {
    for (const status of ['CANCELLED', 'EXPIRED']) {
      const f = await tradeAt(t, status);
      expect(await funded(f.tradeId)).toBe('IGNORED');
      expect(await statusOf(t.owner(), f.tradeId)).toBe(status);
    }
    expect(await funded(randomUUID())).toBe('UNKNOWN_TRADE');
  });
});
