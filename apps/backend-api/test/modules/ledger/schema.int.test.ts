// M8 §4–5: the chart of accounts and the journal tables, and the constraints that make an account's
// identity and a posting's shape unforgeable. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { constraintName, enumLabels, insertAccount, insertJournal, postRaw, sqlState } from './support.js';

describe.runIf(infraEnabled)('ledger schema', () => {
  const t = useTestDatabase();

  const balancedJournal = async (overrides: Record<string, unknown> = {}, amount = 10_000n) => {
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    const escrow = await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: randomUUID() });
    const journal = await postRaw(
      t.app(),
      [
        { accountId: pool, direction: 'DEBIT', amountMinor: amount },
        { accountId: escrow, direction: 'CREDIT', amountMinor: amount },
      ],
      overrides,
    );
    return { journal, pool, escrow };
  };

  it('names the six account types in chart order', async () => {
    expect(await enumLabels(t.owner(), 'ledger_account_type')).toEqual([
      'PLATFORM_ESCROW_POOL',
      'USER_ESCROW_LIABILITY',
      'USER_PAYABLE',
      'PLATFORM_FEE_REVENUE',
      'BUYER_PROTECTION_FEE_REVENUE',
      'SETTLEMENT_CLEARING',
    ]);
  });

  it('has no Park account type', async () => {
    const labels = await enumLabels(t.owner(), 'ledger_account_type');
    expect(labels).toHaveLength(6);
    expect(labels.filter((label) => label.includes('PARK'))).toEqual([]);
  });

  it('names the two entry directions and the two payment providers', async () => {
    expect(await enumLabels(t.owner(), 'ledger_entry_direction')).toEqual(['DEBIT', 'CREDIT']);
    expect(await enumLabels(t.owner(), 'payment_provider')).toEqual(['PAYSTACK', 'FLUTTERWAVE']);
  });

  it('derives account_key from the currency, type and scope', async () => {
    const trade = randomUUID();
    const { rows } = await t.app().query<{ account_key: string }>(
      `INSERT INTO ledger.ledger_accounts (account_type, trade_id) VALUES ('USER_ESCROW_LIABILITY', $1)
       RETURNING account_key`,
      [trade],
    );
    expect(rows[0]?.account_key).toBe(`NGN:USER_ESCROW_LIABILITY:${trade}`);
  });

  it('names a platform account with no scope at all', async () => {
    const { rows } = await t
      .app()
      .query<{ account_key: string }>(
        `INSERT INTO ledger.ledger_accounts (account_type) VALUES ('PLATFORM_ESCROW_POOL') RETURNING account_key`,
      );
    expect(rows[0]?.account_key).toBe('NGN:PLATFORM_ESCROW_POOL:-');
  });

  it('refuses a caller-supplied account_key', async () => {
    expect(
      await sqlState(
        t
          .app()
          .query(
            `INSERT INTO ledger.ledger_accounts (account_type, account_key) VALUES ('PLATFORM_ESCROW_POOL', 'mine')`,
          ),
      ),
    ).toBe('428C9');
  });

  it('allows only one account per type, scope and currency', async () => {
    const trade = randomUUID();
    await insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: trade });
    expect(await sqlState(insertAccount(t.app(), 'USER_ESCROW_LIABILITY', { trade_id: trade }))).toBe(
      '23505',
    );
  });

  it('allows only one of each platform singleton per currency', async () => {
    await insertAccount(t.app(), 'PLATFORM_FEE_REVENUE');
    expect(await sqlState(insertAccount(t.app(), 'PLATFORM_FEE_REVENUE'))).toBe('23505');
    await insertAccount(t.app(), 'PLATFORM_FEE_REVENUE', { currency: 'USD' });
  });

  it('rejects a platform account carrying a scope', async () => {
    expect(
      await constraintName(insertAccount(t.app(), 'PLATFORM_FEE_REVENUE', { owner_user_id: randomUUID() })),
    ).toBe('ledger_accounts_scope');
  });

  it('rejects a trade escrow account with no trade', async () => {
    expect(await constraintName(insertAccount(t.app(), 'USER_ESCROW_LIABILITY'))).toBe(
      'ledger_accounts_scope',
    );
  });

  it('rejects a payable with no owner', async () => {
    expect(await constraintName(insertAccount(t.app(), 'USER_PAYABLE'))).toBe('ledger_accounts_scope');
  });

  it('rejects a payable that also carries a trade id', async () => {
    expect(
      await constraintName(
        insertAccount(t.app(), 'USER_PAYABLE', { owner_user_id: randomUUID(), trade_id: randomUUID() }),
      ),
    ).toBe('ledger_accounts_scope');
  });

  it('rejects settlement clearing with no payout', async () => {
    expect(await constraintName(insertAccount(t.app(), 'SETTLEMENT_CLEARING'))).toBe('ledger_accounts_scope');
  });

  it('rejects a currency that is not three upper-case letters', async () => {
    expect(await constraintName(insertAccount(t.app(), 'PLATFORM_ESCROW_POOL', { currency: 'ngn' }))).toBe(
      'ledger_accounts_currency',
    );
  });

  it('rejects a zero and a negative amount', async () => {
    const pool = await insertAccount(t.app(), 'PLATFORM_ESCROW_POOL');
    expect(
      await constraintName(
        postRaw(t.app(), [
          { accountId: pool, direction: 'DEBIT', amountMinor: 0n },
          { accountId: pool, direction: 'CREDIT', amountMinor: 0n },
        ]),
      ),
    ).toBe('ledger_entries_amount_positive');
    expect(
      await constraintName(
        postRaw(t.app(), [
          { accountId: pool, direction: 'DEBIT', amountMinor: -1n },
          { accountId: pool, direction: 'CREDIT', amountMinor: -1n },
        ]),
      ),
    ).toBe('ledger_entries_amount_positive');
  });

  it('stores an amount beyond 2^53 exactly', async () => {
    const huge = 9_007_199_254_740_993n;
    const { journal } = await balancedJournal({}, huge);
    const { rows } = await t
      .app()
      .query<{ amount_minor: string }>(
        `SELECT amount_minor FROM ledger.ledger_entries WHERE journal_entry_id = $1 LIMIT 1`,
        [journal],
      );
    expect(rows[0]?.amount_minor).toBe(huge.toString());
  });

  it('rejects a journal entry with a provider but no reference', async () => {
    expect(await constraintName(insertJournal(t.app(), { provider: 'PAYSTACK' }))).toBe(
      'ledger_journal_entries_provider_pair',
    );
  });

  it('rejects a journal entry with a reference but no provider', async () => {
    expect(await constraintName(insertJournal(t.app(), { provider_reference: 'ref_1' }))).toBe(
      'ledger_journal_entries_provider_pair',
    );
  });

  it('rejects an idempotency key with no namespace', async () => {
    expect(await constraintName(insertJournal(t.app(), { idempotency_key: 'abc123' }))).toBe(
      'ledger_journal_entries_key_shape',
    );
  });

  it('rejects a journal entry declaring fewer than two lines', async () => {
    expect(await constraintName(insertJournal(t.app(), { line_count: 1 }))).toBe(
      'ledger_journal_entries_line_count',
    );
  });

  it('rejects a second journal entry with the same idempotency key', async () => {
    const key = `test:${randomUUID()}`;
    await balancedJournal({ idempotency_key: key });
    expect(await sqlState(insertJournal(t.app(), { idempotency_key: key }))).toBe('23505');
  });

  it('defaults a posting to NGN, the system actor and now', async () => {
    const { journal } = await balancedJournal();
    const { rows } = await t
      .app()
      .query<{ currency: string; created_by: string; posted_at: Date }>(
        `SELECT currency, created_by, posted_at FROM ledger.ledger_journal_entries WHERE id = $1`,
        [journal],
      );
    expect(rows[0]?.currency).toBe('NGN');
    expect(rows[0]?.created_by).toBe('SYSTEM');
    expect(rows[0]?.posted_at).toBeInstanceOf(Date);
  });
});
