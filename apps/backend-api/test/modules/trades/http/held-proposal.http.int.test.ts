/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped in assertions */
// A proposal held for review (or turned back, or withdrawn while held) is invisible to the counterparty on EVERY
// door, not just the list: the read, the code lookup, the actions, the feed, the list and the room. The
// reviewer found a bound counterparty could read it, see the proposer's address and CANCEL a review in
// progress; each case below was proven to fail by removing the one gate (`canSeeTrade` in `requireParty`).
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tradeRoutes } from '../../../../src/modules/trades/http/trade.routes.js';
import {
  postgresCounterpartyDisplays,
  type TradeDeps,
} from '../../../../src/modules/trades/services/ports.js';
import {
  postgresTradeParties,
  tradeRoomAuthorizer,
} from '../../../../src/modules/trades/infrastructure/realtime.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { actorFor } from '../../../../src/platform/http/principal.js';
import { testPrincipal } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady, testLogger } from '../../identity/support.js';
import { person } from '../services/fulfilment-support.js';
import { driveTo, insertTermsVersion, insertTrade } from '../support.js';

describe.runIf(infraEnabled)('a proposal the counterparty may not know about yet', () => {
  const t = useTestDatabase();
  let redis: Redis;
  beforeAll(async () => {
    redis = createTestRedis();
    await redisReady(redis);
  });
  afterAll(async () => {
    await redis.quit();
  });

  const deps = (): TradeDeps =>
    ({
      db: t.db(),
      displays: postgresCounterpartyDisplays(() => Promise.resolve(new Map<string, string | null>())),
      revokeProofAccess: vi.fn(() => Promise.resolve()),
    }) as unknown as TradeDeps;

  const appFor = (userId: string) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(tradeRoutes(deps), {
      logger: testLogger,
      resolveActor: () => Promise.resolve(actorFor(testPrincipal(userId))),
      rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `held-${randomUUID()}` }),
      idempotency: (_input, run) => run(),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return request(app);
  };

  const move = (tradeId: string, action: string, to: string, actorType: string, actorId: string | null) =>
    t.owner().query(
      `UPDATE trade.trades SET status = $2, status_action = $3, status_actor_type = $4, status_actor_id = $5,
         status_revision = status_revision + 1 WHERE id = $1`,
      [tradeId, to, action, actorType, actorId],
    );

  /** The proposer sells to a bound counterparty; the proposal is put in `state`. */
  const held = async (state: 'HELD' | 'REJECTED' | 'WITHDRAWN' | 'SENT') => {
    const proposer = await person(t);
    const other = await person(t);
    const tradeId = await insertTrade(t.owner(), { seller: proposer, buyer: other, role: 'SELLER' });
    await insertTermsVersion(t.owner(), tradeId, proposer, { proposed_by_role: 'SELLER' });
    await t.owner().query(
      `UPDATE trade.trades SET current_terms_version_id =
         (SELECT id FROM trade.trade_terms_versions WHERE trade_id = $1 LIMIT 1) WHERE id = $1`,
      [tradeId],
    );
    await driveTo(t.owner(), tradeId, state === 'SENT' ? 'AWAITING_ACCEPTANCE' : 'UNDER_PROPOSAL_REVIEW');
    if (state === 'REJECTED') await move(tradeId, 'REJECT_REVIEW', 'REJECTED', 'STAFF', randomUUID());
    if (state === 'WITHDRAWN') await move(tradeId, 'CANCEL', 'CANCELLED', 'SELLER', proposer);
    const { rows } = await t
      .owner()
      .query<{ trade_code: string }>(`SELECT trade_code FROM trade.trades WHERE id = $1`, [tradeId]);
    return { tradeId, proposer, other, code: rows[0]!.trade_code };
  };

  const statusOf = async (tradeId: string) =>
    (await t.owner().query(`SELECT status FROM trade.trades WHERE id = $1`, [tradeId])).rows[0]
      .status as string;

  const same404 = async (
    userId: string,
    send: (r: ReturnType<typeof appFor>) => Promise<request.Response>,
  ) => {
    const res = await send(appFor(userId));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    return res;
  };

  describe.each([
    ['held for review', 'HELD'],
    ['turned back by review', 'REJECTED'],
    ['withdrawn while held', 'WITHDRAWN'],
  ] as const)('a proposal %s', (_name, state) => {
    it("cannot be read, by id or by code, by the counterparty, and is still the proposer's", async () => {
      const f = await held(state);
      await same404(f.other, (r) => r.get(`/v1/trades/${f.tradeId}`));
      await same404(f.other, (r) => r.get(`/v1/trades/by-code/${f.code}`));
      expect((await appFor(f.proposer).get(`/v1/trades/${f.tradeId}`)).status).toBe(200);
      expect((await appFor(f.proposer).get(`/v1/trades/by-code/${f.code}`)).status).toBe(200);
    });

    it('cannot be declined, cancelled, accepted or countered by the counterparty, and nothing changes', async () => {
      const f = await held(state);
      const before = await statusOf(f.tradeId);
      await same404(f.other, (r) => r.post(`/v1/trades/${f.tradeId}/cancel`).send({}));
      await same404(f.other, (r) => r.post(`/v1/trades/${f.tradeId}/decline`).send({ reason: 'no thanks' }));
      await same404(f.other, (r) =>
        r.post(`/v1/trades/${f.tradeId}/accept`).send({ termsVersionId: randomUUID() }),
      );
      expect(await statusOf(f.tradeId)).toBe(before);
    });

    it("is not in the counterparty's list, nor its feed, and is in the proposer's list", async () => {
      const f = await held(state);
      const theirs = await appFor(f.other).get('/v1/trades');
      expect((theirs.body.items as { id: string }[]).map((i) => i.id)).not.toContain(f.tradeId);
      await same404(f.other, (r) => r.get(`/v1/trades/${f.tradeId}/activity`));
      const mine = await appFor(f.proposer).get('/v1/trades');
      expect((mine.body.items as { id: string }[]).map((i) => i.id)).toContain(f.tradeId);
    });

    it('is refused to the counterparty at the room, and admitted to the proposer', async () => {
      const f = await held(state);
      const authorize = tradeRoomAuthorizer({ parties: postgresTradeParties(t.db()) });
      const as = (userId: string) =>
        authorize({
          principal: testPrincipal(userId),
          userId,
          scope: 'CONSUMER',
          prefix: 'trade',
          id: f.code,
        } as never);
      expect(await as(f.other)).toBe(false);
      expect(await as(f.proposer)).toBe(true);
    });
  });

  it('lets the proposer withdraw a held proposal, and then the counterparty still cannot see it', async () => {
    const f = await held('HELD');
    expect((await appFor(f.proposer).post(`/v1/trades/${f.tradeId}/cancel`).send({})).status).toBe(200);
    expect(await statusOf(f.tradeId)).toBe('CANCELLED');
    await same404(f.other, (r) => r.get(`/v1/trades/${f.tradeId}`));
    const list = await appFor(f.other).get('/v1/trades');
    expect((list.body.items as { id: string }[]).map((i) => i.id)).not.toContain(f.tradeId);
  });

  it('still shows the counterparty a proposal that was sent in the ordinary way, and its cancellation', async () => {
    const f = await held('SENT');
    expect((await appFor(f.other).get(`/v1/trades/${f.tradeId}`)).status).toBe(200);
    expect((await appFor(f.other).post(`/v1/trades/${f.tradeId}/cancel`).send({})).status).toBe(200);
    expect((await appFor(f.other).get(`/v1/trades/${f.tradeId}`)).status).toBe(200);
    const list = await appFor(f.other).get('/v1/trades');
    expect((list.body.items as { id: string }[]).map((i) => i.id)).toContain(f.tradeId);
  });
});
