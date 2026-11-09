/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies and raw `pg` rows are untyped in assertions */
// `GET /trades/:id/activity` through the platform's route mounting, against a real database and the real
// rate-limit gate. Skipped unless KOMTRU_INFRA_TESTS=1.
//
// The negative tests are the point: only a party may read it, a stranger and a missing trade are the same
// answer, a counterparty learns nothing of a proposal still in review, and nothing a staff member or a
// service wrote as free text reaches a party.
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tradeActivityResponseSchema } from '@komtru/shared-types';
import { tradeRoutes } from '../../../../src/modules/trades/http/trade.routes.js';
import {
  postgresCounterpartyDisplays,
  type TradeDeps,
} from '../../../../src/modules/trades/services/ports.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { actorFor } from '../../../../src/platform/http/principal.js';
import { encodeCursor } from '../../../../src/platform/http/paginate.js';
import { testPrincipal } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady, testLogger } from '../../identity/support.js';
import { person, tradeAt } from '../services/fulfilment-support.js';
import { driveTo, insertRow, insertTrade } from '../support.js';

describe.runIf(infraEnabled)('the trade activity feed', () => {
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
    }) as unknown as TradeDeps;

  const appFor = (userId: string) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(tradeRoutes(deps), {
      logger: testLogger,
      resolveActor: () => Promise.resolve(actorFor(testPrincipal(userId))),
      rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `act-${randomUUID()}` }),
      idempotency: (_input, run) => run(),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return request(app);
  };
  const feed = (userId: string, tradeId: string, query = '') =>
    appFor(userId).get(`/v1/trades/${tradeId}/activity${query}`);

  const addActivity = (
    tradeId: string,
    over: Record<string, unknown> & { event?: string },
  ): Promise<string> => {
    const { event, ...rest } = over;
    return insertRow(t.owner(), 'trade.trade_activity', {
      trade_id: tradeId,
      type: 'NOTE',
      actor_type: 'SELLER',
      ...(event === undefined ? {} : { metadata: JSON.stringify({ event }) }),
      ...rest,
    });
  };

  /** A transition by someone, with the reason they gave: raw SQL, as the state machine's trigger sees it. */
  const move = (
    tradeId: string,
    step: { action: string; to: string; actorType: string; actorId?: string; reason?: string },
  ) =>
    t.owner().query(
      `UPDATE trade.trades SET status = $2, status_action = $3, status_actor_type = $4, status_actor_id = $5,
         status_reason = $6, status_revision = status_revision + 1 WHERE id = $1`,
      [tradeId, step.to, step.action, step.actorType, step.actorId ?? null, step.reason ?? null],
    );

  it('shows each party the trade history, newest first, in the shared contract', async () => {
    const f = await tradeAt(t, 'INSPECTION');
    const buyerView = await feed(f.buyer, f.tradeId);
    expect(buyerView.status).toBe(200);
    expect(tradeActivityResponseSchema.safeParse(buyerView.body).success).toBe(true);
    const kinds = (buyerView.body.items as { kind: string }[]).map((item) => item.kind);
    expect(kinds).toEqual([
      'DELIVERY_REPORTED',
      'SHIPPED',
      'FUNDS_PROTECTED',
      'TERMS_AGREED',
      'PROPOSAL_SENT',
    ]);
    const times = (buyerView.body.items as { occurredAt: string }[]).map((item) => item.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect((await feed(f.seller, f.tradeId)).status).toBe(200);
  });

  describe('who may read it', () => {
    it('answers a stranger exactly as it answers a trade that does not exist', async () => {
      const f = await tradeAt(t, 'FUNDED');
      const stranger = await person(t);
      const notYours = await feed(stranger, f.tradeId);
      const missing = await feed(stranger, randomUUID());
      expect(notYours.status).toBe(404);
      expect({ ...notYours.body, instance: undefined, requestId: undefined }).toEqual({
        ...missing.body,
        instance: undefined,
        requestId: undefined,
      });
    });

    it('is not open to staff as such: a staff principal that is not a party gets the same 404', async () => {
      const f = await tradeAt(t, 'FUNDED');
      const staff = await person(t);
      expect((await feed(staff, f.tradeId)).status).toBe(404);
    });

    it.each(['UNDER_PROPOSAL_REVIEW', 'REJECTED'])(
      'tells the counterparty nothing of a proposal in %s, and still shows the proposer',
      async (status) => {
        const proposer = await person(t);
        const other = await person(t);
        const tradeId = await insertTrade(t.owner(), { seller: proposer, buyer: other, role: 'SELLER' });
        await driveTo(t.owner(), tradeId, status);
        expect((await feed(other, tradeId)).status).toBe(404);
        const own = await feed(proposer, tradeId);
        expect(own.status).toBe(200);
        expect((own.body.items as { kind: string }[]).map((item) => item.kind)).toContain(
          status === 'REJECTED' ? 'PROPOSAL_NOT_SENT' : 'PROPOSAL_HELD',
        );
      },
    );

    it('hides the review rows from the counterparty once a held proposal is cleared', async () => {
      const proposer = await person(t);
      const other = await person(t);
      const tradeId = await insertTrade(t.owner(), { seller: proposer, buyer: other, role: 'SELLER' });
      await driveTo(t.owner(), tradeId, 'UNDER_PROPOSAL_REVIEW');
      await move(tradeId, {
        action: 'CLEAR_REVIEW',
        to: 'AWAITING_ACCEPTANCE',
        actorType: 'STAFF',
        actorId: randomUUID(),
        reason: 'LEAK-cleared-because',
      });
      const theirs = await feed(other, tradeId);
      expect(theirs.status).toBe(200);
      expect((theirs.body.items as { kind: string }[]).map((item) => item.kind)).toEqual(['PROPOSAL_SENT']);
      const mine = await feed(proposer, tradeId);
      expect((mine.body.items as { kind: string }[]).map((item) => item.kind)).toEqual([
        'PROPOSAL_SENT',
        'PROPOSAL_HELD',
      ]);
    });

    it('needs a valid id', async () => {
      expect((await feed(await person(t), 'not-a-uuid')).status).toBe(422);
    });
  });

  describe('what it withholds', () => {
    it('never shows free text a staff member or a service wrote, in any field of any row', async () => {
      const f = await tradeAt(t, 'SHIPPED');
      // A staff transition with a staff reason, free-text summaries, metadata and a risk hold.
      await move(f.tradeId, {
        action: 'DISPUTE',
        to: 'DISPUTED',
        actorType: 'STAFF',
        actorId: randomUUID(),
        reason: 'LEAK-staff-reason',
      });
      await addActivity(f.tradeId, {
        type: 'HOLD_PLACED',
        actor_type: 'SYSTEM',
        summary: 'LEAK-risk-hold',
        metadata: JSON.stringify({ rule: 'LEAK-rule' }),
      });
      await addActivity(f.tradeId, {
        type: 'ELIGIBILITY_BLOCKED',
        actor_type: 'SYSTEM',
        summary: 'LEAK-eligibility',
      });
      await addActivity(f.tradeId, {
        type: 'NOTE',
        event: 'EXTENSION_REQUESTED',
        summary: 'LEAK-summary 2026-11-12T00:00:00Z',
        metadata: JSON.stringify({
          event: 'EXTENSION_REQUESTED',
          reason: 'LEAK-seller-private',
          requestId: randomUUID(),
        }),
        actor_id: f.seller,
      });
      const res = await feed(f.buyer, f.tradeId, '?limit=50');
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/LEAK/);
      expect(text).not.toContain(f.seller);
      expect(text).not.toContain(f.buyer);
      const kinds = (res.body.items as { kind: string; actor: string }[]).map(
        (item) => `${item.kind}:${item.actor}`,
      );
      expect(kinds).toContain('DELIVERY_EXTENSION_REQUESTED:OTHER_PARTY');
      expect(kinds).toContain('DISPUTE_OPENED:KOMTRU');
      expect(res.body.items).toHaveLength(6);
    });

    it('shows a decline reason a party wrote, and never a reason written by staff', async () => {
      const f = await tradeAt(t, 'FUNDED');
      await move(f.tradeId, {
        action: 'REFUND_CANCELLATION',
        to: 'CANCELLED_REFUNDED',
        actorType: 'STAFF',
        actorId: randomUUID(),
        reason: 'LEAK-staff-says',
      });
      const res = await feed(f.buyer, f.tradeId);
      expect(JSON.stringify(res.body)).not.toContain('LEAK');
      const last = res.body.items[0];
      expect(last).toMatchObject({ kind: 'REFUNDED', actor: 'KOMTRU', reason: null });

      const g = await tradeAt(t, 'AWAITING_ACCEPTANCE');
      await move(g.tradeId, {
        action: 'DECLINE',
        to: 'DECLINED',
        actorType: 'BUYER',
        actorId: g.buyer,
        reason: 'Too expensive',
      });
      const seen = await feed(g.seller, g.tradeId);
      expect(seen.body.items[0]).toMatchObject({
        kind: 'PROPOSAL_DECLINED',
        actor: 'OTHER_PARTY',
        reason: 'Too expensive',
      });
      expect((await feed(g.buyer, g.tradeId)).body.items[0]).toMatchObject({ actor: 'YOU' });
    });
  });

  describe('paging', () => {
    it('walks every row exactly once, including rows that share one microsecond', async () => {
      const f = await tradeAt(t, 'FUNDED');
      const { rows } = await t
        .owner()
        .query<{ occurred_at: Date }>(
          `SELECT occurred_at FROM trade.trade_state_changes WHERE trade_id = $1 ORDER BY id DESC LIMIT 1`,
          [f.tradeId],
        );
      const same = rows[0]!.occurred_at;
      for (let i = 0; i < 5; i += 1) {
        await insertRow(t.owner(), 'trade.trade_activity', {
          trade_id: f.tradeId,
          type: 'NOTE',
          actor_type: 'SELLER',
          occurred_at: same,
          metadata: JSON.stringify({ event: i % 2 ? 'EXTENSION_LAPSED' : 'EXTENSION_REQUESTED' }),
        });
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await feed(f.buyer, f.tradeId, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        expect(res.status).toBe(200);
        seen.push(...(res.body.items as { id: string }[]).map((item) => item.id));
        cursor = res.body.nextCursor;
        pages += 1;
      } while (cursor && pages < 20);
      const all = await feed(f.buyer, f.tradeId, '?limit=100');
      expect(seen).toHaveLength((all.body.items as unknown[]).length);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toEqual((all.body.items as { id: string }[]).map((item) => item.id));
      expect(pages).toBeGreaterThan(2);
    });

    it('is a 422 for a mangled cursor, another trade’s cursor and a trades-list cursor, and reads nothing', async () => {
      const f = await tradeAt(t, 'FUNDED');
      const other = await tradeAt(t, 'FUNDED');
      const first = await feed(f.buyer, f.tradeId, '?limit=1');
      const real = first.body.nextCursor as string;
      expect(real).toBeTruthy();
      const bad = [
        'not-base64-json!!',
        encodeCursor({ t: '2026-11-09T10:00:00.123456Z', id: 'S:1', f: other.tradeId }),
        encodeCursor({ t: '2026-11-09T10:00:00.123456Z', id: f.tradeId, f: 'ALL' }),
        encodeCursor({ t: '2026-11-09T10:00:00.123Z', id: 'S:1', f: f.tradeId }),
        encodeCursor({ t: '2026-11-09T10:00:00.123456Z', id: 'S:1', f: f.tradeId, x: 'y' }),
      ];
      for (const cursor of bad) {
        const res = await feed(f.buyer, f.tradeId, `?cursor=${cursor}`);
        expect(res.status, cursor).toBe(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      // The genuine cursor is another trade's and refused there.
      expect((await feed(other.buyer, other.tradeId, `?cursor=${real}`)).status).toBe(422);
    });

    it('checks the cursor before it checks who is asking, so a stranger learns nothing either way', async () => {
      const f = await tradeAt(t, 'FUNDED');
      const stranger = await person(t);
      expect((await feed(stranger, f.tradeId, '?cursor=garbage')).status).toBe(422);
    });
  });
});
