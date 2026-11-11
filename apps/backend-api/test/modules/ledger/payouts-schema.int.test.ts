// Migration 0048: payout accounts, preferences, payouts and holds, and the rules the database holds
// for them — amounts that add up and never change, a status that only moves forward, one default
// account per user, and no row ever deleted. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { constraintName, enumLabels, insertAccount, postRaw, sqlState } from './support.js';

describe.runIf(infraEnabled)('ledger payouts schema (T-073)', () => {
  const t = useTestDatabase();

  const insert = async (table: string, values: Record<string, unknown>): Promise<void> => {
    const columns = Object.keys(values);
    await t.app().query(
      `INSERT INTO ledger.${table} (${columns.join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(values),
    );
  };

  const insertPayoutAccount = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const id = (overrides.id as string | undefined) ?? randomUUID();
    await insert('payout_accounts', {
      id,
      user_id: randomUUID(),
      provider: 'PAYSTACK',
      bank_code: '058',
      account_number_enc: 'v1:00:00:00',
      account_number_masked: '******5567',
      account_number_hash: Buffer.from(randomUUID()),
      ...overrides,
    });
    return id;
  };

  const verifiedAccount = (overrides: Record<string, unknown> = {}) =>
    insertPayoutAccount({
      status: 'VERIFIED',
      verified_at: new Date(),
      account_name: 'ADA OKAFOR',
      provider_recipient_id: `RCP_${randomUUID().slice(0, 8)}`,
      ...overrides,
    });

  /** A real posting to point a payout at. */
  const aJournal = async () => {
    const { rows } = await t
      .app()
      .query<{ id: string }>(
        `SELECT id FROM ledger.ledger_accounts WHERE account_type = 'PLATFORM_ESCROW_POOL'`,
      );
    const pool = rows[0]?.id ?? (await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL'));
    const payable = await insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: randomUUID() });
    return postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 100_000n },
      { accountId: payable, direction: 'CREDIT', amountMinor: 100_000n },
    ]);
  };

  const insertPayout = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const id = (overrides.id as string | undefined) ?? randomUUID();
    await insert('payouts', {
      id,
      user_id: randomUUID(),
      payout_account_id: overrides.payout_account_id ?? (await verifiedAccount()),
      provider: 'PAYSTACK',
      trigger: 'MANUAL',
      amount_minor: '100000',
      fee_minor: '0',
      fee_schedule_version: 'test-fee-schedule',
      transfer_amount_minor: '100000',
      reference: `payout-${id}`,
      initiated_journal_id: overrides.initiated_journal_id ?? (await aJournal()),
      ...overrides,
    });
    return id;
  };

  const updatePayout = (id: string, set: string, params: unknown[] = []) =>
    t.app().query(`UPDATE ledger.payouts SET ${set} WHERE id = $1`, [id, ...params]);

  it('names the statuses and modes in the order the ticket gives them', async () => {
    expect(await enumLabels(t.owner(), 'payout_mode')).toEqual([
      'MANUAL',
      'AUTO_IMMEDIATE',
      'AUTO_DAILY',
      'AUTO_WEEKLY',
      'AUTO_MONTHLY',
    ]);
    expect(await enumLabels(t.owner(), 'payout_status')).toEqual([
      'REQUESTED',
      'PROCESSING',
      'SUCCEEDED',
      'FAILED',
      'REVERSED',
      'NEEDS_REVIEW',
    ]);
    expect(await enumLabels(t.owner(), 'payout_hold_type')).toEqual(['PAYOUT_HOLD', 'FULL_FREEZE']);
  });

  describe('payout accounts', () => {
    it('allows one live record of an account per user, and one default', async () => {
      const user = randomUUID();
      const hash = Buffer.from('same-account');
      await insertPayoutAccount({ user_id: user, account_number_hash: hash });
      expect(await constraintName(insertPayoutAccount({ user_id: user, account_number_hash: hash }))).toBe(
        'payout_accounts_one_live',
      );
      // Another user may hold the same number; so may this user at another bank.
      await insertPayoutAccount({ account_number_hash: hash });
      await insertPayoutAccount({ user_id: user, account_number_hash: hash, bank_code: '044' });

      await verifiedAccount({ user_id: user, is_default: true });
      expect(await constraintName(verifiedAccount({ user_id: user, is_default: true }))).toBe(
        'payout_accounts_one_default',
      );
    });

    it('refuses a default that is not verified, and a verified account missing its recipient', async () => {
      expect(await constraintName(insertPayoutAccount({ is_default: true }))).toBe(
        'payout_accounts_default_verified',
      );
      expect(await constraintName(verifiedAccount({ provider_recipient_id: null }))).toBe(
        'payout_accounts_verified',
      );
      expect(await constraintName(insertPayoutAccount({ account_number_masked: '0123456789' }))).toBe(
        'payout_accounts_masked',
      );
    });

    it('never changes the number it was sent against, and a disabled account is final', async () => {
      const id = await verifiedAccount();
      expect(
        await sqlState(
          t
            .app()
            .query(`UPDATE ledger.payout_accounts SET account_number_masked = '******0000' WHERE id = $1`, [
              id,
            ]),
        ),
      ).toBe('KT013');
      expect(
        await sqlState(
          t
            .app()
            .query(`UPDATE ledger.payout_accounts SET provider_recipient_id = 'RCP_other' WHERE id = $1`, [
              id,
            ]),
        ),
      ).toBe('KT013');
      expect(
        await sqlState(
          t
            .app()
            .query(`UPDATE ledger.payout_accounts SET status = 'PENDING_VERIFICATION' WHERE id = $1`, [id]),
        ),
      ).toBe('KT013');

      await t
        .app()
        .query(`UPDATE ledger.payout_accounts SET status = 'DISABLED', disabled_at = now() WHERE id = $1`, [
          id,
        ]);
      expect(
        await sqlState(
          t
            .app()
            .query(
              `UPDATE ledger.payout_accounts SET status = 'VERIFIED', disabled_at = NULL WHERE id = $1`,
              [id],
            ),
        ),
      ).toBe('KT013');
      expect(
        await sqlState(t.app().query(`DELETE FROM ledger.payout_accounts WHERE id = $1`, [id])),
      ).not.toBe('no error');
    });
  });

  describe('payouts', () => {
    it('refuses amounts that do not add up, and a reference that is not the payout’s own', async () => {
      expect(await constraintName(insertPayout({ transfer_amount_minor: '99999' }))).toBe('payouts_amounts');
      expect(
        await constraintName(
          insertPayout({ amount_minor: '100', fee_minor: '100', transfer_amount_minor: '0' }),
        ),
      ).toBe('payouts_amounts');
      expect(await constraintName(insertPayout({ fee_minor: '-1', transfer_amount_minor: '100001' }))).toBe(
        'payouts_amounts',
      );
      expect(await constraintName(insertPayout({ reference: `payout-${randomUUID()}` }))).toBe(
        'payouts_reference_shape',
      );
    });

    it('ties an automatic payout to what triggered it, once per release credit', async () => {
      expect(await constraintName(insertPayout({ trigger: 'AUTO_IMMEDIATE' }))).toBe(
        'payouts_trigger_source',
      );
      expect(await constraintName(insertPayout({ trigger: 'AUTO_SWEEP' }))).toBe('payouts_trigger_source');
      expect(await constraintName(insertPayout({ sweep_key: 'AUTO_DAILY:x:2026-11-11' }))).toBe(
        'payouts_trigger_source',
      );

      const source = await aJournal();
      await insertPayout({ trigger: 'AUTO_IMMEDIATE', source_journal_entry_id: source });
      expect(
        await constraintName(insertPayout({ trigger: 'AUTO_IMMEDIATE', source_journal_entry_id: source })),
      ).toBe('payouts_one_per_source');

      await insertPayout({ trigger: 'AUTO_SWEEP', sweep_key: 'AUTO_DAILY:u:2026-11-11' });
      expect(
        await constraintName(insertPayout({ trigger: 'AUTO_SWEEP', sweep_key: 'AUTO_DAILY:u:2026-11-11' })),
      ).toBe('payouts_sweep_key_unique');
    });

    it('freezes identity and amounts, and requires each outcome to carry its journal', async () => {
      const id = await insertPayout();
      for (const set of [
        `amount_minor = 1`,
        `fee_minor = 1, transfer_amount_minor = 99999`,
        `user_id = gen_random_uuid()`,
        `fee_schedule_version = 'other'`,
        `initiated_journal_id = '${await aJournal()}'`,
      ]) {
        expect(await sqlState(updatePayout(id, set)), set).toBe('KT013');
      }
      expect(await sqlState(updatePayout(id, `status = 'PROCESSING'`))).toBe('no error');
      expect(await constraintName(updatePayout(id, `status = 'SUCCEEDED'`))).toBe('payouts_succeeded_posted');
      expect(await constraintName(updatePayout(id, `status = 'FAILED'`))).toBe('payouts_reversed_posted');
    });

    it('only moves forward, and a failed payout is final', async () => {
      const id = await insertPayout();
      expect(
        await sqlState(
          updatePayout(id, `status = 'REVERSED', reversed_journal_id = $2, failed_at = now()`, [
            await aJournal(),
          ]),
        ),
      ).toBe('KT013');
      await updatePayout(id, `status = 'PROCESSING', dispatched_at = now(), provider_transfer_id = 'TRF_1'`);
      expect(await sqlState(updatePayout(id, `status = 'REQUESTED'`))).toBe('KT013');
      expect(await sqlState(updatePayout(id, `provider_transfer_id = 'TRF_2'`))).toBe('KT013');

      const settled = await aJournal();
      await updatePayout(id, `status = 'SUCCEEDED', settled_journal_id = $2, completed_at = now()`, [
        settled,
      ]);
      // The bank may still send it back.
      const reversed = await aJournal();
      await updatePayout(id, `status = 'REVERSED', reversed_journal_id = $2, failed_at = now()`, [reversed]);
      expect(await sqlState(updatePayout(id, `last_checked_at = now()`))).toBe('KT013');
      expect(await sqlState(t.app().query(`DELETE FROM ledger.payouts WHERE id = $1`, [id]))).not.toBe(
        'no error',
      );
    });
  });

  describe('payout holds', () => {
    it('may only be released, once', async () => {
      const id = randomUUID();
      await insert('payout_holds', {
        id,
        user_id: randomUUID(),
        hold_type: 'PAYOUT_HOLD',
        source: 'REVIEWER:test',
        reason: 'test hold',
      });
      expect(
        await constraintName(
          t.app().query(`UPDATE ledger.payout_holds SET released_at = now() WHERE id = $1`, [id]),
        ),
      ).toBe('payout_holds_released');
      expect(
        await sqlState(t.app().query(`UPDATE ledger.payout_holds SET reason = 'other' WHERE id = $1`, [id])),
      ).toBe('KT013');
      await t
        .app()
        .query(
          `UPDATE ledger.payout_holds SET released_at = now(), released_by = 'REVIEWER:x' WHERE id = $1`,
          [id],
        );
      expect(
        await sqlState(
          t.app().query(`UPDATE ledger.payout_holds SET released_by = 'REVIEWER:y' WHERE id = $1`, [id]),
        ),
      ).toBe('KT013');
    });
  });
});
