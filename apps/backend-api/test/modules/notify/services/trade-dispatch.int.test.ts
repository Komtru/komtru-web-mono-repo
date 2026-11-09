// T-068 through the real pipeline: a trade event, the real binding, the shipped catalogue, a real trade
// row. Proves the right people get a row with a rendered deep link, a non-applicable state change
// sends nothing, a user's opt-out is honoured, and a redelivered event adds no row.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../../src/config/env.js';
import { BINDINGS } from '../../../../src/modules/notify/domain/binding.js';
import { CATALOGUE } from '../../../../src/modules/notify/domain/catalogue.js';
import { dispatchForEvent } from '../../../../src/modules/notify/services/dispatch.service.js';
import { syncCatalogue } from '../../../../src/modules/notify/services/sync.service.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertTrade } from '../../trades/support.js';
import { insertUser } from '../support.js';

const config = loadConfig({
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://x@localhost/x',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
});
const logger = createLogger(config);
const notifyConfig = {
  defaultLocale: 'en-NG',
  maxAttempts: 5,
  retryBaseDelayMs: 10,
  rateLimitWindowMinutes: 60,
  rateLimitMaxPerWindow: 100,
  smsDryRun: true,
  pushDryRun: true,
};

describe.runIf(infraEnabled)('trade notifications through the pipeline (T-068)', () => {
  const t = useTestDatabase();

  const world = async () => {
    await syncCatalogue(t.db(), CATALOGUE);
    const buyer = await insertUser(t.owner());
    const seller = await insertUser(t.owner());
    const tradeId = await insertTrade(t.owner(), { buyer, seller, role: 'SELLER' });
    const { rows } = await t
      .owner()
      .query<{ trade_code: string }>(`SELECT trade_code FROM trade.trades WHERE id = $1`, [tradeId]);
    return { buyer, seller, tradeId, tradeCode: rows[0]!.trade_code };
  };

  const send = async (
    subscriber: string,
    payload: unknown,
    eventId: string = randomUUID(),
  ): Promise<void> => {
    const binding = BINDINGS.find((b) => b.subscriber === subscriber)!;
    const envelope = {
      eventId,
      eventType: binding.event.eventType,
      version: 1,
      occurredAt: new Date().toISOString(),
      actor: { type: 'SYSTEM' },
      payload,
    } as EventEnvelope<unknown>;
    await t.db().transaction(async (tx) => {
      const recipients = await binding.audience!(binding.event.payload.parse(payload), tx);
      await dispatchForEvent({ config: notifyConfig, logger }, tx, {
        envelope,
        templateKey: binding.templateKey,
        recipients,
      });
    });
  };

  const feed = async (userId: string) =>
    (
      await t.owner().query<{ template_key: string; rendered_body: string; status: string; channel: string }>(
        `SELECT template_key, rendered_body, status, channel FROM notify.notifications
            WHERE user_id = $1 ORDER BY queued_at, channel`,
        [userId],
      )
    ).rows;

  const funded = (w: { tradeId: string; tradeCode: string }) => ({
    tradeId: w.tradeId,
    tradeCode: w.tradeCode,
    action: 'FUND',
    from: 'PENDING_PAYMENT',
    to: 'FUNDED',
    actorType: 'LEDGER',
  });

  it('tells both parties a trade is funded, each with their own next step and the deep link', async () => {
    const w = await world();
    await send('notify.on-trade-funded', funded(w));

    const buyerRows = await feed(w.buyer);
    const sellerRows = await feed(w.seller);
    const buyerInApp = buyerRows.find((r) => r.channel === 'IN_APP')!;
    const sellerInApp = sellerRows.find((r) => r.channel === 'IN_APP')!;
    expect(buyerInApp.template_key).toBe('trades.funded');
    expect(buyerInApp.rendered_body).toContain(`https://app.komtru.com/trades/${w.tradeCode}`);
    expect(buyerInApp.rendered_body).toMatch(/escrow/);
    expect(sellerInApp.rendered_body).toMatch(/ship now/);
    expect(buyerInApp.status).toBe('SENT');
  });

  it('tells only the other party when one party acts, and nobody when the transition is not theirs', async () => {
    const w = await world();
    await send('notify.on-trade-cancelled', {
      ...funded(w),
      action: 'CANCEL',
      from: 'PENDING_PAYMENT',
      to: 'CANCELLED',
      actorType: 'BUYER',
      actorId: w.buyer,
    });
    expect((await feed(w.seller)).some((r) => r.template_key === 'trades.cancelled')).toBe(true);
    expect(await feed(w.buyer)).toEqual([]);

    // A FUND state change is none of the cancellation plan's business.
    const other = await world();
    await send('notify.on-trade-cancelled', funded(other));
    expect(await feed(other.buyer)).toEqual([]);
    expect(await feed(other.seller)).toEqual([]);
  });

  it('honours an opt-out of the TRADE category on a channel', async () => {
    const w = await world();
    await t.owner().query(
      `INSERT INTO notify.notification_preferences (user_id, category, channel, opted_in)
         VALUES ($1, 'TRADE', 'IN_APP', false)`,
      [w.buyer],
    );
    await send('notify.on-trade-funded', funded(w));
    const rows = await feed(w.buyer);
    expect(rows.find((r) => r.channel === 'IN_APP')?.status).toBe('SUPPRESSED');
  });

  it('adds no second row when the same event is delivered again', async () => {
    const w = await world();
    const eventId = randomUUID();
    await send('notify.on-trade-funded', funded(w), eventId);
    const once = (await feed(w.buyer)).length;
    await send('notify.on-trade-funded', funded(w), eventId);
    expect((await feed(w.buyer)).length).toBe(once);
  });

  it('sends nothing, and does not fail, for a trade that no longer exists', async () => {
    await syncCatalogue(t.db(), CATALOGUE);
    await send('notify.on-trade-funded', {
      tradeId: randomUUID(),
      tradeCode: 'KMT-7398512-NG',
      action: 'FUND',
      from: 'PENDING_PAYMENT',
      to: 'FUNDED',
      actorType: 'LEDGER',
    });
  });
});
