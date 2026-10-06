// M20 §5 and D6: which of the five accounts a new upload goes to, how a sixth is registered, and the
// one invariant that makes rotation mean anything under concurrency. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import type { FilesConfig } from '../../../../src/config/env.js';
import { createDb } from '../../../../src/db/index.js';
import { outbox } from '../../../../src/db/platform-schema.js';
import { createLogger } from '../../../../src/platform/logger.js';
import {
  PoolExhaustedError,
  StorageAccountUnconfiguredError,
} from '../../../../src/modules/files/domain/errors.js';
import {
  DEFAULT_ACCOUNTS,
  applyUsage,
  findAccountById,
  listAccounts,
  registerAccount,
  seedStorageAccounts,
  selectAccountForPool,
} from '../../../../src/modules/files/services/account.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertStorageAccount } from '../support.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const credentials = { cloudName: 'demo', apiKey: '1234', apiSecret: 'not-a-real-secret' };

const filesConfig = (prefixes: readonly string[]): FilesConfig => ({
  accounts: Object.fromEntries(
    prefixes.map((prefix) => [prefix, { ...credentials, cloudName: `c-${prefix}` }]),
  ),
  maxUploadBytes: 1024,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
});

const ALL_FIVE = filesConfig(DEFAULT_ACCOUNTS.map((account) => account.prefix));

describe.runIf(infraEnabled)('account.service', () => {
  const t = useTestDatabase();

  /** Three trade accounts in rotation order, with credentials under the names the seed uses. */
  const threeTradeAccounts = async () => {
    for (const [index, prefix] of [
      'CLOUDINARY_TRADE_1',
      'CLOUDINARY_TRADE_2',
      'CLOUDINARY_TRADE_3',
    ].entries()) {
      await insertStorageAccount(t.app(), {
        label: `trade-${String(index + 1)}`,
        prefix,
        rotationOrder: index + 1,
      });
    }
  };

  const pick = async (files: FilesConfig = ALL_FIVE) =>
    createDb(t.app()).transaction(async (tx) => selectAccountForPool(tx, files, 'TRADE_ASSET'));

  describe('selection', () => {
    it('returns the single account for a non-rotating pool', async () => {
      await insertStorageAccount(t.app(), {
        pool: 'PROFILE',
        label: 'profile',
        prefix: 'CLOUDINARY_PROFILE',
        rotationOrder: null,
      });
      const chosen = await createDb(t.app()).transaction(async (tx) =>
        selectAccountForPool(tx, ALL_FIVE, 'PROFILE'),
      );
      expect(chosen.label).toBe('profile');
    });

    it('fails closed when a singleton pool’s only account is DISABLED', async () => {
      await insertStorageAccount(t.app(), {
        pool: 'CHAT_ATTACHMENT',
        label: 'chat',
        prefix: 'CLOUDINARY_CHAT',
        status: 'DISABLED',
        rotationOrder: null,
      });
      await expect(
        createDb(t.app()).transaction(async (tx) => selectAccountForPool(tx, ALL_FIVE, 'CHAT_ATTACHMENT')),
      ).rejects.toBeInstanceOf(PoolExhaustedError);
    });

    it('rotates round-robin across the three trade accounts and wraps', async () => {
      await threeTradeAccounts();
      const picked = [await pick(), await pick(), await pick(), await pick()];
      expect(picked.map((account) => account.label)).toEqual(['trade-1', 'trade-2', 'trade-3', 'trade-1']);
    });

    it('skips a NEAR_QUOTA account while an ACTIVE one exists', async () => {
      await threeTradeAccounts();
      await t.app().query(`UPDATE files.storage_accounts SET status = 'NEAR_QUOTA' WHERE label = 'trade-2'`);
      const picked = [await pick(), await pick(), await pick()];
      expect(picked.map((account) => account.label)).toEqual(['trade-1', 'trade-3', 'trade-1']);
    });

    it('uses a NEAR_QUOTA account when no ACTIVE one is left', async () => {
      // Still usable, just deprioritised — better than failing an upload outright while an account
      // with 12% of its credits left sits idle (§5 step 3).
      await threeTradeAccounts();
      await t.app().query(`UPDATE files.storage_accounts SET status = 'NEAR_QUOTA'`);
      await expect(pick()).resolves.toMatchObject({ status: 'NEAR_QUOTA' });
    });

    it('fails closed when every trade account is DISABLED', async () => {
      // Never a silent fallback to another pool or an unauthenticated path (D6 step 4).
      await threeTradeAccounts();
      await t.app().query(`UPDATE files.storage_accounts SET status = 'DISABLED'`);
      await expect(pick()).rejects.toBeInstanceOf(PoolExhaustedError);
    });

    it('ignores an account whose credentials are not in this environment', async () => {
      // storage_accounts rows travel between environments through the seed and the register
      // endpoint, so staging can hold a row only production has secrets for. Rotating onto it would
      // mint an upload ticket that cannot be signed.
      await threeTradeAccounts();
      const twoOfThree = filesConfig(['CLOUDINARY_TRADE_1', 'CLOUDINARY_TRADE_3']);
      const picked = [await pick(twoOfThree), await pick(twoOfThree), await pick(twoOfThree)];
      expect(picked.map((account) => account.label)).toEqual(['trade-1', 'trade-3', 'trade-1']);
    });

    it('serialises two concurrent selections through the cursor row', async () => {
      // Without FOR UPDATE on storage_pool_rotation both transactions read the same
      // last_account_id, both pick the same account, and the pool degenerates to "whichever is
      // next" under exactly the concurrency that makes rotation matter.
      await threeTradeAccounts();
      const [first, second] = await Promise.all([pick(), pick()]);
      expect(new Set([first.label, second.label]).size).toBe(2);
    });
  });

  describe('registration', () => {
    it('registers a sixth account and puts it at the end of the rotation', async () => {
      await threeTradeAccounts();
      const sixth = await registerAccount(createDb(t.app()), filesConfig(['CLOUDINARY_TRADE_4']), {
        pool: 'TRADE_ASSET',
        label: 'trade-4',
        cloudName: 'c-trade-4',
        credentialEnvPrefix: 'CLOUDINARY_TRADE_4',
      });
      expect(sixth.rotationOrder).toBe(4);
    });

    it('refuses a prefix with no credentials here', async () => {
      // Accepting one would insert a row rotation then silently filters out: the operator would see
      // their new account listed, see uploads still failing, and have nothing connecting the two.
      await expect(
        registerAccount(createDb(t.app()), filesConfig([]), {
          pool: 'TRADE_ASSET',
          label: 'trade-9',
          cloudName: 'c-trade-9',
          credentialEnvPrefix: 'CLOUDINARY_TRADE_9',
        }),
      ).rejects.toBeInstanceOf(StorageAccountUnconfiguredError);
    });

    it('refuses a second account in a singleton pool with a message naming D5', async () => {
      await insertStorageAccount(t.app(), {
        pool: 'PROFILE',
        label: 'profile',
        prefix: 'CLOUDINARY_PROFILE',
        rotationOrder: null,
      });
      await expect(
        registerAccount(createDb(t.app()), ALL_FIVE, {
          pool: 'PROFILE',
          label: 'profile-2',
          cloudName: 'c-profile-2',
          credentialEnvPrefix: 'CLOUDINARY_CHAT',
        }),
      ).rejects.toThrow(/single-account pool/);
    });
  });

  describe('seed', () => {
    it('registers the five default accounts from the configured prefixes', async () => {
      await seedStorageAccounts(createDb(t.app()), ALL_FIVE, logger);
      const accounts = await listAccounts(createDb(t.app()));
      expect(accounts.map((account) => account.label).sort()).toEqual([
        'chat',
        'profile',
        'trade-1',
        'trade-2',
        'trade-3',
      ]);
      expect(
        accounts.filter((account) => account.pool === 'TRADE_ASSET').map((a) => a.rotationOrder),
      ).toEqual([1, 2, 3]);
    });

    it('is idempotent, because several API pods start at once', async () => {
      await seedStorageAccounts(createDb(t.app()), ALL_FIVE, logger);
      await seedStorageAccounts(createDb(t.app()), ALL_FIVE, logger);
      expect(await listAccounts(createDb(t.app()))).toHaveLength(5);
    });

    it('skips a default account with no credentials rather than failing to boot', async () => {
      await seedStorageAccounts(createDb(t.app()), filesConfig(['CLOUDINARY_PROFILE']), logger);
      const accounts = await listAccounts(createDb(t.app()));
      expect(accounts.map((account) => account.label)).toEqual(['profile']);
    });
  });

  describe('applyUsage', () => {
    const outboxRows = async () => createDb(t.app()).select().from(outbox);

    it('writes the usage figures and the new status', async () => {
      const id = await insertStorageAccount(t.app(), { prefix: 'CLOUDINARY_TRADE_1', label: 'trade-1' });
      const account = await findAccountById(createDb(t.app()), id);
      await applyUsage(createDb(t.app()), {
        account: account!,
        usage: { storageUsedBytes: 4096, creditsUsedPct: 90 },
        thresholds: { nearPct: 85, disabledPct: 97 },
      });
      const updated = await findAccountById(createDb(t.app()), id);
      expect(updated).toMatchObject({
        status: 'NEAR_QUOTA',
        storageUsedBytes: 4096,
        creditsUsedPct: '90.00',
      });
    });

    it('publishes near_quota only on the transition', async () => {
      // One alert per crossing, rather than one an hour for as long as the account stays there.
      const id = await insertStorageAccount(t.app(), { prefix: 'CLOUDINARY_TRADE_1', label: 'trade-1' });
      const usage = { storageUsedBytes: 1, creditsUsedPct: 90 };
      const thresholds = { nearPct: 85, disabledPct: 97 };
      for (let i = 0; i < 2; i += 1) {
        const account = await findAccountById(createDb(t.app()), id);
        await applyUsage(createDb(t.app()), { account: account!, usage, thresholds });
      }
      const published = await outboxRows();
      expect(published.filter((row) => row.eventType === 'files.storage_account.near_quota')).toHaveLength(1);
    });

    it('publishes disabled when an account crosses the hard threshold', async () => {
      const id = await insertStorageAccount(t.app(), { prefix: 'CLOUDINARY_TRADE_1', label: 'trade-1' });
      const account = await findAccountById(createDb(t.app()), id);
      await applyUsage(createDb(t.app()), {
        account: account!,
        usage: { storageUsedBytes: 1, creditsUsedPct: 99 },
        thresholds: { nearPct: 85, disabledPct: 97 },
      });
      const published = await outboxRows();
      expect(published.map((row) => row.eventType)).toContain('files.storage_account.disabled');
    });

    it('publishes nothing when an account recovers quietly to ACTIVE', async () => {
      const id = await insertStorageAccount(t.app(), {
        prefix: 'CLOUDINARY_TRADE_1',
        label: 'trade-1',
        status: 'NEAR_QUOTA',
      });
      const account = await findAccountById(createDb(t.app()), id);
      const status = await applyUsage(createDb(t.app()), {
        account: account!,
        usage: { storageUsedBytes: 1, creditsUsedPct: 12 },
        thresholds: { nearPct: 85, disabledPct: 97 },
      });
      expect(status).toBe('ACTIVE');
      expect(await outboxRows()).toHaveLength(0);
    });
  });

  it('never exposes an api secret through listAccounts', async () => {
    await insertStorageAccount(t.app(), { prefix: 'CLOUDINARY_TRADE_1', label: 'trade-1' });
    const [account] = await listAccounts(createDb(t.app()));
    expect(JSON.stringify(account)).not.toContain('not-a-real-secret');
    expect(account).not.toHaveProperty('apiSecret');
    expect(account).not.toHaveProperty('apiKey');
  });
});
