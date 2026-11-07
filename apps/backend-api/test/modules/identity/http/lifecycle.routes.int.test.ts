/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- raw `pg` rows and supertest bodies are untyped in assertions */
// T-039 over HTTP: GET /me, close, the NDPA requests and account recovery, through the real login.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, outboxEventTypes, redisReady } from '../support.js';
import {
  PASSWORD,
  bodyOf,
  buildApp,
  seedCatalogue,
  seedMember,
  staffSession,
  type Page,
  type Problem,
  type SessionBody,
} from './staff.support.js';

interface Me {
  id: string;
  publicId: string;
  account: {
    status: string;
    noticeKey: string | null;
    openTrades: boolean | null;
    canClose: boolean;
    abilities: { buy: boolean };
  };
}

describe.runIf(infraEnabled)('the account lifecycle routes (T-039)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let app: Express;
  let tradeOpen = false;

  beforeEach(async () => {
    tradeOpen = false;
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    app = buildApp(t, redis, { hasActiveTrades: () => Promise.resolve(tradeOpen) });
  });
  afterAll(() => {
    redis?.disconnect();
  });

  const signedIn = async () => {
    const member = await seedMember(t, app);
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: member.email, password: PASSWORD });
    expect(login.status).toBe(200);
    return { ...member, token: bodyOf<SessionBody>(login).accessToken };
  };

  const as = (token: string) => ({
    get: (path: string) => request(app).get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object = {}) =>
      request(app).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  const statusOf = async (userId: string) =>
    (await t.owner().query(`SELECT status::text FROM identity.users WHERE id = $1`, [userId])).rows[0]
      ?.status;

  describe('GET /me', () => {
    it('needs a session', async () => {
      expect((await request(app).get('/v1/me')).status).toBe(401);
    });

    it('returns the account block the suspension and close screens read', async () => {
      const me = await signedIn();
      const response = await as(me.token).get('/me');
      expect(response.status).toBe(200);
      expect(bodyOf<Me>(response)).toMatchObject({
        id: me.userId,
        account: { noticeKey: null, openTrades: false, canClose: true, abilities: { buy: true } },
      });
    });

    it('shows a restricted account its restriction, without the staff reason', async () => {
      const me = await signedIn();
      await t
        .owner()
        .query(
          `UPDATE identity.users SET status = 'RESTRICTED', status_reason = 'fraud ring 7' WHERE id = $1`,
          [me.userId],
        );
      const response = await as(me.token).get('/me');
      expect(response.status).toBe(200);
      expect(bodyOf<Me>(response).account).toMatchObject({
        status: 'RESTRICTED',
        noticeKey: 'ACCOUNT_RESTRICTED',
        abilities: { buy: false },
        canClose: false,
      });
      expect(JSON.stringify(response.body)).not.toContain('fraud ring');
    });

    it('reports an open trade so CA1 can say why closing is unavailable', async () => {
      const me = await signedIn();
      tradeOpen = true;
      expect(bodyOf<Me>(await as(me.token).get('/me')).account).toMatchObject({
        openTrades: true,
        canClose: false,
      });
    });
  });

  describe('POST /me/close', () => {
    it('closes the account behind the password and ends the session', async () => {
      const me = await signedIn();
      const response = await as(me.token).post('/me/close', { reason: 'leaving', password: PASSWORD });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'CLOSED' });
      expect(await statusOf(me.userId)).toBe('CLOSED');
      expect((await as(me.token).get('/me')).status).toBe(401);
      // And the same credentials no longer sign in.
      expect(
        (await request(app).post('/v1/auth/login').send({ identifier: me.email, password: PASSWORD })).status,
      ).toBe(401);
    });

    it('is refused while a trade is active, with the reason a client can branch on (CA2)', async () => {
      const me = await signedIn();
      tradeOpen = true;
      const response = await as(me.token).post('/me/close', { reason: 'leaving', password: PASSWORD });
      expect(response.status).toBe(409);
      expect(bodyOf<Problem & { reason?: string }>(response).reason).toBe('ACTIVE_TRADES');
      expect(await statusOf(me.userId)).toBe('ACTIVE');
    });

    it('rejects a wrong password and a missing reason', async () => {
      const me = await signedIn();
      expect((await as(me.token).post('/me/close', { reason: 'x', password: 'nope' })).status).toBe(401);
      expect((await as(me.token).post('/me/close', { password: PASSWORD })).status).toBe(422);
      expect(await statusOf(me.userId)).toBe('ACTIVE');
    });
  });

  describe('POST /me/data-export and /me/erasure-request', () => {
    it('answers an export request once, however often it is tapped', async () => {
      const me = await signedIn();
      const first = await as(me.token).post('/me/data-export');
      const second = await as(me.token).post('/me/data-export');
      expect(first.status).toBe(202);
      expect(first.body).toMatchObject({ outcome: 'REQUESTED' });
      expect(second.body).toMatchObject({
        outcome: 'ALREADY_REQUESTED',
        requestedAt: first.body.requestedAt,
      });
      expect(
        (await outboxEventTypes(t.owner())).filter((e) => e === 'identity.account.data_export_requested'),
      ).toHaveLength(1);
    });

    it('closes the account and hands the erasure to compliance', async () => {
      const me = await signedIn();
      const response = await as(me.token).post('/me/erasure-request', {
        reason: 'erase',
        password: PASSWORD,
      });
      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({ status: 'CLOSED' });
      expect(await statusOf(me.userId)).toBe('CLOSED');
      expect(await outboxEventTypes(t.owner())).toContain('identity.account.erasure_requested');
    });
  });

  describe('account recovery', () => {
    it('is public, and answers a known and an unknown identifier alike', async () => {
      const locked = await signedIn();
      await t.owner().query(`UPDATE identity.users SET status = 'LOCKED' WHERE id = $1`, [locked.userId]);

      const known = await request(app)
        .post('/v1/auth/recovery-requests')
        .send({ identifier: locked.email, method: 'LOST_ALL' });
      const unknown = await request(app)
        .post('/v1/auth/recovery-requests')
        .send({ identifier: 'ghost@example.com', method: 'LOST_ALL' });

      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());
      expect(known.body.status).toBe('RECEIVED');
      expect(
        (await outboxEventTypes(t.owner())).filter((e) => e === 'identity.account.recovery_requested'),
      ).toHaveLength(1);
    });

    it('lets a reviewer approve it, which unlocks the account', async () => {
      const locked = await signedIn();
      await t.owner().query(`UPDATE identity.users SET status = 'LOCKED' WHERE id = $1`, [locked.userId]);
      const receipt = await request(app)
        .post('/v1/auth/recovery-requests')
        .send({ identifier: locked.email, method: 'MFA_LOCKOUT' });

      const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
      const token = await staffSession(app, member);

      const queue = await as(token).get('/admin/recovery-requests?status=PENDING&reason=review');
      expect(queue.status).toBe(200);
      expect(bodyOf<Page<{ id: string; userId: string }>>(queue).items.map((i) => i.id)).toContain(
        receipt.body.requestId,
      );

      const decision = await as(token).post(`/admin/recovery-requests/${receipt.body.requestId}/decision`, {
        decision: 'APPROVE',
        reason: 'verified on a call',
      });
      expect(decision.status).toBe(200);
      expect(decision.body).toMatchObject({ status: 'COMPLETED', unlocked: true });
      expect(await statusOf(locked.userId)).toBe('ACTIVE');
    });

    it('keeps the review queue away from a consumer session and from a role without the permission', async () => {
      const consumer = await signedIn();
      expect((await as(consumer.token).get('/admin/recovery-requests?reason=x')).status).toBe(403);

      const agent = await seedMember(t, app, { roles: ['SUPPORT_AGENT'], mfa: true });
      const token = await staffSession(app, agent);
      expect((await as(token).get('/admin/recovery-requests?reason=x')).status).toBe(403);
    });

    it('needs a reason on a decision (a 400, as every admin write)', async () => {
      const member = await seedMember(t, app, { roles: ['OPERATIONS_ADMIN'], mfa: true });
      const token = await staffSession(app, member);
      const response = await as(token).post(
        '/admin/recovery-requests/11111111-1111-4111-8111-111111111111/decision',
        {
          decision: 'REJECT',
        },
      );
      expect(response.status).toBe(400);
    });
  });
});
