// T-031 over HTTP: the JWKS, the refresh dance the api-client performs on a 401, logout, and the
// scope isolation suite. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { SESSION_SCOPES, type SessionScope } from '@komtru/shared-types';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../src/app.js';
import { createIdentityAuth, type IdentityAuth } from '../../../src/modules/identity/index.js';
import {
  applyKillSwitch,
  createSession,
  type IssuedSession,
} from '../../../src/modules/identity/services/session.service.js';
import { createIdempotencyGate } from '../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../src/platform/http/rateLimit.js';
import { defineRoute } from '../../../src/platform/http/route.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { createTestRedis, seedUser, testConfig, testLogger } from './support.js';

/** A route per scope, so a token can be pointed at a router it does not belong to. */
const probe = (scope: SessionScope) =>
  defineRoute({
    method: 'get',
    path: `/_probe/${scope.toLowerCase()}`,
    scope,
    summary: 'Probe',
    schema: { response: z.object({ userId: z.uuid(), scope: z.string() }) },
    handler: (ctx) =>
      Promise.resolve({
        userId: ctx.actor.principal!.userId,
        scope: ctx.actor.principal!.scope,
      }),
  });

describe.runIf(infraEnabled)('the session routes', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let auth: IdentityAuth;
  let app: Express;

  beforeEach(() => {
    redis ??= createTestRedis();
    auth = createIdentityAuth({ db: t.db(), redis, config, logger: testLogger });
    app = createApp({
      config,
      logger: testLogger,
      mountV1: mountRoutes([...(auth.routes ?? []), ...SESSION_SCOPES.map(probe)], {
        logger: testLogger,
        idempotency: createIdempotencyGate({ db: t.db(), redis, logger: testLogger }),
        rateLimit: createRateLimitGate({ redis, logger: testLogger }),
        resolveActor: auth.resolveActor,
      }),
    });
  });

  afterAll(async () => {
    await redis?.flushdb();
    redis?.disconnect();
  });

  const login = async (scope: SessionScope = 'CONSUMER'): Promise<IssuedSession & { userId: string }> => {
    const { userId } = await seedUser(t.app());
    const session = await t.db().transaction((tx) =>
      createSession(
        tx,
        { signer: auth.signer, epochs: auth.epochs, logger: testLogger },
        {
          userId,
          scope,
          amr: ['pwd'],
        },
      ),
    );
    return { ...session, userId };
  };

  const probePath = (scope: SessionScope) => `/v1/_probe/${scope.toLowerCase()}`;

  describe('GET /.well-known/jwks.json', () => {
    it('serves the public key and never the private one', async () => {
      const response = await request(app).get('/v1/.well-known/jwks.json').expect(200);
      const body = response.body as { keys: Record<string, unknown>[] };
      expect(body.keys).toHaveLength(1);
      expect(body.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', kid: 'test-key' });
      expect(body.keys[0]).not.toHaveProperty('d');
      expect(JSON.stringify(body)).not.toContain(config.identity.signingKey);
    });

    it('needs no credential', async () => {
      await request(app).get('/v1/.well-known/jwks.json').set('Authorization', 'Bearer rubbish').expect(200);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates and returns a token the scoped route accepts', async () => {
      const issued = await login();
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: issued.refreshToken })
        .expect(200);
      const body = response.body as {
        accessToken: string;
        refreshToken: string;
        scope: string;
        expiresIn: number;
      };
      expect(body).toMatchObject({ scope: 'CONSUMER', expiresIn: 600 });
      expect(body.refreshToken).not.toBe(issued.refreshToken);

      const probed = await request(app)
        .get(probePath('CONSUMER'))
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      expect(probed.body).toEqual({ userId: issued.userId, scope: 'CONSUMER' });
    });

    it('answers 401 SESSION_REVOKED to a replay, which is what signs the client out', async () => {
      const issued = await login();
      await request(app).post('/v1/auth/refresh').send({ refreshToken: issued.refreshToken }).expect(200);
      const replay = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: issued.refreshToken })
        .expect(401);
      expect(replay.body).toMatchObject({ code: 'SESSION_REVOKED' });
    });

    it('answers 401 UNAUTHENTICATED to a token nobody minted', async () => {
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'never-minted' })
        .expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('refuses a refresh for a suspended user, whose token is otherwise still valid', async () => {
      const issued = await login();
      await t.app().query(`UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1`, [issued.userId]);
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: issued.refreshToken })
        .expect(401);
      expect(response.body).toMatchObject({ code: 'SESSION_REVOKED' });
    });

    it('never stores the tokens it mints, even when the client sends an idempotency key', async () => {
      const issued = await login();
      await request(app)
        .post('/v1/auth/refresh')
        .set('Idempotency-Key', randomUUID())
        .send({ refreshToken: issued.refreshToken })
        .expect(200);
      // `retryable: false` is what keeps this empty. A stored response would hold both the access
      // token and the new refresh token as plaintext jsonb for 24 hours, undoing refresh_token_hash.
      const { rows } = await t
        .app()
        .query<{ n: string }>(`SELECT count(*) AS n FROM platform.idempotency_keys`);
      expect(Number(rows[0]!.n)).toBe(0);
    });

    it('rejects a body that tries to ask for a scope', async () => {
      const issued = await login();
      await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: issued.refreshToken, scope: 'STAFF' })
        .expect(422);
    });
  });

  describe('a 401 on a resource route', () => {
    it('reports a lapsed access token as TOKEN_EXPIRED, so the client refreshes', async () => {
      const issued = await login();
      const shortLived = createIdentityAuth({
        db: t.db(),
        redis,
        config: testConfig({
          IDENTITY_SIGNING_KEY: config.identity.signingKey!,
          IDENTITY_SIGNING_KEY_ID: 'test-key',
          IDENTITY_ACCESS_TOKEN_TTL_SECONDS: '60',
        }),
        logger: testLogger,
      });
      const stale = await shortLived.signer.sign(
        { sub: issued.userId, sid: issued.sessionId, scp: 'CONSUMER', epc: 1 },
        { now: new Date(Date.now() - 600_000) },
      );
      const response = await request(app)
        .get(probePath('CONSUMER'))
        .set('Authorization', `Bearer ${stale}`)
        .expect(401);
      expect(response.body).toMatchObject({ code: 'TOKEN_EXPIRED' });
      expect(response.headers['www-authenticate']).toContain('invalid_token');
    });

    it('reports a logged-out session as SESSION_REVOKED, so the client signs out', async () => {
      const issued = await login();
      await request(app)
        .get(probePath('CONSUMER'))
        .set('Authorization', `Bearer ${issued.accessToken}`)
        .expect(200);

      await request(app).post('/v1/auth/logout').send({ refreshToken: issued.refreshToken }).expect(200);

      const response = await request(app)
        .get(probePath('CONSUMER'))
        .set('Authorization', `Bearer ${issued.accessToken}`)
        .expect(401);
      expect(response.body).toMatchObject({ code: 'SESSION_REVOKED' });
      await request(app).post('/v1/auth/refresh').send({ refreshToken: issued.refreshToken }).expect(401);
    });

    it('stops working within one request of a suspension', async () => {
      const issued = await login();
      await request(app)
        .get(probePath('CONSUMER'))
        .set('Authorization', `Bearer ${issued.accessToken}`)
        .expect(200);

      await applyKillSwitch(
        t.db(),
        { signer: auth.signer, epochs: auth.epochs, logger: testLogger },
        { userId: issued.userId, reason: 'fraud' },
      );

      await request(app)
        .get(probePath('CONSUMER'))
        .set('Authorization', `Bearer ${issued.accessToken}`)
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('answers the same way for a real token and an invented one', async () => {
      const issued = await login();
      const real = await request(app)
        .post('/v1/auth/logout')
        .send({ refreshToken: issued.refreshToken })
        .expect(200);
      const invented = await request(app)
        .post('/v1/auth/logout')
        .send({ refreshToken: 'never-minted' })
        .expect(200);
      expect(real.body).toEqual(invented.body);
    });

    it('ends every session on every device when asked', async () => {
      const first = await login();
      const second = await t.db().transaction((tx) =>
        createSession(
          tx,
          { signer: auth.signer, epochs: auth.epochs, logger: testLogger },
          {
            userId: first.userId,
            scope: 'CONSUMER',
            amr: ['pwd'],
          },
        ),
      );
      await request(app)
        .post('/v1/auth/logout')
        .send({ refreshToken: first.refreshToken, allDevices: true })
        .expect(200);
      await request(app)
        .get(probePath('CONSUMER'))
        .set('Authorization', `Bearer ${second.accessToken}`)
        .expect(401);
    });
  });

  describe('scope isolation', () => {
    it.each(
      SESSION_SCOPES.flatMap((held) =>
        SESSION_SCOPES.filter((route) => route !== held).map((route) => [held, route] as const),
      ),
    )('refuses a %s session on a %s route with 403, never 401', async (held, routeScope) => {
      const issued = await login(held);
      const response = await request(app)
        .get(probePath(routeScope))
        .set('Authorization', `Bearer ${issued.accessToken}`)
        .expect(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    });

    it.each(SESSION_SCOPES)('admits a %s session on its own route', async (scope) => {
      const issued = await login(scope);
      const response = await request(app)
        .get(probePath(scope))
        .set('Authorization', `Bearer ${issued.accessToken}`)
        .expect(200);
      expect(response.body).toMatchObject({ scope });
    });

    it('cannot turn a consumer refresh token into a staff session', async () => {
      const issued = await login('CONSUMER');
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: issued.refreshToken })
        .expect(200);
      const body = response.body as { scope: string; accessToken: string };
      expect(body.scope).toBe('CONSUMER');
      await request(app)
        .get(probePath('STAFF'))
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(403);
    });
  });
});
