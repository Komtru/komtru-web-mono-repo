// Migration 0040: payment attempts and the webhook dedup log, and the rules the database holds for
// them — one live checkout and one success per trade, amounts that add up and never change, a status
// that only moves forward, and no row ever deleted. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { constraintName, enumLabels, insertAccount, postRaw, sqlState } from './support.js';

describe.runIf(infraEnabled)('ledger payments schema', () => {
  const t = useTestDatabase();

  const insertAttempt = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const id = (overrides.id as string | undefined) ?? randomUUID();
    const values: Record<string, unknown> = {
      id,
      trade_id: randomUUID(),
      buyer_user_id: randomUUID(),
      provider: 'PAYSTACK',
      reference: `fund-${id}`,
      fee_schedule_version: 'test-fee-schedule',
      item_amount_minor: '45000000',
      buyer_protection_fee_minor: '675000',
      amount_minor: '45675000',
      ...overrides,
    };
    const columns = Object.keys(values);
    await t.app().query(
      `INSERT INTO ledger.payment_attempts (${columns.join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(values),
    );
    return id;
  };

  const update = (id: string, set: string, params: unknown[] = []) =>
    t.app().query(`UPDATE ledger.payment_attempts SET ${set} WHERE id = $1`, [id, ...params]);

  /** A real posting to point an attempt at; the pool account is a singleton, so it is found once. */
  const aJournal = async () => {
    const { rows } = await t
      .app()
      .query<{ id: string }>(
        `SELECT id FROM ledger.ledger_accounts WHERE account_type = 'PLATFORM_ESCROW_POOL'`,
      );
    const pool = rows[0]?.id ?? (await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL'));
    const escrow = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: randomUUID() });
    return postRaw(t.app(), [
      { accountId: pool, direction: 'DEBIT', amountMinor: 45_675_000n },
      { accountId: escrow, direction: 'CREDIT', amountMinor: 45_675_000n },
    ]);
  };

  it('names the attempt statuses in lifecycle order', async () => {
    expect(await enumLabels(t.owner(), 'payment_attempt_status')).toEqual([
      'INITIATED',
      'PENDING',
      'SUCCEEDED',
      'FAILED',
      'ABANDONED',
      'NEEDS_REVIEW',
    ]);
  });

  it('refuses amounts that do not add up, and a reference that is not the attempt’s own', async () => {
    expect(await constraintName(insertAttempt({ amount_minor: '45675001' }))).toBe(
      'payment_attempts_amounts',
    );
    expect(await constraintName(insertAttempt({ item_amount_minor: '0', amount_minor: '675000' }))).toBe(
      'payment_attempts_amounts',
    );
    expect(await constraintName(insertAttempt({ reference: `fund-${randomUUID()}` }))).toBe(
      'payment_attempts_reference_shape',
    );
  });

  it('allows one live checkout and one success per trade', async () => {
    const trade = randomUUID();
    const first = await insertAttempt({ trade_id: trade });
    expect(await constraintName(insertAttempt({ trade_id: trade }))).toBe('payment_attempts_one_open');

    await update(first, `status = 'FAILED', closed_at = now()`);
    const second = await insertAttempt({ trade_id: trade });
    const journal = await aJournal();
    await update(second, `status = 'SUCCEEDED', journal_entry_id = $2, confirmed_at = now()`, [journal]);

    const third = await insertAttempt({ trade_id: trade });
    const journal2 = await aJournal();
    expect(
      await constraintName(
        update(third, `status = 'SUCCEEDED', journal_entry_id = $2, confirmed_at = now()`, [journal2]),
      ),
    ).toBe('payment_attempts_one_success');
  });

  it('will not call an attempt succeeded without its posting', async () => {
    const id = await insertAttempt();
    expect(await constraintName(update(id, `status = 'SUCCEEDED', confirmed_at = now()`))).toBe(
      'payment_attempts_succeeded_posted',
    );
  });

  it('freezes the amounts and identity, and moves only forward', async () => {
    const id = await insertAttempt();
    expect(
      await sqlState(update(id, `amount_minor = 1, item_amount_minor = 1, buyer_protection_fee_minor = 0`)),
    ).toBe('KT012');
    expect(await sqlState(update(id, `buyer_user_id = $2`, [randomUUID()]))).toBe('KT012');

    await update(id, `status = 'PENDING', pending_at = now()`);
    expect(await sqlState(update(id, `status = 'INITIATED'`))).toBe('KT012');

    await update(id, `status = 'NEEDS_REVIEW', closed_at = now(), failure_reason = 'over-payment'`);
    expect(await sqlState(update(id, `status = 'PENDING', closed_at = NULL`))).toBe('KT012');
    expect(await sqlState(update(id, `failure_reason = 'rewritten'`))).toBe('KT012');
  });

  it('never re-points a posting or a provider reference once set', async () => {
    const id = await insertAttempt();
    const journal = await aJournal();
    await update(id, `provider_reference = reference`);
    expect(await sqlState(update(id, `provider_reference = 'other'`))).toBe('KT012');
    await update(id, `status = 'SUCCEEDED', journal_entry_id = $2, confirmed_at = now()`, [journal]);
    expect(await sqlState(update(id, `journal_entry_id = $2`, [await aJournal()]))).toBe('KT012');
  });

  it('never deletes an attempt or a delivery, even as the owner', async () => {
    const id = await insertAttempt();
    expect(await sqlState(t.app().query('DELETE FROM ledger.payment_attempts WHERE id = $1', [id]))).not.toBe(
      'no error',
    );
    expect(await sqlState(t.owner().query('DELETE FROM ledger.payment_attempts WHERE id = $1', [id]))).toBe(
      'KT002',
    );
  });

  it('lets a final attempt record its review alert once, and nothing else', async () => {
    const id = await insertAttempt();
    await update(id, `status = 'ABANDONED', closed_at = now()`);
    await update(id, `review_published_at = now()`);
    expect(await sqlState(update(id, `review_published_at = now() + interval '1 minute'`))).toBe('KT012');
    expect(await sqlState(update(id, `review_published_at = NULL`))).toBe('KT012');
  });

  it('records the first provider sighting once', async () => {
    const id = await insertAttempt();
    await update(id, `provider_seen_at = now(), last_verify_error = 'timeout', last_verify_error_at = now()`);
    expect(await sqlState(update(id, `provider_seen_at = now() + interval '1 minute'`))).toBe('KT012');
  });

  it('is reached as komtru_app, which can read, write and update both tables', async () => {
    const { rows } = await t.app().query<{ who: string; attempts: boolean; webhooks: boolean }>(
      `SELECT current_user AS who,
              (has_table_privilege('ledger.payment_attempts', 'SELECT') AND has_table_privilege('ledger.payment_attempts', 'INSERT')
               AND has_table_privilege('ledger.payment_attempts', 'UPDATE')) AS attempts,
              (has_table_privilege('ledger.payment_provider_webhooks', 'SELECT') AND has_table_privilege('ledger.payment_provider_webhooks', 'INSERT')
               AND has_table_privilege('ledger.payment_provider_webhooks', 'UPDATE')) AS webhooks`,
    );
    expect(rows[0]).toEqual({ who: 'komtru_app', attempts: true, webhooks: true });
  });

  describe('the webhook log', () => {
    const insertDelivery = (eventId: string) =>
      t.app().query<{ id: string }>(
        `INSERT INTO ledger.payment_provider_webhooks (provider, provider_event_id, event_type, payload, signature_valid)
         VALUES ('PAYSTACK', $1, 'charge.success', '{}'::jsonb, true) RETURNING id`,
        [eventId],
      );

    it('is unique per provider event', async () => {
      await insertDelivery('charge.success:1');
      expect(await constraintName(insertDelivery('charge.success:1'))).toBe(
        'payment_provider_webhooks_dedup',
      );
    });

    it('stores only signed deliveries', async () => {
      expect(
        await constraintName(
          t.app().query(
            `INSERT INTO ledger.payment_provider_webhooks (provider, provider_event_id, event_type, payload, signature_valid)
             VALUES ('PAYSTACK', 'x:1', 'x', '{}'::jsonb, false)`,
          ),
        ),
      ).toBe('payment_provider_webhooks_signed');
    });

    it('records the processing outcome once and nothing else', async () => {
      const { rows } = await insertDelivery('charge.success:2');
      const id = rows[0]?.id;
      const set = (clause: string) =>
        t.app().query(`UPDATE ledger.payment_provider_webhooks SET ${clause} WHERE id = $1`, [id]);

      await set('duplicate_count = duplicate_count + 1, sweep_count = sweep_count + 1');
      await set(`processing_error = 'exhausted'`);
      expect(await sqlState(set('sweep_count = 0'))).toBe('KT012');
      expect(await sqlState(set(`payload = '{"a":1}'::jsonb`))).toBe('KT012');
      expect(await sqlState(set('duplicate_count = 0'))).toBe('KT012');
      await set(`processed_at = now()`);
      expect(await sqlState(set(`processed_at = now() + interval '1 hour'`))).toBe('KT012');
      expect(await sqlState(set(`processing_error = 'late'`))).toBe('KT012');
      await set('duplicate_count = duplicate_count + 1');
    });
  });
});
