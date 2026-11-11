// T-073 against a real Postgres: payout accounts, preferences, and creating a payout — including the
// one property everything else rests on, that concurrent withdrawals against one balance can never
// take more than the balance. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { createEncryption } from '../../../src/platform/crypto/encryption.js';
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';
import { ApiError } from '../../../src/platform/errors.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  AccountNotResolvableError,
  accountBalance,
  executePayout,
  placePayoutHold,
  postJournal,
  releasePayoutHold,
  trialBalance,
  type AccountRef,
  type ExecutePayoutInput,
} from '../../../src/modules/ledger/index.js';
import {
  addPayoutAccount,
  listAccounts,
  removePayoutAccount,
  setDefaultPayoutAccount,
  verifyPayoutAccount,
  ACCOUNT_NOT_FOUND_REASON,
  NAME_MISMATCH_REASON,
  type NameMatchVerdict,
} from '../../../src/modules/ledger/services/payoutAccount.service.js';
import { requestPayout, payoutSummary } from '../../../src/modules/ledger/services/payout.service.js';
import {
  getPayoutPreference,
  setPayoutPreference,
} from '../../../src/modules/ledger/services/payoutPreference.service.js';
import { insertPayoutAccount } from '../../../src/modules/ledger/infrastructure/postgres/payoutsRepository.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { identityProcessEnv } from '../../support/identity-env.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
  ...identityProcessEnv(),
});
const logger = createLogger(config);
const crypto = { encryption: createEncryption(config), hasher: createHmacHasher('p'.repeat(32)) };

const PAYOUT_FEE = 2_500n;
const fee = () => ({ version: 'test-fee-schedule', currency: 'NGN', amountMinor: PAYOUT_FEE });
const BANKS = [
  { name: 'Access Bank', code: '044' },
  { name: 'Guaranty Trust Bank', code: '058' },
];

describe.runIf(infraEnabled)('payouts (T-073)', () => {
  const t = useTestDatabase();
  const deps = () => ({ db: t.db(), logger, fee });

  const POOL: AccountRef = { type: 'PLATFORM_ESCROW_POOL' };
  const REVENUE: AccountRef = { type: 'PLATFORM_FEE_REVENUE' };
  const payableOf = (userId: string): AccountRef => ({ type: 'USER_PAYABLE', ownerUserId: userId });
  const clearingOf = (payoutId: string): AccountRef => ({ type: 'SETTLEMENT_CLEARING', payoutId });
  const balance = async (ref: AccountRef) => (await accountBalance(t.db(), ref)).balanceMinor;

  /** What T-074's release leaves behind: proceeds in the seller's payable, cash in the pool. */
  const credit = async (userId: string, amountMinor: bigint) =>
    t.db().transaction((tx) =>
      postJournal(tx, {
        idempotencyKey: `test:release:${randomUUID()}`,
        description: 'test release',
        lines: [
          { account: POOL, direction: 'DEBIT', amountMinor },
          { account: payableOf(userId), direction: 'CREDIT', amountMinor },
        ],
      }),
    );

  const verifiedAccount = async (userId: string, overrides: { isDefault?: boolean } = {}) =>
    insertPayoutAccount(t.db(), {
      userId,
      provider: 'PAYSTACK',
      bankCode: '058',
      bankName: 'Guaranty Trust Bank',
      accountNumberEnc: crypto.encryption.encrypt('0123455567'),
      accountNumberMasked: '******5567',
      accountNumberHash: crypto.hasher.hmac('ledger:payout-account', randomUUID()),
      status: 'VERIFIED',
      accountName: 'ADA OKAFOR',
      providerRecipientId: `RCP_${randomUUID().slice(0, 8)}`,
      verifiedAt: new Date(),
      isDefault: overrides.isDefault ?? true,
    });

  const execute = (input: Partial<ExecutePayoutInput> & { userId: string; amountMinor: bigint }) =>
    t.db().transaction((tx) => executePayout(tx, deps(), { trigger: 'MANUAL', ...input }));

  const outbox = async (eventType: string) => {
    const { rows } = await t
      .owner()
      .query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM platform.outbox WHERE event_type = $1 ORDER BY occurred_at`,
        [eventType],
      );
    return rows.map((row) => row.payload);
  };

  describe('executePayout', () => {
    it('moves the amount from the payable into clearing, the fee into revenue, and announces it', async () => {
      const seller = randomUUID();
      await credit(seller, 100_000n);
      const account = await verifiedAccount(seller);

      const result = await execute({ userId: seller, amountMinor: 60_000n });
      expect(result.outcome).toBe('CREATED');
      if (result.outcome !== 'CREATED') return;
      const { payout } = result;

      expect(payout).toMatchObject({
        status: 'REQUESTED',
        trigger: 'MANUAL',
        payoutAccountId: account.id,
        amountMinor: 60_000n,
        feeMinor: PAYOUT_FEE,
        transferAmountMinor: 60_000n - PAYOUT_FEE,
        feeScheduleVersion: 'test-fee-schedule',
        reference: `payout-${payout.id}`,
      });
      expect(await balance(payableOf(seller))).toBe(40_000n);
      expect(await balance(clearingOf(payout.id))).toBe(60_000n - PAYOUT_FEE);
      expect(await balance(REVENUE)).toBe(PAYOUT_FEE);
      expect((await trialBalance(t.db())).every((row) => row.differenceMinor === 0n)).toBe(true);

      expect(await outbox('ledger.payout.requested')).toEqual([
        expect.objectContaining({
          payoutId: payout.id,
          userId: seller,
          trigger: 'MANUAL',
          amountMinor: '60000',
          feeMinor: String(PAYOUT_FEE),
          transferAmountMinor: String(60_000n - PAYOUT_FEE),
        }),
      ]);
    });

    it('posts no fee line at a zero fee', async () => {
      const seller = randomUUID();
      await credit(seller, 10_000n);
      await verifiedAccount(seller);
      const result = await t
        .db()
        .transaction((tx) =>
          executePayout(
            tx,
            { logger, fee: () => ({ ...fee(), amountMinor: 0n }) },
            { userId: seller, amountMinor: 10_000n, trigger: 'MANUAL' },
          ),
        );
      expect(result.outcome).toBe('CREATED');
      expect(await balance(payableOf(seller))).toBe(0n);
      expect(await balance(REVENUE)).toBe(0n);
    });

    it('refuses without a verified default account, and writes nothing', async () => {
      const seller = randomUUID();
      await credit(seller, 100_000n);
      expect(await execute({ userId: seller, amountMinor: 50_000n })).toMatchObject({
        outcome: 'REFUSED',
        reason: 'NO_VERIFIED_ACCOUNT',
      });
      // Somebody else's account cannot be named either.
      const other = await verifiedAccount(randomUUID());
      expect(
        await execute({ userId: seller, amountMinor: 50_000n, payoutAccountId: other.id }),
      ).toMatchObject({ outcome: 'REFUSED', reason: 'ACCOUNT_NOT_FOUND' });
      expect(await balance(payableOf(seller))).toBe(100_000n);
    });

    it('refuses an amount the fee would swallow, and one above the available balance', async () => {
      const seller = randomUUID();
      await credit(seller, 100_000n);
      await verifiedAccount(seller);
      expect(await execute({ userId: seller, amountMinor: PAYOUT_FEE })).toMatchObject({
        outcome: 'REFUSED',
        reason: 'AMOUNT_TOO_SMALL',
      });
      expect(await execute({ userId: seller, amountMinor: 100_001n })).toMatchObject({
        outcome: 'REFUSED',
        reason: 'INSUFFICIENT_BALANCE',
      });
      expect(await execute({ userId: seller, amountMinor: 100_000n })).toMatchObject({ outcome: 'CREATED' });
    });

    it('is stopped by a hold in force, and not by one released or expired', async () => {
      const seller = randomUUID();
      await credit(seller, 100_000n);
      await verifiedAccount(seller);

      const hold = await t.db().transaction((tx) =>
        placePayoutHold(tx, {
          userId: seller,
          holdType: 'PAYOUT_HOLD',
          source: 'RISK_RULE:test',
          reason: 'test',
        }),
      );
      expect(await execute({ userId: seller, amountMinor: 10_000n })).toMatchObject({
        outcome: 'REFUSED',
        reason: 'HELD',
      });

      await t
        .db()
        .transaction((tx) => releasePayoutHold(tx, { holdId: hold.id, releasedBy: 'REVIEWER:test' }));
      await t.db().transaction((tx) =>
        placePayoutHold(tx, {
          userId: seller,
          holdType: 'FULL_FREEZE',
          source: 'RISK_RULE:test',
          reason: 'expired',
          expiresAt: new Date(Date.now() - 1_000),
        }),
      );
      expect(await execute({ userId: seller, amountMinor: 10_000n })).toMatchObject({ outcome: 'CREATED' });
      // A second release of the same hold is a no-op, not an error.
      expect(
        await t
          .db()
          .transaction((tx) => releasePayoutHold(tx, { holdId: hold.id, releasedBy: 'REVIEWER:x' })),
      ).toBeUndefined();
    });

    it('pays one release credit out once, and one sweep day once', async () => {
      const seller = randomUUID();
      const released = await credit(seller, 100_000n);
      await verifiedAccount(seller);
      const immediate = {
        userId: seller,
        amountMinor: 30_000n,
        trigger: 'AUTO_IMMEDIATE' as const,
        sourceJournalEntryId: released.journalEntry.id,
        sourceTradeId: randomUUID(),
      };
      const first = await execute(immediate);
      expect(first.outcome).toBe('CREATED');
      const again = await execute(immediate);
      expect(again.outcome).toBe('EXISTS');
      if (first.outcome === 'CREATED' && again.outcome === 'EXISTS')
        expect(again.payout.id).toBe(first.payout.id);

      const sweep = {
        userId: seller,
        amountMinor: 20_000n,
        trigger: 'AUTO_SWEEP' as const,
        sweepKey: `AUTO_DAILY:${seller}:2026-11-11`,
      };
      expect((await execute(sweep)).outcome).toBe('CREATED');
      expect((await execute(sweep)).outcome).toBe('EXISTS');
      expect(await balance(payableOf(seller))).toBe(50_000n);
    });

    it('never lets concurrent withdrawals take more than the balance', async () => {
      const seller = randomUUID();
      await credit(seller, 100_000n);
      await verifiedAccount(seller);

      const results = await Promise.all(
        Array.from({ length: 6 }, () => execute({ userId: seller, amountMinor: 30_000n })),
      );
      const outcomes = results.map((r) => (r.outcome === 'REFUSED' ? r.reason : r.outcome)).sort();
      expect(outcomes).toEqual([
        'CREATED',
        'CREATED',
        'CREATED',
        'INSUFFICIENT_BALANCE',
        'INSUFFICIENT_BALANCE',
        'INSUFFICIENT_BALANCE',
      ]);
      expect(await balance(payableOf(seller))).toBe(10_000n);
      expect((await trialBalance(t.db())).every((row) => row.differenceMinor === 0n)).toBe(true);
    });

    it('serialises a hold with a payout: a hold placed while one is created never sees a half-written one', async () => {
      const seller = randomUUID();
      await credit(seller, 100_000n);
      await verifiedAccount(seller);
      const [payout] = await Promise.all([
        execute({ userId: seller, amountMinor: 10_000n }),
        t.db().transaction((tx) =>
          placePayoutHold(tx, {
            userId: seller,
            holdType: 'PAYOUT_HOLD',
            source: 'RISK_RULE:test',
            reason: 'race',
          }),
        ),
      ]);
      // Either order is correct; what is not is a payout created after the hold committed.
      const after = await execute({ userId: seller, amountMinor: 10_000n });
      expect(after).toMatchObject({ outcome: 'REFUSED', reason: 'HELD' });
      expect(['CREATED', 'REFUSED']).toContain(payout.outcome);
    });
  });

  describe('the seller-facing payout service', () => {
    it('turns each refusal into the code its screen branches on', async () => {
      const seller = randomUUID();
      await credit(seller, 50_000n);
      const ask = (amountMinor: bigint) => requestPayout(deps(), { userId: seller, amountMinor });

      await expect(ask(10_000n)).rejects.toMatchObject({ status: 409, code: 'PAYOUT_ACCOUNT_REQUIRED' });
      await verifiedAccount(seller);
      await expect(ask(60_000n)).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_BALANCE' });
      await expect(ask(1n)).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
      await t.db().transaction((tx) =>
        placePayoutHold(tx, {
          userId: seller,
          holdType: 'PAYOUT_HOLD',
          source: 'RISK_RULE:test',
          reason: 'x',
        }),
      );
      await expect(ask(10_000n)).rejects.toMatchObject({ status: 409, code: 'PAYOUT_HELD' });
    });

    it('reports the available balance, what is in flight and the fee', async () => {
      const seller = randomUUID();
      await credit(seller, 50_000n);
      await verifiedAccount(seller);
      const view = await requestPayout(deps(), { userId: seller, amountMinor: 20_000n });
      expect(view).toMatchObject({
        status: 'REQUESTED',
        amountMinor: '20000',
        destination: { accountNumberMasked: '******5567', accountName: 'ADA OKAFOR' },
      });
      expect(await payoutSummary(deps(), seller)).toMatchObject({
        currency: 'NGN',
        availableMinor: '30000',
        inFlightMinor: '20000',
        payoutFeeMinor: String(PAYOUT_FEE),
        mode: 'MANUAL',
        held: false,
      });
    });
  });

  describe('preferences', () => {
    it('refuses an automatic mode without a verified default account', async () => {
      const seller = randomUUID();
      await expect(setPayoutPreference(t.db(), { userId: seller, mode: 'AUTO_DAILY' })).rejects.toMatchObject(
        {
          status: 409,
          code: 'PAYOUT_ACCOUNT_REQUIRED',
        },
      );
      expect(await setPayoutPreference(t.db(), { userId: seller, mode: 'MANUAL' })).toMatchObject({
        mode: 'MANUAL',
      });

      const account = await verifiedAccount(seller);
      expect(await setPayoutPreference(t.db(), { userId: seller, mode: 'AUTO_WEEKLY' })).toMatchObject({
        mode: 'AUTO_WEEKLY',
        defaultAccount: { id: account.id },
      });
      expect((await getPayoutPreference(t.db(), seller)).mode).toBe('AUTO_WEEKLY');

      // The default account cannot be removed while an automatic mode needs it.
      await expect(
        removePayoutAccount({ db: t.db() }, { userId: seller, payoutAccountId: account.id }),
      ).rejects.toMatchObject({ status: 409, code: 'PAYOUT_ACCOUNT_REQUIRED' });
      await setPayoutPreference(t.db(), { userId: seller, mode: 'MANUAL' });
      expect(
        await removePayoutAccount({ db: t.db() }, { userId: seller, payoutAccountId: account.id }),
      ).toMatchObject({ status: 'DISABLED', isDefault: false });
    });

    it('refuses to remove an account a payout is still on its way to', async () => {
      const seller = randomUUID();
      await credit(seller, 50_000n);
      const account = await verifiedAccount(seller);
      await execute({ userId: seller, amountMinor: 20_000n });
      await expect(
        removePayoutAccount({ db: t.db() }, { userId: seller, payoutAccountId: account.id }),
      ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    });
  });

  describe('payout accounts', () => {
    const banks = (list: typeof BANKS | null = BANKS) => ({
      read: () => Promise.resolve(list),
      write: () => Promise.resolve(),
    });
    const accountDeps = (enqueueVerify = vi.fn(() => Promise.resolve())) => ({
      db: t.db(),
      crypto,
      banks: banks(),
      enqueueVerify,
      logger,
    });

    const adapter = (overrides: Partial<{ name: string; fail: Error }> = {}) => ({
      resolveAccountName: vi.fn(() =>
        overrides.fail
          ? Promise.reject(overrides.fail)
          : Promise.resolve({ accountName: overrides.name ?? 'ADA OKAFOR' }),
      ),
      createTransferRecipient: vi.fn(() =>
        Promise.resolve({ providerRecipientId: `RCP_${randomUUID().slice(0, 6)}` }),
      ),
    });
    const verifyDeps = (a = adapter(), match?: NameMatchVerdict) => ({
      db: t.db(),
      crypto,
      adapter: a,
      readNameMatch: vi.fn(() => Promise.resolve(match)),
      logger,
    });

    it('stores the number encrypted, masked and hashed, and queues its verification', async () => {
      const seller = randomUUID();
      const enqueue = vi.fn(() => Promise.resolve());
      const view = await addPayoutAccount(accountDeps(enqueue), {
        userId: seller,
        bankCode: '058',
        accountNumber: '0123 455 567',
      });
      expect(view).toMatchObject({
        status: 'PENDING_VERIFICATION',
        bankName: 'Guaranty Trust Bank',
        accountNumberMasked: '******5567',
        accountName: null,
        isDefault: false,
      });
      expect(JSON.stringify(view)).not.toContain('0123455567');
      expect(enqueue).toHaveBeenCalledWith(view.id);

      const { rows } = await t
        .owner()
        .query<{ account_number_enc: string }>(
          `SELECT account_number_enc FROM ledger.payout_accounts WHERE id = $1`,
          [view.id],
        );
      expect(rows[0]?.account_number_enc).not.toContain('0123455567');
      expect(crypto.encryption.decrypt(rows[0]!.account_number_enc)).toBe('0123455567');

      // The same account again is the same row.
      const again = await addPayoutAccount(accountDeps(), {
        userId: seller,
        bankCode: '058',
        accountNumber: '0123455567',
      });
      expect(again.id).toBe(view.id);
      expect((await listAccounts({ db: t.db() }, seller)).accounts).toHaveLength(1);
    });

    it('refuses a malformed number, an unknown bank, and an empty bank list', async () => {
      const seller = randomUUID();
      await expect(
        addPayoutAccount(accountDeps(), { userId: seller, bankCode: '058', accountNumber: '12345' }),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        addPayoutAccount(accountDeps(), { userId: seller, bankCode: '999', accountNumber: '0123455567' }),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        addPayoutAccount(
          { ...accountDeps(), banks: banks(null) },
          { userId: seller, bankCode: '058', accountNumber: '0123455567' },
        ),
      ).rejects.toMatchObject({ status: 503 });
    });

    it('verifies with the resolved name, makes the first one the default, and links the name-match', async () => {
      const seller = randomUUID();
      const first = await addPayoutAccount(accountDeps(), {
        userId: seller,
        bankCode: '058',
        accountNumber: '0123455567',
      });
      const second = await addPayoutAccount(accountDeps(), {
        userId: seller,
        bankCode: '044',
        accountNumber: '9876543210',
      });

      const a = adapter({ name: 'ADA OKAFOR' });
      const matchId = randomUUID();
      expect(await verifyPayoutAccount(verifyDeps(a, { id: matchId, matchResult: 'EXACT' }), first.id)).toBe(
        'VERIFIED',
      );
      expect(a.resolveAccountName).toHaveBeenCalledWith('0123455567', '058');
      expect(a.createTransferRecipient).toHaveBeenCalledWith({
        accountNumber: '0123455567',
        bankCode: '058',
        accountName: 'ADA OKAFOR',
      });
      expect(await verifyPayoutAccount(verifyDeps(), second.id)).toBe('VERIFIED');
      // A re-run is a no-op.
      expect(await verifyPayoutAccount(verifyDeps(a), first.id)).toBe('VERIFIED');
      expect(a.resolveAccountName).toHaveBeenCalledTimes(1);

      const { accounts } = await listAccounts({ db: t.db() }, seller);
      const byId = new Map(accounts.map((x) => [x.id, x]));
      expect(byId.get(first.id)).toMatchObject({
        status: 'VERIFIED',
        isDefault: true,
        accountName: 'ADA OKAFOR',
      });
      expect(byId.get(second.id)).toMatchObject({ status: 'VERIFIED', isDefault: false });
      const { rows } = await t
        .owner()
        .query<{ name_match_ref: string; name_match_result: string }>(
          `SELECT name_match_ref, name_match_result FROM ledger.payout_accounts WHERE id = $1`,
          [first.id],
        );
      expect(rows[0]).toEqual({ name_match_ref: matchId, name_match_result: 'EXACT' });

      expect(
        await setDefaultPayoutAccount({ db: t.db() }, { userId: seller, payoutAccountId: second.id }),
      ).toMatchObject({
        isDefault: true,
      });
      const after = new Map((await listAccounts({ db: t.db() }, seller)).accounts.map((x) => [x.id, x]));
      expect(after.get(first.id)?.isDefault).toBe(false);
    });

    it('fails an account the bank cannot find, and one whose name-match is a mismatch', async () => {
      const seller = randomUUID();
      const missing = await addPayoutAccount(accountDeps(), {
        userId: seller,
        bankCode: '058',
        accountNumber: '0123455567',
      });
      const mismatched = await addPayoutAccount(accountDeps(), {
        userId: seller,
        bankCode: '044',
        accountNumber: '9876543210',
      });

      expect(
        await verifyPayoutAccount(
          verifyDeps(adapter({ fail: new AccountNotResolvableError('058') })),
          missing.id,
        ),
      ).toBe('FAILED');
      const a = adapter();
      expect(
        await verifyPayoutAccount(
          verifyDeps(a, { id: randomUUID(), matchResult: 'MISMATCH' }),
          mismatched.id,
        ),
      ).toBe('FAILED');
      expect(a.createTransferRecipient).not.toHaveBeenCalled();

      const byId = new Map((await listAccounts({ db: t.db() }, seller)).accounts.map((x) => [x.id, x]));
      expect(byId.get(missing.id)).toMatchObject({
        status: 'FAILED',
        failureReason: ACCOUNT_NOT_FOUND_REASON,
      });
      expect(byId.get(mismatched.id)).toMatchObject({
        status: 'FAILED',
        failureReason: NAME_MISMATCH_REASON,
      });

      // An unverified account cannot be the default.
      await expect(
        setDefaultPayoutAccount({ db: t.db() }, { userId: seller, payoutAccountId: missing.id }),
      ).rejects.toMatchObject({ code: 'PAYOUT_ACCOUNT_REQUIRED' });
    });

    it('lets an outage propagate so the queue retries, leaving the account pending', async () => {
      const seller = randomUUID();
      const view = await addPayoutAccount(accountDeps(), {
        userId: seller,
        bankCode: '058',
        accountNumber: '0123455567',
      });
      const outage = new ApiError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'down');
      await expect(verifyPayoutAccount(verifyDeps(adapter({ fail: outage })), view.id)).rejects.toBe(outage);
      expect((await listAccounts({ db: t.db() }, seller)).accounts[0]?.status).toBe('PENDING_VERIFICATION');
    });

    it("never shows or touches another user's account", async () => {
      const seller = randomUUID();
      const account = await verifiedAccount(randomUUID());
      await expect(
        setDefaultPayoutAccount({ db: t.db() }, { userId: seller, payoutAccountId: account.id }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        removePayoutAccount({ db: t.db() }, { userId: seller, payoutAccountId: account.id }),
      ).rejects.toMatchObject({ status: 404 });
      expect((await listAccounts({ db: t.db() }, seller)).accounts).toEqual([]);
    });
  });
});
