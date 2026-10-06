import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import type { Bank } from '../../../src/modules/ledger/domain/providerAdapter.js';
import type { BankListCache } from '../../../src/modules/ledger/infrastructure/bankListCache.js';
import { createProviderRegistry } from '../../../src/modules/ledger/infrastructure/providerRegistry.js';
import { refreshBankList } from '../../../src/modules/ledger/jobs/refresh-bank-list.job.js';
import { paymentProviders } from '../../../src/modules/ledger/jobs/providers.js';
import { resolveAccountNameJob } from '../../../src/modules/ledger/jobs/resolve-account-name.job.js';
import { ApiError } from '../../../src/platform/errors.js';
import { createLogger } from '../../../src/platform/logger.js';
import { startStubServer, type StubServer } from '../../support/stub-server.js';
import { testRedisEnv, testRedisUrl } from '../../support/db-urls.js';

const logger = createLogger(
  loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
  }),
);

let stub: StubServer | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const fakeCache = (seed: Bank[] | null = null) => {
  let stored = seed;
  const cache: BankListCache = {
    read: () => Promise.resolve(stored),
    write: (banks) => {
      stored = banks;
      return Promise.resolve();
    },
  };
  return { cache, current: () => stored };
};

const serving = async (handler: (path: string, res: ServerResponse) => void) => {
  stub = await startStubServer((req, res) => handler(req.url ?? '', res));
  return paymentProviders({ logger, secretKey: 'sk_test_not_a_real_key', baseUrl: stub.url, backoffMs: 1 });
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('ledger.refresh-bank-list', () => {
  it('caches every bank the provider returns', async () => {
    const registry = await serving((_path, res) =>
      json(res, 200, {
        status: true,
        message: 'ok',
        data: [{ name: 'Access Bank', code: '044', active: true }],
        meta: { next: null },
      }),
    );
    const { cache, current } = fakeCache();

    await expect(refreshBankList({ registry, cache, logger })).resolves.toEqual({ banks: 1 });
    expect(current()).toEqual([{ name: 'Access Bank', code: '044' }]);
  });

  it('fails loudly and leaves the previous list in place when the provider is down', async () => {
    const registry = await serving((_path, res) => json(res, 500, { status: false, message: 'boom' }));
    const seeded = [{ name: 'Zenith Bank', code: '057' }];
    const { cache, current } = fakeCache(seeded);

    await expect(refreshBankList({ registry, cache, logger })).rejects.toBeInstanceOf(ApiError);
    // Yesterday's list beats no list; the job's failure is what the queue and the operator see.
    expect(current()).toEqual(seeded);
  });
});

describe('ledger.resolve-account-name', () => {
  it('resolves a name through the provider the job names', async () => {
    const registry = await serving((_path, res) =>
      json(res, 200, {
        status: true,
        message: 'ok',
        data: { account_number: '0123456789', account_name: 'ADA LOVELACE' },
      }),
    );

    await expect(
      resolveAccountNameJob(
        { registry, logger },
        { accountNumber: '0123456789', bankCode: '044', provider: 'PAYSTACK' },
      ),
    ).resolves.toEqual({ accountName: 'ADA LOVELACE' });
    expect(stub!.hits[0]!.path).toContain('account_number=0123456789');
  });

  it('refuses a provider with no adapter', async () => {
    const registry = createProviderRegistry({});

    await expect(
      resolveAccountNameJob(
        { registry, logger },
        { accountNumber: '0123456789', bankCode: '044', provider: 'PAYSTACK' },
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
