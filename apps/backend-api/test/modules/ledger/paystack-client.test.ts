import { ChargeNotFoundError } from '../../../src/modules/ledger/domain/funding.js';
import {
  AccountNotResolvableError,
  TransferNotFoundError,
} from '../../../src/modules/ledger/domain/payouts.js';
import { createHmac } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPaystackAdapter,
  listBanks,
  MAX_BANK_PAGES,
  verifyCharge,
  verifyRefund,
  verifyTransfer,
  type PaystackClientOptions,
} from '../../../src/modules/ledger/infrastructure/providers/paystack/client.js';
import { ApiError } from '../../../src/platform/errors.js';
import { RefundNotFoundError } from '../../../src/modules/ledger/domain/refunds.js';
import { createLogger } from '../../../src/platform/logger.js';
import { loadConfig } from '../../../src/config/env.js';
import { FORBIDDEN } from '../../support/forbidden-primitives.js';
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

const SECRET = 'sk_test_not_a_real_key';

let stub: StubServer | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({
  status: true,
  message: 'ok',
  data,
  ...extra,
});

/** Starts the stub and returns options pointed at it. */
const serving = async (
  handler: (path: string, res: ServerResponse, hit: number) => void,
  // `null` rather than `undefined`: a default parameter would swallow `undefined` and hand the
  // "fails closed" case a live key.
  secretKey: string | null = SECRET,
): Promise<PaystackClientOptions> => {
  stub = await startStubServer((req, res, hit) => handler(req.url ?? '', res, hit));
  return { logger, baseUrl: stub.url, ...(secretKey === null ? {} : { secretKey }) };
};

const BANK_PAGE_ONE = [
  { name: 'Access Bank', code: '044', active: true },
  { name: 'Defunct Bank', code: '999', active: false },
  { name: 'Deleted Bank', code: '998', active: true, is_deleted: true },
  // Offering a bank that cannot receive a transfer only moves the failure to the payout.
  { name: 'Collections Only Bank', code: '997', active: true, supports_transfer: false },
];
const BANK_PAGE_TWO = [{ name: 'Zenith Bank', code: '057', active: true }];

describe('the paystack client', () => {
  it('initializes a charge with our reference and nothing Paystack would auto-settle', async () => {
    const options = await serving((_path, res) =>
      json(
        res,
        200,
        ok({
          authorization_url: 'https://checkout.paystack.com/abc123',
          access_code: 'abc123',
          reference: 'trade_fund_1',
        }),
      ),
    );

    const result = await createPaystackAdapter(options).initializeCharge({
      amountMinor: 15_225_000,
      currency: 'NGN',
      reference: 'trade_fund_1',
      customerEmail: 'buyer@example.test',
      metadata: { tradeId: 't1' },
    });

    expect(result).toEqual({
      providerReference: 'trade_fund_1',
      checkoutUrl: 'https://checkout.paystack.com/abc123',
    });
    const hit = stub!.hits[0]!;
    expect(hit.method).toBe('POST');
    expect(hit.path).toBe('/transaction/initialize');
    expect(hit.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(hit.body)).toEqual({
      email: 'buyer@example.test',
      amount: 15_225_000,
      currency: 'NGN',
      reference: 'trade_fund_1',
      metadata: { tradeId: 't1' },
    });
    // m8 §1/§9: none of these may ever appear on a charge; the first two auto-settle escrowed money,
    // and the last two reroute the fee that implies them. Assembled so the repository guard stays clean.
    for (const forbidden of [FORBIDDEN.sub, `${FORBIDDEN.split}_code`, 'bearer', 'transaction_charge']) {
      expect(hit.body).not.toContain(forbidden);
    }
  });

  it('follows the bank list across pages and drops banks a seller cannot be paid into', async () => {
    const options = await serving((path, res) => {
      // Paystack only returns a cursor when the request asked for one; a stub that hands out `next`
      // unconditionally would hide exactly the bug this test exists to catch.
      if (!path.includes('use_cursor=true')) return json(res, 200, ok(BANK_PAGE_ONE, { meta: {} }));
      if (path.includes('next=cursor2')) return json(res, 200, ok(BANK_PAGE_TWO, { meta: { next: null } }));
      return json(res, 200, ok(BANK_PAGE_ONE, { meta: { next: 'cursor2' } }));
    });

    // The cannibalized client read page one only, so the bank list was silently truncated.
    await expect(createPaystackAdapter(options).listBanks()).resolves.toEqual([
      { name: 'Access Bank', code: '044' },
      { name: 'Zenith Bank', code: '057' },
    ]);
    expect(stub!.hits).toHaveLength(2);
    expect(stub!.hits[0]!.path).toContain('use_cursor=true');
    expect(stub!.hits[1]!.path).toContain('next=cursor2');
  });

  it('stops when the provider repeats a cursor instead of fetching the same page forever', async () => {
    const options = await serving((_path, res) => json(res, 200, ok(BANK_PAGE_TWO, { meta: { next: 'c' } })));

    await expect(createPaystackAdapter(options).listBanks()).resolves.toHaveLength(2);
    expect(stub!.hits).toHaveLength(2);
  });

  it('stops paging at the cap when a provider never stops offering a new cursor', async () => {
    const options = await serving((_path, res, hit) =>
      json(res, 200, ok(BANK_PAGE_TWO, { meta: { next: `cursor${hit + 2}` } })),
    );

    await createPaystackAdapter(options).listBanks();

    expect(stub!.hits).toHaveLength(MAX_BANK_PAGES);
  });

  it('resolves an account name, sending the account details in the query', async () => {
    const options = await serving((_path, res) =>
      json(res, 200, ok({ account_number: '0123456789', account_name: 'ADA LOVELACE' })),
    );

    await expect(createPaystackAdapter(options).resolveAccountName('0123456789', '044')).resolves.toEqual({
      accountName: 'ADA LOVELACE',
    });
    expect(stub!.hits[0]!.path).toBe('/bank/resolve?account_number=0123456789&bank_code=044');
  });

  it.each([
    ['a 422', 422],
    ['a 400', 400],
    ['a refusal on a 200', 200],
  ])('reads "could not resolve account name" on %s as an unresolvable account', async (_n, code) => {
    const options = await serving((_path, res) =>
      json(res, code, {
        status: false,
        message: 'Could not resolve account name. Check parameters or try again.',
      }),
    );
    await expect(
      createPaystackAdapter(options).resolveAccountName('0123456789', '044'),
    ).rejects.toBeInstanceOf(AccountNotResolvableError);
  });

  it.each([
    ['any other 422', 422, { status: false, message: 'Unknown bank code' }],
    ['any other 400', 400, { status: false, message: 'Invalid key' }],
    ['a bare refusal on a 200', 200, { status: false }],
    ['a 500', 500, { status: false, message: 'boom' }],
  ])(
    'reads %s on bank resolve as a failure to retry, not a verdict on the account',
    async (_n, code, body) => {
      const options = await serving((_path, res) => json(res, code, body));
      const error = await createPaystackAdapter(options)
        .resolveAccountName('0123456789', '044')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).not.toBeInstanceOf(AccountNotResolvableError);
    },
  );

  it('creates a nuban transfer recipient from the resolved name', async () => {
    const options = await serving((_path, res) => json(res, 200, ok({ recipient_code: 'RCP_1' })));

    await expect(
      createPaystackAdapter(options).createTransferRecipient({
        accountNumber: '0123456789',
        bankCode: '044',
        accountName: 'ADA LOVELACE',
      }),
    ).resolves.toEqual({ providerRecipientId: 'RCP_1' });
    expect(JSON.parse(stub!.hits[0]!.body)).toEqual({
      type: 'nuban',
      name: 'ADA LOVELACE',
      account_number: '0123456789',
      bank_code: '044',
      currency: 'NGN',
    });
  });

  it.each([
    ['success', 'success'],
    ['failed', 'failed'],
    ['reversed', 'failed'],
    ['otp', 'pending'],
    ['pending', 'pending'],
    ['something-new', 'pending'],
  ])('maps the transfer status %s to %s', async (provider, expected) => {
    const options = await serving((_path, res) =>
      json(res, 200, ok({ transfer_code: 'TRF_1', status: provider })),
    );

    await expect(
      createPaystackAdapter(options).initiateTransfer({
        providerRecipientId: 'RCP_1',
        amountMinor: 9_000_000,
        reference: 'payout_1',
        reason: 'withdrawal',
      }),
    ).resolves.toEqual({ providerTransferId: 'TRF_1', status: expected });
    expect(JSON.parse(stub!.hits[0]!.body)).toMatchObject({ source: 'balance', amount: 9_000_000 });
  });

  it.each([
    ['pending', 'pending'],
    ['processing', 'processing'],
    ['processed', 'processed'],
    ['failed', 'failed'],
    ['anything-else', 'pending'],
  ])('maps the refund status %s to %s', async (provider, expected) => {
    const options = await serving((_path, res) => json(res, 200, ok({ id: 88129, status: provider })));

    await expect(
      createPaystackAdapter(options).initiateRefund({
        chargeProviderReference: 'trade_fund_1',
        amountMinor: 5_000_000,
        reference: 'refund_1',
        reason: 'dispute resolved',
      }),
    ).resolves.toEqual({ providerRefundId: '88129', status: expected });
    expect(JSON.parse(stub!.hits[0]!.body)).toMatchObject({
      transaction: 'trade_fund_1',
      amount: 5_000_000,
    });
  });

  it('verifies a charge for the webhook re-check', async () => {
    const options = await serving((_path, res) =>
      json(
        res,
        200,
        ok({
          reference: 'trade_fund_1',
          status: 'success',
          amount: 15_225_000,
          currency: 'NGN',
          paid_at: '2026-10-04T11:21:43.000Z',
        }),
      ),
    );

    await expect(verifyCharge(options, 'trade fund/1')).resolves.toEqual({
      reference: 'trade_fund_1',
      status: 'success',
      amountMinor: 15_225_000,
      currency: 'NGN',
      paidAt: '2026-10-04T11:21:43.000Z',
    });
    expect(stub!.hits[0]!.path).toBe('/transaction/verify/trade%20fund%2F1');
  });

  it('reports a reference Paystack does not know as ChargeNotFoundError, not as an outage', async () => {
    const options = await serving((_path, res) =>
      json(res, 400, { status: false, message: 'Transaction reference not found' }),
    );
    await expect(verifyCharge(options, 'fund-x')).rejects.toBeInstanceOf(ChargeNotFoundError);
  });

  it('still reports any other verify refusal as the provider being unavailable', async () => {
    const options = await serving((_path, res) => json(res, 400, { status: false, message: 'Invalid key' }));
    const error = await verifyCharge(options, 'fund-x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(ChargeNotFoundError);
  });

  it('verifies a transfer by OUR reference, reading the amount, currency and status (T-073)', async () => {
    const options = await serving((_path, res) =>
      json(
        res,
        200,
        ok({
          reference: 'payout-1',
          status: 'success',
          amount: 4_520_000,
          currency: 'NGN',
          transfer_code: 'TRF_abc',
          reason: 'Komtru payout',
        }),
      ),
    );
    await expect(verifyTransfer(options, 'payout-1')).resolves.toEqual({
      reference: 'payout-1',
      status: 'success',
      amountMinor: 4_520_000,
      currency: 'NGN',
      providerTransferId: 'TRF_abc',
    });
    expect(stub!.hits[0]!.path).toBe('/transfer/verify/payout-1');
    expect(stub!.hits[0]!.method).toBe('GET');
  });

  it('reports a transfer Paystack never received as TransferNotFoundError, which is what makes a retry safe', async () => {
    const options = await serving((_path, res) =>
      json(res, 404, { status: false, message: 'Transfer not found' }),
    );
    await expect(verifyTransfer(options, 'payout-x')).rejects.toBeInstanceOf(TransferNotFoundError);
    await stub?.close();
    const other = await serving((_path, res) => json(res, 400, { status: false, message: 'Invalid key' }));
    const error = await verifyTransfer(other, 'payout-x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(TransferNotFoundError);
  });

  it('fetches a refund by its provider id, reading the amount, currency and status (T-075)', async () => {
    const options = await serving((_path, res) =>
      json(
        res,
        200,
        ok({ id: 3018284, transaction: 1641, amount: 45_675_000, currency: 'NGN', status: 'processed' }),
      ),
    );
    await expect(verifyRefund(options, '3018284')).resolves.toEqual({
      providerRefundId: '3018284',
      status: 'processed',
      amountMinor: 45_675_000,
      currency: 'NGN',
    });
    expect(stub!.hits[0]!.path).toBe('/refund/3018284');
    expect(stub!.hits[0]!.method).toBe('GET');
  });

  it('reports a refund Paystack has no record of as RefundNotFoundError', async () => {
    const options = await serving((_path, res) =>
      json(res, 404, { status: false, message: 'Refund not found' }),
    );
    await expect(verifyRefund(options, '1')).rejects.toBeInstanceOf(RefundNotFoundError);
  });

  it('refuses a refund response with no amount, rather than resolving from it', async () => {
    const options = await serving((_path, res) =>
      json(res, 200, ok({ id: 1, currency: 'NGN', status: 'processed' })),
    );
    const error = await verifyRefund(options, '1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toContain('amount');
  });

  it('refuses a transfer verify response with no amount, rather than settling from it', async () => {
    const options = await serving((_path, res) =>
      json(
        res,
        200,
        ok({ reference: 'payout-1', status: 'success', currency: 'NGN', transfer_code: 'TRF_1' }),
      ),
    );
    const error = await verifyTransfer(options, 'payout-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toContain('amount');
  });

  it('treats a 200 carrying a failed envelope as an error, without echoing the key', async () => {
    const options = await serving((_path, res) => json(res, 200, { status: false, message: 'Invalid key' }));

    const error = await createPaystackAdapter(options)
      .listBanks()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    // `message` is non-enumerable, so JSON.stringify alone would not see it.
    expect((error as ApiError).message).not.toContain(SECRET);
    expect((error as ApiError).detail ?? '').not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });

  it('refuses a verify response that is missing or mistyped, rather than crediting from it', async () => {
    // charge.verify is the one call T-072 trusts before touching the ledger; a cast here would let an
    // undefined amount reach a journal entry.
    const options = await serving((_path, res) =>
      json(res, 200, ok({ reference: 'trade_fund_1', status: 'success', paid_at: null })),
    );

    const error = await verifyCharge(options, 'trade_fund_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toContain('amount');
  });

  it.each([
    ['an initialize with no checkout url', '/transaction/initialize', { access_code: 'a', reference: 'r' }],
    ['a resolve with no account name', '/bank/resolve', { account_number: '0123456789' }],
    ['a recipient with no code', '/transferrecipient', { id: 1 }],
    ['a transfer with no code', '/transfer', { status: 'success' }],
    ['a refund with no id', '/refund', { status: 'processed' }],
    ['a bank list that is not a list', '/bank', { banks: [] }],
  ])('refuses %s', async (_name, path, body) => {
    const options = await serving((_p, res) => json(res, 200, ok(body)));
    const adapter = createPaystackAdapter(options);
    const callFor: Record<string, () => Promise<unknown>> = {
      '/transaction/initialize': () =>
        adapter.initializeCharge({
          amountMinor: 1,
          currency: 'NGN',
          reference: 'r',
          customerEmail: 'a@b.test',
        }),
      '/bank/resolve': () => adapter.resolveAccountName('0123456789', '044'),
      '/transferrecipient': () =>
        adapter.createTransferRecipient({ accountNumber: '0', bankCode: '0', accountName: 'A' }),
      '/transfer': () =>
        adapter.initiateTransfer({ providerRecipientId: 'R', amountMinor: 1, reference: 'r' }),
      '/refund': () =>
        adapter.initiateRefund({ chargeProviderReference: 'c', amountMinor: 1, reference: 'r' }),
      '/bank': () => adapter.listBanks(),
    };

    await expect(callFor[path]!()).rejects.toBeInstanceOf(ApiError);
  });

  it('treats a 2xx with no data as an error', async () => {
    const options = await serving((_path, res) => json(res, 200, { status: true, message: 'ok' }));

    await expect(createPaystackAdapter(options).listBanks()).rejects.toBeInstanceOf(ApiError);
  });

  it('never retries a transfer, and does retry a bank list', async () => {
    const options = await serving((_path, res) => json(res, 500, { status: false, message: 'boom' }));
    const adapter = createPaystackAdapter({ ...options, backoffMs: 1 });

    await expect(
      adapter.initiateTransfer({ providerRecipientId: 'RCP_1', amountMinor: 1, reference: 'payout_1' }),
    ).rejects.toBeInstanceOf(ApiError);
    // A POST that may already have moved money is sent exactly once.
    expect(stub!.hits).toHaveLength(1);

    await expect(adapter.listBanks()).rejects.toBeInstanceOf(ApiError);
    expect(stub!.hits.length).toBeGreaterThan(2);
  });

  it('gives up on a provider that sends headers and then stalls', async () => {
    const options = await serving((_path, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"status":true,');
      // never ends
    });

    await expect(
      createPaystackAdapter({ ...options, timeoutMs: 60, maxAttempts: 1 }).listBanks(),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('fails closed, and silently, when there is no secret key', async () => {
    const options = await serving((_path, res) => json(res, 200, ok([])), null);
    const adapter = createPaystackAdapter(options);

    // Caught as they are created: an unattached rejection would be an unhandled rejection warning.
    const calls: Promise<unknown>[] = [
      adapter.initializeCharge({
        amountMinor: 1,
        currency: 'NGN',
        reference: 'r',
        customerEmail: 'a@b.test',
      }),
      adapter.resolveAccountName('0123456789', '044'),
      adapter.createTransferRecipient({ accountNumber: '0', bankCode: '0', accountName: 'A' }),
      adapter.initiateTransfer({ providerRecipientId: 'R', amountMinor: 1, reference: 'r' }),
      adapter.initiateRefund({ chargeProviderReference: 'c', amountMinor: 1, reference: 'r' }),
      adapter.listBanks(),
      verifyCharge(options, 'r'),
    ].map((call) => call.catch((error: unknown) => error));

    for (const call of calls) {
      const error = await call;
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(503);
      expect((error as ApiError).code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    }
    expect(stub!.hits).toHaveLength(0);
  });

  it('lets one of our own bugs through instead of calling it a provider outage', async () => {
    const options = await serving((_path, res) => json(res, 200, ok([])));
    const broken = {
      ...options,
      // A logger that throws stands in for any bug in our own code inside the call path.
      logger: {
        ...options.logger,
        info: () => {
          throw new TypeError('not a provider failure');
        },
      } as typeof options.logger,
    };

    await expect(listBanks(broken)).rejects.toBeInstanceOf(TypeError);
  });

  it('exposes the pure webhook functions through the adapter', async () => {
    const options = await serving((_path, res) => json(res, 200, ok([])));
    const adapter = createPaystackAdapter(options);
    const body = Buffer.from('{"event":"transfer.reversed","data":{"reference":"p1","transfer_code":"T1"}}');
    const signature = createHmac('sha512', SECRET).update(body).digest('hex');

    expect(adapter.code).toBe('PAYSTACK');
    expect(adapter.verifyWebhookSignature(body, signature)).toBe(true);
    expect(adapter.verifyWebhookSignature(body, 'nope')).toBe(false);
    expect(adapter.parseWebhookEvent(body)).toEqual({
      type: 'transfer.reversed',
      reference: 'p1',
      providerTransferId: 'T1',
    });
  });
});
