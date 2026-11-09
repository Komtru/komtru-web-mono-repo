/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies and raw `pg` rows are untyped in assertions */
// `GET /trades` and `GET /trades/by-code/:code` through the platform's route mounting, against a real
// database and the real rate-limit gate. Skipped unless KOMTRU_INFRA_TESTS=1.
//
// The negative tests here are the point: a code must resolve for a party and for the named invitee and
// for nobody else, and a miss and a not-yours must be byte-identical. Each was proven to fail by
// removing the check it guards (see the plan).
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tradeByCodeResponseSchema, tradeListResponseSchema } from '@komtru/shared-types';
import { tradeRoutes } from '../../../../src/modules/trades/http/trade.routes.js';
import {
  postgresCounterpartyDisplays,
  type TradeDeps,
} from '../../../../src/modules/trades/services/ports.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { actorFor } from '../../../../src/platform/http/principal.js';
import { testPrincipal } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady, testLogger } from '../../identity/support.js';
import { person, standard, tradeAt } from '../services/fulfilment-support.js';
import { driveTo, insertRow, insertTermsVersion, insertTrade } from '../support.js';

describe.runIf(infraEnabled)('the trades list and the lookup by code', () => {
  const t = useTestDatabase();
  let redis: Redis;
  beforeAll(async () => {
    redis = createTestRedis();
    await redisReady(redis);
  });
  afterAll(async () => {
    await redis.quit();
  });

  const avatars = new Map<string, string | null>();
  const deps = (): TradeDeps =>
    ({
      db: t.db(),
      displays: postgresCounterpartyDisplays((ids) =>
        Promise.resolve(new Map(ids.map((id) => [id, avatars.get(id) ?? null]))),
      ),
    }) as unknown as TradeDeps;

  const appFor = (userId: string, keyPrefix = `list-${randomUUID()}`) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(tradeRoutes(deps), {
      logger: testLogger,
      resolveActor: () => Promise.resolve(actorFor(testPrincipal(userId))),
      rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix }),
      idempotency: (_input, run) => run(),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return request(app);
  };

  /** Fixtures write terms versions without pointing the trade at one; the services do both. */
  const pinTerms = (tradeId: string) =>
    t.owner().query(
      `UPDATE trade.trades SET current_terms_version_id =
         (SELECT id FROM trade.trade_terms_versions WHERE trade_id = $1 ORDER BY version_number DESC LIMIT 1)
       WHERE id = $1`,
      [tradeId],
    );

  const codeOf = async (tradeId: string): Promise<string> =>
    (
      await t
        .owner()
        .query<{ trade_code: string }>(`SELECT trade_code FROM trade.trades WHERE id = $1`, [tradeId])
    ).rows[0]!.trade_code;

  /** An invited-but-unbound trade: the seller invited an email, and `invitee` has claimed the invitation. */
  const invitedTrade = async (
    inviter: string,
    invitee: string | null,
    status: 'PENDING' | 'CLAIMED' | 'CANCELLED' | 'EXPIRED' = 'CLAIMED',
  ) => {
    const tradeId = await insertTrade(t.owner(), { seller: inviter, role: 'SELLER' });
    await insertTermsVersion(t.owner(), tradeId, inviter, { proposed_by_role: 'SELLER' });
    await pinTerms(tradeId);
    const invitationId = await insertRow(t.owner(), 'identity.party_invitations', {
      inviter_user_id: inviter,
      channel: 'EMAIL',
      destination_hash: Buffer.from(randomUUID()),
      destination_masked: 'j••••@example.com',
      destination_enc: Buffer.from('x'),
      intended_role: 'BUYER',
      context_type: 'TRADE',
      context_id: tradeId,
      token_hash: Buffer.from(randomUUID()),
      status,
      ...(invitee ? { claimed_by_user_id: invitee, claimed_at: new Date() } : {}),
      expires_at: new Date(Date.now() + 86_400_000),
    });
    await t
      .owner()
      .query(`UPDATE trade.trades SET counterparty_invitation_id = $2 WHERE id = $1`, [
        tradeId,
        invitationId,
      ]);
    await driveTo(t.owner(), tradeId, 'PENDING_COUNTERPARTY');
    return { tradeId, tradeCode: await codeOf(tradeId) };
  };

  // ------------------------------------------------------------------------------------------
  describe('GET /trades', () => {
    it("lists only the caller's trades, as a row needs them, and matches the shared contract", async () => {
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      await pinTerms(f.tradeId);
      await tradeAt(t, 'FUNDED'); // somebody else's
      await t
        .owner()
        .query(
          `UPDATE identity.users SET username = 'ada_seller', username_skeleton = 'adaseller' WHERE id = $1`,
          [f.seller],
        );
      await t
        .owner()
        .query(`INSERT INTO identity.user_profiles (user_id, display_name) VALUES ($1, 'Ada Seller')`, [
          f.seller,
        ])
        .catch(() =>
          t
            .owner()
            .query(`UPDATE identity.user_profiles SET display_name = 'Ada Seller' WHERE user_id = $1`, [
              f.seller,
            ]),
        );
      avatars.set(f.seller, 'https://cdn.example/ada.jpg');

      const res = await appFor(f.buyer).get('/v1/trades');
      expect(res.status).toBe(200);
      const body = tradeListResponseSchema.parse(res.body);
      expect(body.items).toHaveLength(1);
      const [row] = body.items;
      expect(row).toMatchObject({
        id: f.tradeId,
        status: 'PENDING_PAYMENT',
        yourRole: 'BUYER',
        attention: 'PAY',
        item: { title: 'iPhone 15' },
        currency: 'NGN',
        itemAmountMinor: '45000000',
        counterparty: {
          username: 'ada_seller',
          displayName: 'Ada Seller',
          avatarUrl: 'https://cdn.example/ada.jpg',
        },
      });
      expect(body.nextCursor).toBeNull();
      // The same trade from the other side asks nothing of the seller.
      const seller = tradeListResponseSchema.parse((await appFor(f.seller).get('/v1/trades')).body);
      expect(seller.items[0]).toMatchObject({ yourRole: 'SELLER', attention: null });
    });

    it('shows a counterparty nothing but what party lookup already shows, and never contact details', async () => {
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      await t.owner().query(
        `UPDATE identity.users SET username = 'hidden_seller', username_skeleton = 'hiddenseller',
                discoverable_by_username = false WHERE id = $1`,
        [f.seller],
      );
      const res = await appFor(f.buyer).get('/v1/trades');
      const [row] = tradeListResponseSchema.parse(res.body).items;
      expect(row!.counterparty!.username).toBeNull();
      expect(Object.keys(row!.counterparty!).sort()).toEqual([
        'avatarUrl',
        'displayName',
        'publicId',
        'username',
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/@|\+234|email|phone/i);
    });

    it('shows no counterparty once that account is erased', async () => {
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      await t
        .owner()
        .query(
          `UPDATE identity.users SET status = 'ANONYMISED', username = NULL, username_skeleton = NULL WHERE id = $1`,
          [f.seller],
        );
      const [row] = tradeListResponseSchema.parse((await appFor(f.buyer).get('/v1/trades')).body).items;
      expect(row!.counterparty).toBeNull();
      expect(row!.id).toBe(f.tradeId);
    });

    it('orders newest-relevant first and filters open against closed', async () => {
      const me = await person(t);
      const make = async (status: 'PENDING_PAYMENT' | 'SETTLED') => {
        const seller = await person(t);
        const id = await insertTrade(t.owner(), { buyer: me, seller, role: 'SELLER' });
        await insertTermsVersion(t.owner(), id, seller, { proposed_by_role: 'SELLER' });
        await driveTo(t.owner(), id, status);
        return id;
      };
      const settled = await make('SETTLED');
      const pending = await make('PENDING_PAYMENT');
      await t
        .owner()
        .query(`UPDATE trade.trades SET updated_at = now() - interval '1 day' WHERE id = $1`, [settled]);
      await t.owner().query(`UPDATE trade.trades SET updated_at = now() WHERE id = $1`, [pending]);

      const all = tradeListResponseSchema.parse((await appFor(me).get('/v1/trades')).body).items;
      expect(all.map((r) => r.id)).toEqual([pending, settled]);
      const open = tradeListResponseSchema.parse((await appFor(me).get('/v1/trades?state=OPEN')).body).items;
      const shut = tradeListResponseSchema.parse(
        (await appFor(me).get('/v1/trades?state=CLOSED')).body,
      ).items;
      expect(open.map((r) => r.id)).toEqual([pending]);
      expect(shut.map((r) => r.id)).toEqual([settled]);
      expect((await appFor(me).get('/v1/trades?state=WHATEVER')).status).toBe(422);
    });

    it('flags attention for each role from the status and from pending extension requests', async () => {
      const funded = await tradeAt(t, 'FUNDED');
      const seller = tradeListResponseSchema.parse((await appFor(funded.seller).get('/v1/trades')).body)
        .items[0];
      expect(seller!.attention).toBe('SHIP');
      const { rows: deadline } = await t.owner().query<{ id: string }>(
        `INSERT INTO trade.trade_deadlines (trade_id, kind, due_at, original_due_at)
         VALUES ($1, 'DELIVERY', now() + interval '2 days', now() + interval '2 days') RETURNING id`,
        [funded.tradeId],
      );
      await insertRow(t.owner(), 'trade.delivery_extension_requests', {
        trade_id: funded.tradeId,
        deadline_id: deadline[0]!.id,
        requested_by_user_id: funded.seller,
        reason: 'RESTOCKING_ITEM',
        current_due_at: new Date(Date.now() + 2 * 86_400_000),
        requested_due_at: new Date(Date.now() + 3 * 86_400_000),
      });
      const buyer = tradeListResponseSchema.parse((await appFor(funded.buyer).get('/v1/trades')).body)
        .items[0];
      expect(buyer!.attention).toBe('RESPOND_TO_EXTENSION');
    });

    it('does not show a counterparty a draft or a proposal held for review, but shows it to its initiator', async () => {
      const buyer = await person(t);
      const seller = await person(t);
      const held = await insertTrade(t.owner(), { buyer, seller, role: 'SELLER' });
      await insertTermsVersion(t.owner(), held, seller, { proposed_by_role: 'SELLER' });
      await driveTo(t.owner(), held, 'UNDER_PROPOSAL_REVIEW');
      expect(tradeListResponseSchema.parse((await appFor(buyer).get('/v1/trades')).body).items).toEqual([]);
      const initiator = tradeListResponseSchema.parse((await appFor(seller).get('/v1/trades')).body).items;
      expect(initiator.map((r) => r.id)).toEqual([held]);
    });

    describe('pagination', () => {
      const seed = async (n: number, sameInstant: boolean) => {
        const buyer = await person(t);
        const ids: string[] = [];
        for (let i = 0; i < n; i++) {
          const seller = await person(t);
          const id = await insertTrade(t.owner(), { buyer, seller, role: 'SELLER' });
          await insertTermsVersion(t.owner(), id, seller, { proposed_by_role: 'SELLER' });
          await driveTo(t.owner(), id, 'AWAITING_ACCEPTANCE');
          ids.push(id);
        }
        // Every row at one instant, to a microsecond: the tie-break and the precision are both tested.
        if (sameInstant) {
          await t
            .owner()
            .query(
              `UPDATE trade.trades SET updated_at = '2026-01-01 00:00:00.123456+00' WHERE id = ANY($1)`,
              [ids],
            );
        }
        return { buyer, ids };
      };
      const walk = async (userId: string, query = '') => {
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let pages = 0; pages < 20; pages++) {
          const res: request.Response = await appFor(userId).get(
            `/v1/trades?limit=2${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          expect(res.status).toBe(200);
          const page = tradeListResponseSchema.parse(res.body);
          seen.push(...page.items.map((r) => r.id));
          cursor = page.nextCursor;
          if (!cursor) return seen;
        }
        throw new Error('the cursor never ended');
      };

      it('walks every trade exactly once, including rows that share a microsecond', async () => {
        const { buyer, ids } = await seed(5, true);
        const seen = await walk(buyer);
        expect(seen.sort()).toEqual([...ids].sort());
        expect(new Set(seen).size).toBe(5);
      });

      it('walks every trade exactly once in ordinary order too', async () => {
        const { buyer, ids } = await seed(5, false);
        expect((await walk(buyer)).sort()).toEqual([...ids].sort());
      });

      it.each([
        ['text', 'garbage'],
        ['base64 that is not JSON', Buffer.from('nope').toString('base64url')],
        ['an empty object', Buffer.from('{}').toString('base64url')],
        [
          "another list's cursor",
          Buffer.from(JSON.stringify({ d: '2026-01-01T00:00:00.000Z', id: randomUUID() })).toString(
            'base64url',
          ),
        ],
        [
          'a time with no microseconds',
          Buffer.from(JSON.stringify({ t: '2026-01-01T00:00:00Z', id: randomUUID(), f: 'ALL' })).toString(
            'base64url',
          ),
        ],
        [
          'a cursor with a smuggled field',
          Buffer.from(
            JSON.stringify({ t: '2026-01-01T00:00:00.000000Z', id: randomUUID(), f: 'ALL', userId: 'x' }),
          ).toString('base64url'),
        ],
      ])('fails loudly with a 422 for %s, and never silently returns page 1', async (_name, cursor) => {
        const { buyer } = await seed(3, false);
        const res = await appFor(buyer).get(`/v1/trades?limit=2&cursor=${encodeURIComponent(cursor)}`);
        expect(res.status).toBe(422);
        expect(res.body.items).toBeUndefined();
      });

      it('refuses a cursor issued for a different state filter', async () => {
        const { buyer } = await seed(3, false);
        const first = tradeListResponseSchema.parse(
          (await appFor(buyer).get('/v1/trades?limit=1&state=OPEN')).body,
        );
        const res = await appFor(buyer).get(
          `/v1/trades?limit=1&state=CLOSED&cursor=${encodeURIComponent(first.nextCursor!)}`,
        );
        expect(res.status).toBe(422);
      });
    });

    it('is rate limited, generously, and answers 429 past the budget', async () => {
      const me = await person(t);
      const app = appFor(me, `list-limit-${randomUUID()}`);
      let last = 200;
      for (let i = 0; i < 121; i++) last = (await app.get('/v1/trades')).status;
      expect(last).toBe(429);
    }, 60_000);
  });

  // ------------------------------------------------------------------------------------------
  describe('GET /trades/by-code/:code', () => {
    it('opens the trade for a party', async () => {
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      const code = await codeOf(f.tradeId);
      for (const [user, role] of [
        [f.buyer, 'BUYER'],
        [f.seller, 'SELLER'],
      ] as const) {
        const res = await appFor(user).get(`/v1/trades/by-code/${code}`);
        expect(res.status).toBe(200);
        const body = tradeByCodeResponseSchema.parse(res.body);
        expect(body.access).toBe('PARTY');
        expect(body.trade).toMatchObject({ id: f.tradeId, yourRole: role });
        expect(body.trade.fees).not.toBeNull();
        expect(body.trade.shareUrl).toBe(`https://app.komtru.com/trades/${code}`);
      }
    });

    it('carries the category and the pinned standard version on the trade view', async () => {
      await t.owner().query(
        `INSERT INTO config.trade_categories (id, code, name) VALUES ($1, 'PHONES', 'Phones')
         ON CONFLICT (code) DO NOTHING`,
        [standard.categoryId],
      );
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      const code = await codeOf(f.tradeId);
      const party = tradeByCodeResponseSchema.parse(
        (await appFor(f.buyer).get(`/v1/trades/by-code/${code}`)).body,
      );
      expect(party.trade).toMatchObject({
        categoryCode: 'PHONES',
        categoryName: 'Phones',
        standardVersion: 3,
      });
      const byId = (await appFor(f.buyer).get(`/v1/trades/${f.tradeId}`)).body;
      expect(byId).toMatchObject({ categoryCode: 'PHONES', categoryName: 'Phones', standardVersion: 3 });

      // A trade with no category reports all three as null rather than a guess.
      const bare = await person(t);
      const none = await insertTrade(t.owner(), { seller: bare, role: 'SELLER' });
      const noneView = (await appFor(bare).get(`/v1/trades/${none}`)).body;
      expect(noneView).toMatchObject({ categoryCode: null, categoryName: null, standardVersion: null });
    });

    it('opens a preview for the named invitee, with no addresses and no fees, and the id to claim with', async () => {
      const inviter = await person(t);
      const invitee = await person(t);
      const { tradeId, tradeCode } = await invitedTrade(inviter, invitee);
      const res = await appFor(invitee).get(`/v1/trades/by-code/${tradeCode}`);
      expect(res.status).toBe(200);
      const body = tradeByCodeResponseSchema.parse(res.body);
      expect(body.access).toBe('INVITEE');
      expect(body.trade).toMatchObject({
        id: tradeId,
        status: 'PENDING_COUNTERPARTY',
        yourRole: 'BUYER',
        awaiting: 'YOU',
        fees: null,
      });
      const terms = (body.trade as unknown as { terms: Record<string, unknown> }).terms;
      expect(terms.deliveryAddress).toBeNull();
      expect(terms.shipsFromAddress).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('Adeola Odeku');
    });

    // The restriction under test: remove the party / named-invitee check in resolveTradeByCode and
    // every one of these returns 200.
    describe('is not an existence oracle', () => {
      const miss = 'KMT-0000001-NG';

      it('answers a stranger exactly as it answers a code that does not exist', async () => {
        const f = await tradeAt(t, 'PENDING_PAYMENT');
        const real = await codeOf(f.tradeId);
        const stranger = await person(t);
        const app = appFor(stranger);
        const notYours = await app.get(`/v1/trades/by-code/${real}`);
        const nonexistent = await app.get(`/v1/trades/by-code/${miss}`);
        expect(notYours.status).toBe(404);
        expect(nonexistent.status).toBe(404);
        expect(notYours.body).toEqual(nonexistent.body);
        expect(JSON.stringify(notYours.body)).not.toContain(real);
      });

      it('refuses a pending invitation claimed by SOMEONE ELSE, and one nobody has claimed, identically', async () => {
        const inviter = await person(t);
        const rightful = await person(t);
        const bystander = await person(t);
        const claimed = await invitedTrade(inviter, rightful);
        const unclaimed = await invitedTrade(inviter, null, 'PENDING');
        const app = appFor(bystander);
        const a = await app.get(`/v1/trades/by-code/${claimed.tradeCode}`);
        const b = await app.get(`/v1/trades/by-code/${unclaimed.tradeCode}`);
        const c = await app.get(`/v1/trades/by-code/${miss}`);
        for (const res of [a, b, c]) expect(res.status).toBe(404);
        expect(a.body).toEqual(c.body);
        expect(b.body).toEqual(c.body);
        // ...and the unclaimed invitation is not open to the person it was addressed to either, until
        // identity has claimed it for them (that, not a code, is what proves who they are).
        const addressed = appFor(rightful);
        expect((await addressed.get(`/v1/trades/by-code/${unclaimed.tradeCode}`)).status).toBe(404);
        expect((await addressed.get(`/v1/trades/by-code/${claimed.tradeCode}`)).status).toBe(200);
      });

      it('only honours an invitation that is CLAIMED, whatever else the row says', async () => {
        const inviter = await person(t);
        const invitee = await person(t);
        for (const status of ['PENDING', 'CANCELLED', 'EXPIRED'] as const) {
          const { tradeCode } = await invitedTrade(inviter, invitee, status);
          expect((await appFor(invitee).get(`/v1/trades/by-code/${tradeCode}`)).status, status).toBe(404);
        }
      });

      it('stops opening the preview once the trade has moved on without them', async () => {
        const inviter = await person(t);
        const invitee = await person(t);
        const { tradeId, tradeCode } = await invitedTrade(inviter, invitee);
        await t
          .owner()
          .query(
            `UPDATE trade.trades SET status = 'CANCELLED', status_revision = status_revision + 1, status_action = 'CANCEL', status_actor_type = 'SELLER', status_actor_id = $2, cancelled_at = now() WHERE id = $1`,
            [tradeId, inviter],
          );
        expect((await appFor(invitee).get(`/v1/trades/by-code/${tradeCode}`)).status).toBe(404);
      });

      it('answers a malformed code with 422 whoever asks, which says nothing about any real trade', async () => {
        const f = await tradeAt(t, 'PENDING_PAYMENT');
        const real = (await codeOf(f.tradeId)).toLowerCase();
        const stranger = await person(t);
        const res = await appFor(stranger).get(`/v1/trades/by-code/${real}`);
        const unknown = await appFor(stranger).get(`/v1/trades/by-code/kmt-0000001-ng`);
        expect(res.status).toBe(422);
        expect(res.body).toEqual(unknown.body);
      });
    });

    it('is rate limited hard: a few tries a minute, then 429', async () => {
      const stranger = await person(t);
      const app = appFor(stranger, `bycode-${randomUUID()}`);
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await app.get('/v1/trades/by-code/KMT-0000001-NG')).status);
      expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });
  });

  // ------------------------------------------------------------------------------------------
  describe('the single-trade view', () => {
    const addStandard = (versionNumber: number, minPhotos: number) =>
      t.owner().query<{ id: string }>(
        `INSERT INTO config.trade_standards
           (category_id, version_number, inspection_window_hours, item_spec_fields, proof_media,
            imei_verification, delivery_deadline_days, reason)
         VALUES ($1, $2, 72, '[]'::jsonb, $3::jsonb, false, 7, 'test')
         RETURNING id`,
        [standard.categoryId, versionNumber, JSON.stringify({ minPhotos, requireVideo: false })],
      );

    const seedCategory = () =>
      t.owner().query(
        `INSERT INTO config.trade_categories (id, code, name) VALUES ($1, 'PHONES', 'Phones')
         ON CONFLICT (code) DO NOTHING`,
        [standard.categoryId],
      );

    it('carries the id of the exact standard version the trade froze, and keeps it after a newer one is published', async () => {
      await seedCategory();
      const [{ id: pinnedId }] = (await addStandard(3, 4)).rows as [{ id: string }];
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      const before = (await appFor(f.buyer).get(`/v1/trades/${f.tradeId}`)).body;
      expect(before).toMatchObject({ standardVersion: 3, standardVersionId: pinnedId });

      // The category's standard is republished with a looser proof rule. The trade froze version 3.
      const [{ id: newerId }] = (await addStandard(4, 1)).rows as [{ id: string }];
      expect(newerId).not.toBe(pinnedId);
      const after = (await appFor(f.buyer).get(`/v1/trades/${f.tradeId}`)).body;
      expect(after).toMatchObject({ standardVersion: 3, standardVersionId: pinnedId });
      expect((await appFor(f.seller).get(`/v1/trades/${f.tradeId}`)).body.standardVersionId).toBe(pinnedId);

      // And the by-code view of the same trade says the same.
      const code = await codeOf(f.tradeId);
      const byCode = tradeByCodeResponseSchema.parse(
        (await appFor(f.buyer).get(`/v1/trades/by-code/${code}`)).body,
      );
      expect(byCode.trade.standardVersionId).toBe(pinnedId);
    });

    it('has no standard version id for a trade with no category', async () => {
      const bare = await person(t);
      const none = await insertTrade(t.owner(), { seller: bare, role: 'SELLER' });
      expect((await appFor(bare).get(`/v1/trades/${none}`)).body).toMatchObject({
        categoryCode: null,
        standardVersion: null,
        standardVersionId: null,
      });
    });

    it('carries the other party, as the list shows them, to each side', async () => {
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      await t
        .owner()
        .query(
          `UPDATE identity.users SET username = 'ada_seller', username_skeleton = 'adaseller' WHERE id = $1`,
          [f.seller],
        );
      avatars.set(f.seller, 'https://cdn.example/ada.jpg');
      const buyerView = (await appFor(f.buyer).get(`/v1/trades/${f.tradeId}`)).body;
      expect(buyerView.counterparty).toMatchObject({
        username: 'ada_seller',
        avatarUrl: 'https://cdn.example/ada.jpg',
      });
      // The seller sees the buyer, not themselves.
      const sellerView = (await appFor(f.seller).get(`/v1/trades/${f.tradeId}`)).body;
      expect(sellerView.counterparty.publicId).not.toBe(buyerView.counterparty.publicId);
      // The same display the list gives for the same trade.
      const [row] = tradeListResponseSchema.parse((await appFor(f.buyer).get('/v1/trades')).body).items;
      expect(buyerView.counterparty).toEqual(row!.counterparty);
      avatars.delete(f.seller);
    });

    it('withholds a handle that was hidden from discovery, and never volunteers contact details', async () => {
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      await t.owner().query(
        `UPDATE identity.users SET username = 'hidden_seller', username_skeleton = 'hiddenseller',
                discoverable_by_username = false WHERE id = $1`,
        [f.seller],
      );
      const res = await appFor(f.buyer).get(`/v1/trades/${f.tradeId}`);
      expect(res.body.counterparty.username).toBeNull();
      expect(Object.keys(res.body.counterparty as Record<string, unknown>).sort()).toEqual([
        'avatarUrl',
        'displayName',
        'publicId',
        'username',
      ]);
      expect(JSON.stringify(res.body.counterparty)).not.toMatch(/@|\+234|email|phone/i);
    });

    it('has no counterparty for an erased account, nor until the other side is bound', async () => {
      const f = await tradeAt(t, 'PENDING_PAYMENT');
      await t
        .owner()
        .query(
          `UPDATE identity.users SET status = 'ANONYMISED', username = NULL, username_skeleton = NULL WHERE id = $1`,
          [f.seller],
        );
      expect((await appFor(f.buyer).get(`/v1/trades/${f.tradeId}`)).body.counterparty).toBeNull();

      const inviter = await person(t);
      const { tradeId } = await invitedTrade(inviter, null, 'PENDING');
      expect((await appFor(inviter).get(`/v1/trades/${tradeId}`)).body.counterparty).toBeNull();
    });
  });
});
