// T-072 end to end against a real Postgres: a buyer starts a checkout, Paystack's webhook lands, the
// verify answer is settled, and the trade's escrow is funded exactly once however many times any of
// that is repeated or raced. No Paystack is called: the verify answer is supplied by the test.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { createHmac, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import type { Actor } from '../../../src/platform/http/principal.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { createLogger } from '../../../src/platform/logger.js';
import {
  accountBalance,
  ChargeNotFoundError,
  fundingReference,
  MAX_ATTEMPTS_PER_TRADE,
  type VerifiedChargeView,
} from '../../../src/modules/ledger/index.js';
import { paymentRoutes } from '../../../src/modules/ledger/http/routes.js';
import { webhookRoutes } from '../../../src/modules/ledger/http/webhookRoutes.js';
import { verifyPaystackSignature } from '../../../src/modules/ledger/infrastructure/providers/paystack/signature.js';
import { parsePaystackEvent } from '../../../src/modules/ledger/infrastructure/providers/paystack/events.js';
import {
  confirmFunding,
  initiateFunding,
  paymentStatus,
  type ChargeDeps,
} from '../../../src/modules/ledger/services/charge.service.js';
import {
  ChargeStillPendingError,
  processDelivery,
  recordWebhook,
  settleCharge,
  type RecordWebhookDeps,
} from '../../../src/modules/ledger/services/webhookIngest.service.js';
import {
  processPaymentWebhookJob,
  SWEEP_MAX_COUNT,
  sweepPaymentWebhooks,
  verifyChargeJob,
} from '../../../src/modules/ledger/jobs/funding.job.js';
import { ApiError } from '../../../src/platform/errors.js';
import { testActor } from '../../support/actors.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { driveTo, insertTrade, insertUser, transition } from '../trades/support.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
});
const logger = createLogger(config);

/** A throwaway test secret, generated per run: nothing here is a real Paystack credential. */
const SECRET = `test_${randomUUID()}`;
const PUBLIC_KEY = `pk_test_${randomUUID()}`;
const ITEM = 45_000_000n;
const FEE = 675_000n;
const TOTAL = ITEM + FEE;

const sign = (body: Buffer) => createHmac('sha512', SECRET).update(body).digest('hex');

describe.runIf(infraEnabled)('funding a trade (T-072)', () => {
  const t = useTestDatabase();

  let buyer: string;
  let seller: string;
  let tradeId: string;
  let tradeCode: string;
  let verifies: string[];
  let deliveries: bigint[];

  const chargeDeps = (overrides: Partial<ChargeDeps> = {}): ChargeDeps => ({
    db: t.db(),
    publicKey: PUBLIC_KEY,
    logger,
    enqueueVerify: (reference) => {
      verifies.push(reference);
      return Promise.resolve();
    },
    ...overrides,
  });

  const webhookDeps = (): RecordWebhookDeps => ({
    db: t.db(),
    adapter: {
      code: 'PAYSTACK',
      verifyWebhookSignature: (raw, header) => verifyPaystackSignature(SECRET, raw, header),
    },
    logger,
    enqueueDelivery: (id) => {
      deliveries.push(id);
      return Promise.resolve();
    },
  });

  const success = (reference: string, overrides: Partial<VerifiedChargeView> = {}): VerifiedChargeView => ({
    reference,
    status: 'success',
    amountMinor: Number(TOTAL),
    currency: 'NGN',
    ...overrides,
  });

  const processDeps = (answer: (reference: string) => VerifiedChargeView) => ({
    db: t.db(),
    logger,
    verify: (reference: string) => Promise.resolve(answer(reference)),
    parse: parsePaystackEvent,
  });

  const chargeEvent = (reference: string, id = Math.floor(Math.random() * 1e9)) =>
    Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: {
          id,
          reference,
          status: 'success',
          amount: Number(TOTAL),
          paid_at: '2026-11-07T10:14:00.000Z',
        },
      }),
    );

  const count = async (sql: string, params: unknown[] = []) => {
    const { rows } = await t.app().query<{ n: string }>(sql, params);
    return Number(rows[0]?.n ?? 0);
  };
  const outbox = (type: string) =>
    count(`SELECT count(*) AS n FROM platform.outbox WHERE event_type = $1`, [type]);
  const journals = () => count(`SELECT count(*) AS n FROM ledger.ledger_journal_entries`);
  const attemptRow = async (reference: string) => {
    const { rows } = await t
      .app()
      .query<{ status: string; last_provider_status: string | null; journal_entry_id: string | null }>(
        `SELECT status, last_provider_status, journal_entry_id FROM ledger.payment_attempts WHERE reference = $1`,
        [reference],
      );
    return rows[0];
  };

  /** Charge deps whose clock reads `minutes` from now: what the grace rules are tested with. */
  const later = (minutes: number, overrides: Partial<ChargeDeps> = {}) =>
    chargeDeps({ now: () => new Date(Date.now() + minutes * 60_000), ...overrides });
  const restart = (minutes: number) =>
    initiateFunding(later(minutes), { userId: buyer, trade: { tradeCode }, restart: true });

  const start = async () =>
    (await initiateFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } })).attempt;

  beforeEach(async () => {
    verifies = [];
    deliveries = [];
    buyer = await insertUser(t.app(), { verification_level: 'CONTACT_VERIFIED' });
    seller = await insertUser(t.app(), { verification_level: 'IDENTITY_VERIFIED' });
    const { rows } = await t.app().query<{ id: string }>(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
       VALUES ($1, 'buyer@example.com', 'buyer@example.com', true, now()) RETURNING id`,
      [buyer],
    );
    await t
      .app()
      .query(`UPDATE identity.users SET primary_email_id = $2 WHERE id = $1`, [buyer, rows[0]?.id]);
    tradeId = await insertTrade(t.app(), { buyer, seller });
    await driveTo(t.app(), tradeId, 'PENDING_PAYMENT');
    const code = await t
      .app()
      .query<{ trade_code: string }>(`SELECT trade_code FROM trade.trades WHERE id = $1`, [tradeId]);
    tradeCode = code.rows[0]?.trade_code ?? '';
  });

  describe('initiating', () => {
    it('creates one attempt for the snapshot total and returns what Inline needs', async () => {
      const result = await initiateFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } });

      expect(result.attempt.reference).toBe(fundingReference(result.attempt.id));
      expect(result.attempt).toMatchObject({
        status: 'INITIATED',
        displayState: 'AWAITING_PAYMENT',
        amountMinor: TOTAL.toString(),
        itemAmountMinor: ITEM.toString(),
        buyerProtectionFeeMinor: FEE.toString(),
        currency: 'NGN',
      });
      expect(result.inline).toEqual({
        key: PUBLIC_KEY,
        email: 'buyer@example.com',
        amount: Number(TOTAL),
        currency: 'NGN',
        reference: result.attempt.reference,
        channels: ['card', 'ussd', 'bank_transfer'],
      });
    });

    it('returns the same attempt on a repeat, by code or by id, and races to one row', async () => {
      const [a, b] = await Promise.all([start(), start()]);
      const c = (await initiateFunding(chargeDeps(), { userId: buyer, trade: { tradeId } })).attempt;
      expect(new Set([a.id, b.id, c.id]).size).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM ledger.payment_attempts`)).toBe(1);
    });

    it('starts over only when asked, and only once the provider-unseen grace has passed', async () => {
      const first = await start();
      // Fresh and never seen by the provider: the buyer may still be paying on it.
      await expect(restart(5)).rejects.toMatchObject({ status: 409 });
      const second = (await restart(31)).attempt;
      expect(second.id).not.toBe(first.id);
      expect((await attemptRow(first.reference))?.status).toBe('ABANDONED');
    });

    it('starts over at once when the provider says the checkout was abandoned', async () => {
      const first = await start();
      await settleCharge(
        { db: t.db(), logger },
        first.reference,
        success(first.reference, { status: 'abandoned' }),
      );
      // ...but not within the minimum interval between two checkouts.
      await expect(restart(0)).rejects.toMatchObject({ status: 429 });
      expect((await restart(2)).attempt.id).not.toBe(first.id);
    });

    it('waits out the short grace after a declined card', async () => {
      const first = await start();
      await settleCharge(
        { db: t.db(), logger },
        first.reference,
        success(first.reference, { status: 'failed' }),
      );
      await expect(restart(5)).rejects.toMatchObject({ status: 409 });
      expect((await restart(11)).attempt.id).not.toBe(first.id);
    });

    it('caps checkouts per trade', async () => {
      await start();
      let minutes = 0;
      for (let i = 1; i < MAX_ATTEMPTS_PER_TRADE; i++) {
        minutes += 31;
        await restart(minutes);
      }
      expect(await count(`SELECT count(*) AS n FROM ledger.payment_attempts`)).toBe(MAX_ATTEMPTS_PER_TRADE);
      await expect(restart(minutes + 31)).rejects.toMatchObject({ status: 409 });
    });

    it('asks Inline for the attempt’s own amount, and replaces an attempt that no longer matches', async () => {
      // An open attempt minted under an older snapshot, as a backfill or a bug might leave one.
      const stale = randomUUID();
      await t.owner().query(
        `INSERT INTO ledger.payment_attempts (id, trade_id, buyer_user_id, provider, reference, fee_schedule_version,
                                              item_amount_minor, buyer_protection_fee_minor, amount_minor, initiated_at)
         VALUES ($1::uuid, $2, $3, 'PAYSTACK', 'fund-' || $1::text, 'older-schedule', 40000000, 600000, 40600000,
                 now() - interval '2 hours')`,
        [stale, tradeId, buyer],
      );
      const result = await start();
      expect(result.id).not.toBe(stale);
      expect(result.amountMinor).toBe(TOTAL.toString());
      expect((await attemptRow(`fund-${stale}`))?.status).toBe('ABANDONED');
    });

    it('refuses to hand out a drifted attempt it cannot yet replace', async () => {
      const fresh = randomUUID();
      await t.owner().query(
        `INSERT INTO ledger.payment_attempts (id, trade_id, buyer_user_id, provider, reference, fee_schedule_version,
                                              item_amount_minor, buyer_protection_fee_minor, amount_minor)
         VALUES ($1::uuid, $2, $3, 'PAYSTACK', 'fund-' || $1::text, 'older-schedule', 40000000, 600000, 40600000)`,
        [fresh, tradeId, buyer],
      );
      await expect(start()).rejects.toMatchObject({ status: 409 });
    });

    it('will not start over while a payment is still verifying', async () => {
      await start();
      await confirmFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } });
      await expect(
        initiateFunding(chargeDeps(), { userId: buyer, trade: { tradeCode }, restart: true }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('is a 404 for anyone but the buyer, the seller included', async () => {
      await expect(
        initiateFunding(chargeDeps(), { userId: seller, trade: { tradeCode } }),
      ).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        initiateFunding(chargeDeps(), { userId: buyer, trade: { tradeCode: 'KMT-9999999-NG' } }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a trade that is not waiting for payment', async () => {
      await transition(t.app(), tradeId, { action: 'EXPIRE', to: 'EXPIRED' });
      await expect(start()).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
    });

    it('refuses an unverified seller, and records the gate', async () => {
      await t
        .owner()
        .query(`UPDATE identity.users SET verification_level = 'CONTACT_VERIFIED' WHERE id = $1`, [seller]);
      await expect(start()).rejects.toMatchObject({ code: 'SELLER_NOT_VERIFIED' });
      expect(await outbox('trades.eligibility.blocked')).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM ledger.payment_attempts`)).toBe(0);
    });

    it('needs Paystack configured and an email to send the receipt to', async () => {
      await expect(
        initiateFunding(chargeDeps({ publicKey: undefined }), { userId: buyer, trade: { tradeCode } }),
      ).rejects.toMatchObject({ status: 503 });
      await t.app().query(`UPDATE identity.users SET primary_email_id = NULL WHERE id = $1`, [buyer]);
      await t.app().query(`UPDATE identity.user_emails SET verified_at = NULL WHERE user_id = $1`, [buyer]);
      await expect(start()).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('confirming and the buyer-facing state (AB3, AB4)', () => {
    it('moves the attempt to verifying and queues a verify, which is all it does', async () => {
      const attempt = await start();
      const view = await confirmFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } });
      expect(view.displayState).toBe('VERIFYING');
      expect(verifies).toEqual([attempt.reference]);
      expect(await journals()).toBe(0);

      // AB4's "check again" queues another.
      await confirmFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } });
      expect(verifies).toHaveLength(2);
    });

    it('shows NONE, then not confirmed for an abandoned checkout, then confirmed', async () => {
      expect((await paymentStatus(chargeDeps(), { userId: buyer, trade: { tradeCode } })).displayState).toBe(
        'NONE',
      );
      const attempt = await start();
      await settleCharge(
        { db: t.db(), logger },
        attempt.reference,
        success(attempt.reference, { status: 'abandoned' }),
      );
      expect((await paymentStatus(chargeDeps(), { userId: buyer, trade: { tradeCode } })).displayState).toBe(
        'NOT_CONFIRMED',
      );
      await settleCharge({ db: t.db(), logger }, attempt.reference, success(attempt.reference));
      expect((await paymentStatus(chargeDeps(), { userId: buyer, trade: { tradeCode } })).displayState).toBe(
        'CONFIRMED',
      );
    });

    it('never turns a confirm racing the settle into an error, and never verifies a settled charge', async () => {
      for (let round = 0; round < 5; round++) {
        // One success per trade: clear the last round's attempt (TRUNCATE fires no row trigger).
        await t.owner().query(`TRUNCATE ledger.payment_attempts`);
        verifies = [];
        const attempt = await start();
        const [view, outcome] = await Promise.all([
          confirmFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } }),
          settleCharge({ db: t.db(), logger }, attempt.reference, success(attempt.reference)),
        ]);
        expect(outcome.kind).toBe('POST');
        expect(['VERIFYING', 'CONFIRMED']).toContain(view.displayState);
        if (view.displayState === 'CONFIRMED') expect(verifies).toEqual([]);
      }
      expect((await confirmFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } })).displayState).toBe(
        'CONFIRMED',
      );
    });

    it('never turns a restart racing the settle into an error', async () => {
      const attempt = await start();
      await settleCharge(
        { db: t.db(), logger },
        attempt.reference,
        success(attempt.reference, { status: 'abandoned' }),
      );
      const [restarted, settled] = await Promise.allSettled([
        restart(2),
        settleCharge({ db: t.db(), logger }, attempt.reference, success(attempt.reference)),
      ]);
      expect(settled.status).toBe('fulfilled');
      // Either the settle won (409 already funded) or the restart did (the money goes to review).
      if (restarted.status === 'rejected') expect(restarted.reason).toMatchObject({ status: 409 });
      const outcome = settled.status === 'fulfilled' ? settled.value.kind : '';
      expect(['POST', 'NEEDS_REVIEW']).toContain(outcome);
      expect(outcome === 'POST').toBe(restarted.status === 'rejected');
      expect(await journals()).toBe(outcome === 'POST' ? 1 : 0);
    });

    it('retries a charge the provider has not decided, keeping what it learned', async () => {
      const attempt = await start();
      await expect(
        settleCharge(
          { db: t.db(), logger },
          attempt.reference,
          success(attempt.reference, { status: 'ongoing' }),
        ),
      ).rejects.toBeInstanceOf(ChargeStillPendingError);
      expect(await attemptRow(attempt.reference)).toMatchObject({
        status: 'PENDING',
        last_provider_status: 'ongoing',
      });
    });
  });

  describe('the webhook route', () => {
    let caller: Actor;
    const app = (): Express =>
      createApp({
        config,
        logger,
        mountV1: mountRoutes([...paymentRoutes(() => chargeDeps()), ...webhookRoutes(() => webhookDeps())], {
          logger,
          resolveActor: () => Promise.resolve(caller),
          // The platform's gates have their own tests; pass-throughs here keep this about funding.
          idempotency: (_ctx, run) => run(),
          rateLimit: () => Promise.resolve(),
        }),
      });

    const post = (body: Buffer, signature?: string) => {
      const req = request(app()).post('/v1/webhooks/paystack').set('content-type', 'application/json');
      return (signature === undefined ? req : req.set('x-paystack-signature', signature)).send(
        body.toString(),
      );
    };

    beforeEach(() => {
      caller = testActor(buyer);
    });

    it('refuses a bad signature before storing anything', async () => {
      const body = chargeEvent(`fund-${randomUUID()}`);
      expect((await post(body, sign(Buffer.from('other')))).status).toBe(401);
      expect((await post(body)).status).toBe(401);
      expect(await count(`SELECT count(*) AS n FROM ledger.payment_provider_webhooks`)).toBe(0);
      expect(deliveries).toEqual([]);
    });

    it('stores a signed delivery, queues it and answers 200; a replay is counted, not re-queued', async () => {
      const attempt = await start();
      const body = chargeEvent(attempt.reference, 4242);

      const first = await post(body, sign(body));
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ received: true });
      expect(deliveries).toHaveLength(1);
      expect(await journals()).toBe(0);

      await processDelivery(processDeps(success), deliveries[0] as bigint);
      expect((await post(body, sign(body))).status).toBe(200);
      expect(deliveries).toHaveLength(1);
      const { rows } = await t
        .app()
        .query<{ duplicate_count: number }>(`SELECT duplicate_count FROM ledger.payment_provider_webhooks`);
      expect(rows).toEqual([{ duplicate_count: 1 }]);
    });

    it('verifies the exact bytes: padded, reordered JSON with \\u escapes', async () => {
      const attempt = await start();
      const raw = Buffer.from(
        `{\n  "data" : { "paid_at":"2026-11-07T10:14:00.000Z", "status" : "success",\n` +
          `    "reference": "${attempt.reference}", "amount": ${String(Number(TOTAL))}, "id": 9001,\n` +
          `    "customer": { "first_name": "\\u00c0d\\u00e9" } },\n  "event" : "charge.success"  }\n`,
        'utf8',
      );
      const res = await post(raw, sign(raw));
      expect(res.status).toBe(200);
      expect(deliveries).toHaveLength(1);
      await processDelivery(processDeps(success), deliveries[0] as bigint);
      expect(await journals()).toBe(1);
    });

    it('serves the buyer routes over HTTP', async () => {
      const initiated = await request(app()).post(`/v1/trades/${tradeCode}/payment/initiate`).send({});
      expect(initiated.status).toBe(200);
      const status = await request(app()).get(`/v1/trades/${tradeCode}/payment/status`);
      expect((status.body as { displayState: string }).displayState).toBe('AWAITING_PAYMENT');
    });
  });

  describe('the jobs', () => {
    it('verify a charge and settle it, once', async () => {
      const attempt = await start();
      const deps = processDeps(success);
      expect(await verifyChargeJob(deps, { reference: attempt.reference })).toEqual({ kind: 'POST' });
      expect(await verifyChargeJob(deps, { reference: attempt.reference })).toEqual({ kind: 'NO_OP' });
      expect(await journals()).toBe(1);
    });

    it('re-queue a delivery whose first enqueue failed, once it is stale', async () => {
      const attempt = await start();
      const body = chargeEvent(attempt.reference);
      await recordWebhook(
        { ...webhookDeps(), enqueueDelivery: () => Promise.reject(new Error('redis is down')) },
        body,
        sign(body),
      );
      const requeued: bigint[] = [];
      const sweep = (now: Date) =>
        sweepPaymentWebhooks({
          db: t.db(),
          logger,
          now,
          enqueue: (id) => Promise.resolve(void requeued.push(id)),
        });

      expect(await sweep(new Date())).toEqual({ requeued: 0, exhausted: 0 });
      expect(await sweep(new Date(Date.now() + 10 * 60_000))).toEqual({ requeued: 1, exhausted: 0 });

      await processPaymentWebhookJob(processDeps(success), { webhookId: String(requeued[0]) });
      expect(await sweep(new Date(Date.now() + 10 * 60_000))).toEqual({ requeued: 0, exhausted: 0 });
      expect(await journals()).toBe(1);
    });

    it('give up on a delivery after a bounded number of sweeps, and mark it for ops', async () => {
      const body = chargeEvent(`fund-${randomUUID()}`);
      await recordWebhook(
        { ...webhookDeps(), enqueueDelivery: () => Promise.reject(new Error('down')) },
        body,
        sign(body),
      );
      const at = new Date(Date.now() + 10 * 60_000);
      let requeued = 0;
      for (let i = 0; i < SWEEP_MAX_COUNT + 3; i++) {
        requeued += (
          await sweepPaymentWebhooks({ db: t.db(), logger, now: at, enqueue: () => Promise.resolve() })
        ).requeued;
      }
      expect(requeued).toBe(SWEEP_MAX_COUNT);
      const { rows } = await t
        .app()
        .query<{ processing_error: string | null; processed_at: Date | null }>(
          `SELECT processing_error, processed_at FROM ledger.payment_provider_webhooks`,
        );
      expect(rows[0]?.processing_error).toMatch(/^exhausted:/);
      expect(rows[0]?.processed_at).toBeNull();
    });

    it('give up on a delivery older than a day', async () => {
      const body = chargeEvent(`fund-${randomUUID()}`);
      await recordWebhook(
        { ...webhookDeps(), enqueueDelivery: () => Promise.reject(new Error('down')) },
        body,
        sign(body),
      );
      const result = await sweepPaymentWebhooks({
        db: t.db(),
        logger,
        now: new Date(Date.now() + 25 * 60 * 60_000),
        enqueue: () => Promise.resolve(),
      });
      expect(result).toEqual({ requeued: 0, exhausted: 1 });
    });

    it('leave the delivery unprocessed and post nothing when the verify call fails', async () => {
      const attempt = await start();
      const body = chargeEvent(attempt.reference);
      await recordWebhook(webhookDeps(), body, sign(body));
      const outage = {
        ...processDeps(success),
        verify: () =>
          Promise.reject(
            new ApiError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'down', 'paystack charge.verify: HTTP 503'),
          ),
      };
      await expect(processDelivery(outage, deliveries[0] as bigint)).rejects.toBeInstanceOf(ApiError);
      await expect(verifyChargeJob(outage, { reference: attempt.reference })).rejects.toBeInstanceOf(
        ApiError,
      );

      expect(await journals()).toBe(0);
      expect(
        await count(`SELECT count(*) AS n FROM ledger.payment_provider_webhooks WHERE processed_at IS NULL`),
      ).toBe(1);
      const { rows } = await t
        .app()
        .query<{ last_verify_error: string | null; status: string }>(
          `SELECT last_verify_error, status FROM ledger.payment_attempts`,
        );
      expect(rows[0]?.status).toBe('INITIATED');
      expect(rows[0]?.last_verify_error).toContain('HTTP 503');
    });

    it('record a reference the provider never saw, so the buyer is not left on "verifying"', async () => {
      const attempt = await start();
      await confirmFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } });
      const unknown = {
        ...processDeps(success),
        verify: (reference: string) => Promise.reject(new ChargeNotFoundError(reference)),
      };
      await expect(verifyChargeJob(unknown, { reference: attempt.reference })).rejects.toBeInstanceOf(
        ChargeNotFoundError,
      );
      expect(await attemptRow(attempt.reference)).toMatchObject({
        status: 'PENDING',
        last_provider_status: 'not_found',
      });
      expect((await paymentStatus(chargeDeps(), { userId: buyer, trade: { tradeCode } })).displayState).toBe(
        'NOT_CONFIRMED',
      );
      // And never seen, so replaceable once the grace has passed.
      await expect(restart(5)).rejects.toMatchObject({ status: 409 });
      expect((await restart(31)).attempt.id).not.toBe(attempt.id);
    });

    it('stop showing "verifying" for a never-seen attempt once the grace has passed', async () => {
      await start();
      await confirmFunding(chargeDeps(), { userId: buyer, trade: { tradeCode } });
      expect((await paymentStatus(later(5), { userId: buyer, trade: { tradeCode } })).displayState).toBe(
        'VERIFYING',
      );
      expect((await paymentStatus(later(31), { userId: buyer, trade: { tradeCode } })).displayState).toBe(
        'NOT_CONFIRMED',
      );
    });
  });

  describe('settling a verified charge', () => {
    it('posts pool debit against the trade’s escrow liability for item and fee, and announces it', async () => {
      const attempt = await start();
      const outcome = await settleCharge(
        { db: t.db(), logger },
        attempt.reference,
        success(attempt.reference),
      );
      expect(outcome).toEqual({ kind: 'POST' });

      const row = await attemptRow(attempt.reference);
      expect(row?.status).toBe('SUCCEEDED');
      const { rows: lines } = await t
        .app()
        .query<{ account_key: string; direction: string; amount_minor: string }>(
          `SELECT a.account_key, e.direction, e.amount_minor::text
           FROM ledger.ledger_entries e JOIN ledger.ledger_accounts a ON a.id = e.account_id
          WHERE e.journal_entry_id = $1 ORDER BY e.amount_minor DESC`,
          [row?.journal_entry_id],
        );
      expect(lines).toEqual([
        { account_key: 'NGN:PLATFORM_ESCROW_POOL:-', direction: 'DEBIT', amount_minor: TOTAL.toString() },
        {
          account_key: `NGN:USER_ESCROW_LIABILITY:${tradeId}`,
          direction: 'CREDIT',
          amount_minor: ITEM.toString(),
        },
        {
          account_key: `NGN:USER_ESCROW_LIABILITY:${tradeId}`,
          direction: 'CREDIT',
          amount_minor: FEE.toString(),
        },
      ]);
      expect((await accountBalance(t.db(), { type: 'USER_ESCROW_LIABILITY', tradeId })).balanceMinor).toBe(
        TOTAL,
      );
      expect(await outbox('ledger.payment.escrow_funded')).toBe(1);
      expect(await outbox('ledger.journal.posted')).toBe(1);
    });

    it('never double-posts a replayed webhook, nor a second delivery for the same charge', async () => {
      const attempt = await start();
      const body = chargeEvent(attempt.reference, 77);
      await recordWebhook(webhookDeps(), body, sign(body));
      await recordWebhook(webhookDeps(), body, sign(body));
      // The same bytes again, and a different delivery (another event id) about the same charge.
      const other = chargeEvent(attempt.reference, 78);
      await recordWebhook(webhookDeps(), other, sign(other));

      for (const id of deliveries) await processDelivery(processDeps(success), id);
      for (const id of deliveries) await processDelivery(processDeps(success), id);

      expect(await journals()).toBe(1);
      expect(await outbox('ledger.payment.escrow_funded')).toBe(1);
      expect(
        await count(`SELECT count(*) AS n FROM ledger.payment_provider_webhooks WHERE processed_at IS NULL`),
      ).toBe(0);
    });

    it('posts once when verifies of one charge race each other', async () => {
      const attempt = await start();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          settleCharge({ db: t.db(), logger }, attempt.reference, success(attempt.reference)),
        ),
      );
      expect(results.filter((r) => r.kind === 'POST')).toHaveLength(1);
      expect(results.filter((r) => r.kind === 'NO_OP')).toHaveLength(5);
      expect(await journals()).toBe(1);
      expect(await outbox('ledger.payment.escrow_funded')).toBe(1);
    });

    it.each([
      ['an under-payment', { amountMinor: Number(TOTAL) - 1 }],
      ['an over-payment', { amountMinor: Number(TOTAL) + 1 }],
      ['another currency', { currency: 'USD' }],
      ['a reversal', { status: 'reversed' }],
    ])('holds %s for review and posts nothing', async (_label, overrides) => {
      const attempt = await start();
      const outcome = await settleCharge(
        { db: t.db(), logger },
        attempt.reference,
        success(attempt.reference, overrides),
      );
      expect(outcome.kind).toBe('NEEDS_REVIEW');
      expect((await attemptRow(attempt.reference))?.status).toBe('NEEDS_REVIEW');
      expect(await journals()).toBe(0);
      expect(await outbox('ledger.payment.review_required')).toBe(1);
      expect((await paymentStatus(chargeDeps(), { userId: buyer, trade: { tradeCode } })).displayState).toBe(
        'UNDER_REVIEW',
      );
    });

    it('holds money for a trade no longer awaiting it', async () => {
      const attempt = await start();
      await transition(t.app(), tradeId, { action: 'EXPIRE', to: 'EXPIRED' });
      const outcome = await settleCharge(
        { db: t.db(), logger },
        attempt.reference,
        success(attempt.reference),
      );
      expect(outcome.kind).toBe('NEEDS_REVIEW');
      expect(await journals()).toBe(0);
    });

    it('holds money that lands on an abandoned reference once, without touching the final row', async () => {
      const first = await start();
      await restart(31);
      for (let i = 0; i < 3; i++) {
        const outcome = await settleCharge({ db: t.db(), logger }, first.reference, success(first.reference));
        expect(outcome.kind).toBe('NEEDS_REVIEW');
      }
      expect((await attemptRow(first.reference))?.status).toBe('ABANDONED');
      expect(await outbox('ledger.payment.review_required')).toBe(1);
      expect(await journals()).toBe(0);
    });

    it('alerts ops once for a mismatched charge however often it is verified', async () => {
      const attempt = await start();
      const short = success(attempt.reference, { amountMinor: Number(TOTAL) - 1 });
      await Promise.all(
        Array.from({ length: 4 }, () => settleCharge({ db: t.db(), logger }, attempt.reference, short)),
      );
      await settleCharge({ db: t.db(), logger }, attempt.reference, short);
      expect(await outbox('ledger.payment.review_required')).toBe(1);
    });

    it('posts once when two distinct charge.success events for one reference are processed at once', async () => {
      const attempt = await start();
      const a = chargeEvent(attempt.reference, 501);
      const b = chargeEvent(attempt.reference, 502);
      await recordWebhook(webhookDeps(), a, sign(a));
      await recordWebhook(webhookDeps(), b, sign(b));
      expect(deliveries).toHaveLength(2);
      await Promise.all(deliveries.map((id) => processDelivery(processDeps(success), id)));
      expect(await journals()).toBe(1);
      expect(await outbox('ledger.payment.escrow_funded')).toBe(1);
    });

    it('holds the money when the trade leaves PENDING_PAYMENT while the settle waits for its lock', async () => {
      const attempt = await start();
      const client = await t.owner().connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM trade.trades WHERE id = $1 FOR UPDATE`, [tradeId]);
        await client.query(
          `UPDATE trade.trades SET status = 'EXPIRED', status_action = 'EXPIRE', status_actor_type = 'SYSTEM',
                  status_revision = status_revision + 1 WHERE id = $1`,
          [tradeId],
        );
        const settling = settleCharge({ db: t.db(), logger }, attempt.reference, success(attempt.reference));
        // The settle has read the attempt and is now waiting on the trade row.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await client.query('COMMIT');
        expect((await settling).kind).toBe('NEEDS_REVIEW');
      } finally {
        client.release();
      }
      expect(await journals()).toBe(0);
    });

    it('records a delivery for a reference it never issued, and verifies nothing', async () => {
      const body = chargeEvent('somebody-elses-ref');
      await recordWebhook(webhookDeps(), body, sign(body));
      const asked: string[] = [];
      const outcome = await processDelivery(
        {
          ...processDeps(success),
          verify: (reference) => {
            asked.push(reference);
            return Promise.resolve(success(reference));
          },
        },
        deliveries[0] as bigint,
      );
      expect(outcome).toBe('UNKNOWN_REFERENCE');
      expect(asked).toEqual([]);
      const { rows } = await t
        .app()
        .query<{ processing_error: string }>(`SELECT processing_error FROM ledger.payment_provider_webhooks`);
      expect(rows).toEqual([{ processing_error: 'unknown reference' }]);
    });
  });
});
