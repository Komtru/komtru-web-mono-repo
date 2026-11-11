// T-073's payout routes over HTTP, against a real database: status codes, bodies, problem codes, and
// isolation between users. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { createEncryption } from '../../../src/platform/crypto/encryption.js';
import { createHmacHasher } from '../../../src/platform/crypto/hmac.js';
import { errorHandler, notFound } from '../../../src/platform/errors.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { ANONYMOUS_ACTOR, type Actor } from '../../../src/platform/http/principal.js';
import { createLogger } from '../../../src/platform/logger.js';
import { postJournal } from '../../../src/modules/ledger/index.js';
import { payoutRoutes } from '../../../src/modules/ledger/http/payoutRoutes.js';
import { insertPayoutAccount } from '../../../src/modules/ledger/infrastructure/postgres/payoutsRepository.js';
import { testActor } from '../../support/actors.js';
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
const fee = () => ({ version: 'test-fee-schedule', currency: 'NGN', amountMinor: 0n });
const BANKS = [{ name: 'Guaranty Trust Bank', code: '058' }];

interface Page {
  items: { id: string }[];
  nextCursor: string | null;
}
const page = (res: { body: unknown }): Page => res.body as Page;
const idOf = (res: { body: unknown }): string => (res.body as { id: string }).id;

describe.runIf(infraEnabled)('the payout routes (T-073)', () => {
  const t = useTestDatabase();

  const appFor = (actor: Actor, banks: typeof BANKS | null = BANKS) => {
    const cache = { read: () => Promise.resolve(banks), write: () => Promise.resolve() };
    const enqueueVerify = vi.fn(() => Promise.resolve());
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(
      payoutRoutes(() => ({
        banks: cache,
        accounts: { db: t.db(), crypto, banks: cache, enqueueVerify, logger },
        payouts: { db: t.db(), logger, fee },
      })),
      {
        logger,
        resolveActor: () => Promise.resolve(actor),
        rateLimit: () => Promise.resolve(),
        idempotency: (_input, run) => run(),
      },
    )(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(logger, () => undefined));
    return { app, enqueueVerify };
  };

  const seller = async (balance = 0n) => {
    const userId = randomUUID();
    if (balance > 0n) {
      await t.db().transaction((tx) =>
        postJournal(tx, {
          idempotencyKey: `test:release:${randomUUID()}`,
          description: 'test release',
          lines: [
            { account: { type: 'PLATFORM_ESCROW_POOL' }, direction: 'DEBIT', amountMinor: balance },
            {
              account: { type: 'USER_PAYABLE', ownerUserId: userId },
              direction: 'CREDIT',
              amountMinor: balance,
            },
          ],
        }),
      );
    }
    return { userId, ...appFor(testActor(userId)) };
  };

  const verify = (userId: string) =>
    insertPayoutAccount(t.db(), {
      userId,
      provider: 'PAYSTACK',
      bankCode: '058',
      accountNumberEnc: 'v1:test',
      accountNumberMasked: '******5567',
      accountNumberHash: Buffer.from(randomUUID()),
      status: 'VERIFIED',
      accountName: 'ADA OKAFOR',
      providerRecipientId: 'RCP_test',
      verifiedAt: new Date(),
      isDefault: true,
    });

  it('answers 401 without a session', async () => {
    const { app } = appFor(ANONYMOUS_ACTOR);
    for (const path of ['/v1/me/payouts', '/v1/me/payout-accounts', '/v1/me/payouts/summary']) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
  });

  it('lists the cached banks, and says so when there are none yet', async () => {
    const { app } = await seller();
    expect((await request(app).get('/v1/payouts/banks')).body).toEqual({ banks: BANKS });
    const empty = appFor(testActor(randomUUID()), null).app;
    expect((await request(empty).get('/v1/payouts/banks')).status).toBe(503);
  });

  it('adds an account (202), masked, and never echoes the number', async () => {
    const { app, enqueueVerify } = await seller();
    const res = await request(app)
      .post('/v1/me/payout-accounts')
      .send({ bankCode: '058', accountNumber: '0123455567' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'PENDING_VERIFICATION', accountNumberMasked: '******5567' });
    expect(JSON.stringify(res.body)).not.toContain('0123455567');
    expect(enqueueVerify).toHaveBeenCalledWith(idOf(res));

    const list = await request(app).get('/v1/me/payout-accounts');
    expect((list.body as { accounts: unknown[] }).accounts).toHaveLength(1);
  });

  it('refuses an automatic mode without a verified account with the code AB6 branches on', async () => {
    const { userId, app } = await seller();
    const refused = await request(app).put('/v1/me/payout-preferences').send({ mode: 'AUTO_DAILY' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'PAYOUT_ACCOUNT_REQUIRED' });

    await verify(userId);
    const ok = await request(app).put('/v1/me/payout-preferences').send({ mode: 'AUTO_DAILY' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      mode: 'AUTO_DAILY',
      defaultAccount: { accountNumberMasked: '******5567' },
    });
    expect((await request(app).put('/v1/me/payout-preferences').send({ mode: 'HOURLY' })).status).toBe(422);
  });

  it('withdraws (201), lists the history a page at a time, and shows one receipt', async () => {
    const { userId, app } = await seller(100_000n);
    await verify(userId);

    const tooMuch = await request(app).post('/v1/me/payouts').send({ amountMinor: '100001' });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    // Money is a digit string, never a JSON number.
    expect((await request(app).post('/v1/me/payouts').send({ amountMinor: 1000 })).status).toBe(422);

    const ids: string[] = [];
    for (const amount of ['10000', '20000', '30000']) {
      const res = await request(app).post('/v1/me/payouts').send({ amountMinor: amount });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REQUESTED', amountMinor: amount, trigger: 'MANUAL' });
      ids.push(idOf(res));
    }

    const firstRes = await request(app).get('/v1/me/payouts?limit=2');
    expect(firstRes.status).toBe(200);
    const first = page(firstRes);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = page(await request(app).get(`/v1/me/payouts?limit=2&cursor=${String(first.nextCursor)}`));
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((p) => p.id);
    expect(seen.sort()).toEqual([...ids].sort());

    const receipt = await request(app).get(`/v1/me/payouts/${ids[0]!}`);
    expect(receipt.body).toMatchObject({
      id: ids[0],
      reference: `payout-${ids[0]!}`,
      destination: { bankCode: '058', accountName: 'ADA OKAFOR' },
    });

    const summary = await request(app).get('/v1/me/payouts/summary');
    expect(summary.body).toMatchObject({
      availableMinor: '40000',
      inFlightMinor: '60000',
      payoutFeeMinor: '0',
    });

    // Somebody else's payout is not found, not forbidden.
    const other = await seller();
    expect((await request(other.app).get(`/v1/me/payouts/${ids[0]!}`)).status).toBe(404);
    expect(page(await request(other.app).get('/v1/me/payouts')).items).toEqual([]);
  });
});
