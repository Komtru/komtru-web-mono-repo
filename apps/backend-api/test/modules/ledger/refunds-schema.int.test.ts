// Migration 0049, the ledger half: refunds and the rules the database holds for them — refunds against
// one charge never exceed it, even when they race; a refund only moves forward and its money never
// changes; and no row is ever deleted. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { constraintName, enumLabels, insertAccount, postRaw, sqlState } from './support.js';

describe.runIf(infraEnabled)('ledger refunds schema (T-075)', () => {
  const t = useTestDatabase();

  const insert = async (table: string, values: Record<string, unknown>): Promise<void> => {
    const columns = Object.keys(values);
    await t.app().query(
      `INSERT INTO ledger.${table} (${columns.join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(values),
    );
  };

  const aJournal = async () => {
    const { rows } = await t
      .app()
      .query<{ id: string }>(
        `SELECT id FROM ledger.ledger_accounts WHERE account_type = 'PLATFORM_ESCROW_POOL'`,
      );
    const pool = rows[0]?.id ?? (await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL'));
    const escrow = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: randomUUID() });
    return postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 101_500n },
      { accountId: escrow, direction: 'CREDIT', amountMinor: 101_500n },
    ]);
  };

  /** A settled charge of 1,015.00: item 1,000.00 plus a 15.00 fee. */
  const settledCharge = async (status = 'SUCCEEDED'): Promise<{ attemptId: string; tradeId: string }> => {
    const attemptId = randomUUID();
    const tradeId = randomUUID();
    await insert('payment_attempts', {
      id: attemptId,
      trade_id: tradeId,
      buyer_user_id: randomUUID(),
      provider: 'PAYSTACK',
      reference: `fund-${attemptId}`,
      fee_schedule_version: 'test-fee-schedule',
      item_amount_minor: '100000',
      buyer_protection_fee_minor: '1500',
      amount_minor: '101500',
      status,
      ...(status === 'SUCCEEDED'
        ? {
            journal_entry_id: await aJournal(),
            confirmed_at: new Date(),
            provider_reference: `fund-${attemptId}`,
          }
        : {}),
    });
    return { attemptId, tradeId };
  };

  const insertRefund = async (
    charge: { attemptId: string; tradeId: string },
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const id = (overrides.id as string | undefined) ?? randomUUID();
    await insert('refunds', {
      id,
      trade_id: charge.tradeId,
      buyer_user_id: randomUUID(),
      payment_attempt_id: charge.attemptId,
      provider: 'PAYSTACK',
      charge_reference: `fund-${charge.attemptId}`,
      reference: `refund-${id}`,
      scope: 'FULL',
      reason: 'SELLER_CANNOT_FULFIL',
      requested_by: 'SYSTEM',
      currency: 'NGN',
      item_amount_minor: '100000',
      fee_amount_minor: '1500',
      amount_minor: '101500',
      fee_treatment: 'REFUND',
      decision_journal_id: overrides.decision_journal_id ?? (await aJournal()),
      ...overrides,
    });
    return id;
  };

  const partial = (amount: string) => ({
    scope: 'PARTIAL',
    item_amount_minor: amount,
    fee_amount_minor: '0',
    amount_minor: amount,
    fee_treatment: 'RETAIN',
  });

  const update = (id: string, set: string, params: unknown[] = []) =>
    t.app().query(`UPDATE ledger.refunds SET ${set} WHERE id = $1`, [id, ...params]);

  it('names the statuses in lifecycle order', async () => {
    expect(await enumLabels(t.owner(), 'refund_status')).toEqual([
      'REQUESTED',
      'PROCESSING',
      'PROCESSED',
      'FAILED',
      'NEEDS_REVIEW',
    ]);
    expect(await enumLabels(t.owner(), 'refund_scope')).toEqual(['FULL', 'PARTIAL']);
  });

  describe('the cumulative guard', () => {
    it('refuses a refund that would take the charge past what was paid', async () => {
      const charge = await settledCharge();
      await insertRefund(charge, partial('60000'));
      expect(await sqlState(insertRefund(charge, partial('41501')))).toBe('KT014');
      await insertRefund(charge, partial('41500'));
      expect(await sqlState(insertRefund(charge, partial('1')))).toBe('KT014');
    });

    it('refuses a refund against a charge that never settled', async () => {
      const charge = await settledCharge('PENDING');
      expect(await sqlState(insertRefund(charge, partial('100')))).toBe('KT014');
    });

    it('stops counting a refund once it has FAILED', async () => {
      const charge = await settledCharge();
      const first = await insertRefund(charge);
      expect(await sqlState(insertRefund(charge, partial('1')))).toBe('KT014');
      await update(first, `status = 'PROCESSING'`);
      await update(first, `status = 'FAILED', failed_at = now(), failed_journal_id = $2`, [await aJournal()]);
      await insertRefund(charge);
    });

    it('holds when refunds against one charge race each other', async () => {
      const charge = await settledCharge();
      // Ten concurrent inserts of 30% each against one charge: at most three can fit.
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => insertRefund(charge, partial('30000'))),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      const { rows } = await t
        .app()
        .query<{ total: string }>(
          `SELECT coalesce(sum(amount_minor), 0) AS total FROM ledger.refunds WHERE payment_attempt_id = $1`,
          [charge.attemptId],
        );
      expect(BigInt(rows[0]?.total ?? '0')).toBe(90_000n);
    });

    it('allows one live whole-trade refund at a time', async () => {
      const charge = await settledCharge();
      await insertRefund(charge, { item_amount_minor: '1', fee_amount_minor: '0', amount_minor: '1' });
      expect(
        await constraintName(
          insertRefund(charge, { item_amount_minor: '1', fee_amount_minor: '0', amount_minor: '1' }),
        ),
      ).toBe('refunds_one_live_full');
    });
  });

  describe('the shape of a refund', () => {
    it('refuses amounts that do not add up, and a partial that touches the fee', async () => {
      const charge = await settledCharge();
      expect(await constraintName(insertRefund(charge, { amount_minor: '101499' }))).toBe('refunds_amounts');
      expect(
        await constraintName(
          insertRefund(charge, { ...partial('100'), fee_amount_minor: '5', amount_minor: '105' }),
        ),
      ).toBe('refunds_fee_treatment');
      expect(await constraintName(insertRefund(charge, { reference: 'refund-other' }))).toBe(
        'refunds_reference_shape',
      );
    });
  });

  describe('the forward-only guard', () => {
    it('moves forward and never back', async () => {
      const charge = await settledCharge();
      const id = await insertRefund(charge);
      expect(await sqlState(update(id, `status = 'PROCESSED', completed_at = now()`))).toBe('KT015');
      await update(id, `status = 'PROCESSING', dispatched_at = now()`);
      expect(await sqlState(update(id, `status = 'REQUESTED'`))).toBe('KT015');
      await update(id, `provider_refund_id = 'RF_1'`);
      expect(await sqlState(update(id, `provider_refund_id = 'RF_2'`))).toBe('KT015');
      await update(id, `status = 'PROCESSED', completed_at = now()`);
      expect(await sqlState(update(id, `last_provider_status = 'processed'`))).toBe('KT015');
    });

    it('never changes what was refunded or the decision that posted it', async () => {
      const charge = await settledCharge();
      const id = await insertRefund(charge);
      expect(
        await sqlState(update(id, `amount_minor = 1, item_amount_minor = 1, fee_amount_minor = 0`)),
      ).toBe('KT015');
      expect(await sqlState(update(id, `charge_reference = 'other'`))).toBe('KT015');
      expect(await sqlState(update(id, `decision_journal_id = $2`, [await aJournal()]))).toBe('KT015');
    });

    it('never deletes a refund', async () => {
      const charge = await settledCharge();
      const id = await insertRefund(charge);
      expect(await sqlState(t.app().query(`DELETE FROM ledger.refunds WHERE id = $1`, [id]))).not.toBe(
        'no error',
      );
      expect(await sqlState(t.owner().query(`DELETE FROM ledger.refunds WHERE id = $1`, [id]))).toBe('KT002');
    });
  });
});
