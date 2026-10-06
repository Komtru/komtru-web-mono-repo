import { paginatedSchema, type SessionScope } from '@komtru/shared-types';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../src/app.js';
import { ApiError } from '../../../src/platform/errors.js';
import { loadConfig } from '../../../src/config/env.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import {
  ANONYMOUS_ACTOR,
  actorFor,
  type Actor,
  type Principal,
} from '../../../src/platform/http/principal.js';
import { defineRoute, type RouteDefinition, type RouteScope } from '../../../src/platform/http/route.js';
import { createLogger } from '../../../src/platform/logger.js';
import { testRedisUrl } from '../../support/db-urls.js';

/**
 * These tests are about parsing, pagination and the gates, not about auth, so every route they
 * mount gets a signed-in consumer. The enforcement itself has its own describe below.
 */
const signedIn: Actor = {
  key: 'user:0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b',
  principal: {
    userId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b',
    publicId: 'KMT-U-7F3K9Q',
    sessionId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c',
    familyId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5d',
    scope: 'CONSUMER',
    status: 'ACTIVE',
    sessionsEpoch: 1,
    amr: ['pwd'],
    roles: [],
    permissions: new Set<string>(),
    companyMembership: null,
  },
};
const asSignedIn = () => Promise.resolve(signedIn);

const config = loadConfig({
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://x@localhost/x',
  REDIS_URL: testRedisUrl(),
});
const logger = createLogger(config);

const appWith = (routes: RouteDefinition[], onUnexpected = () => {}) =>
  createApp({
    config,
    logger,
    onUnexpected,
    mountV1: mountRoutes(routes, { logger, resolveActor: asSignedIn }),
  });

const item = z.object({ id: z.uuid() });
const ID = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';

describe('mountRoutes', () => {
  it('parses params, query and body and hands the handler typed values', async () => {
    const seen = vi.fn();
    const app = appWith([
      defineRoute({
        method: 'post',
        path: '/trades/:id/offers',
        scope: 'CONSUMER',
        summary: 'Offer',
        retryable: false,
        schema: {
          params: z.object({ id: z.uuid() }),
          query: z.object({ dryRun: z.enum(['true', 'false']).default('false') }),
          body: z.object({ amountKobo: z.number().int() }),
          response: item,
        },
        handler: (ctx) => {
          seen(ctx.params, ctx.query, ctx.body);
          return Promise.resolve({ id: ID });
        },
      }),
    ]);

    const response = await request(app)
      .post(`/v1/trades/${ID}/offers`)
      .send({ amountKobo: 1000 })
      .expect(200);

    expect(response.body).toEqual({ id: ID });
    expect(seen).toHaveBeenCalledWith({ id: ID }, { dryRun: 'false' }, { amountKobo: 1000 });
  });

  it('answers 422 with field errors when the body does not match', async () => {
    const app = appWith([
      defineRoute({
        method: 'post',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'Open',
        retryable: false,
        schema: { body: z.object({ amountKobo: z.number().int() }), response: item },
        handler: () => Promise.resolve({ id: ID }),
      }),
    ]);

    const response = await request(app).post('/v1/trades').send({ amountKobo: 'lots' }).expect(422);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'amountKobo' }],
    });
  });

  it('accepts the declared status code', async () => {
    const app = appWith([
      defineRoute({
        method: 'post',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'Open',
        retryable: false,
        status: 201,
        schema: { response: item },
        handler: () => Promise.resolve({ id: ID }),
      }),
    ]);
    await request(app).post('/v1/trades').send({}).expect(201);
  });

  it('adds the pagination query to a cursor-paginated route', async () => {
    const seen = vi.fn();
    const app = appWith([
      defineRoute({
        method: 'get',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'List',
        paginated: 'cursor',
        schema: { response: paginatedSchema(item) },
        handler: (ctx) => {
          seen(ctx.query);
          return Promise.resolve({ items: [], nextCursor: null });
        },
      }),
    ]);

    await request(app).get('/v1/trades?limit=5').expect(200);
    expect(seen).toHaveBeenCalledWith({ limit: 5 });

    await request(app).get('/v1/trades').expect(200);
    expect(seen).toHaveBeenLastCalledWith({ limit: 20 });
  });

  it('rejects a limit above the maximum rather than clamping it silently', async () => {
    const app = appWith([
      defineRoute({
        method: 'get',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'List',
        paginated: 'cursor',
        schema: { response: paginatedSchema(item) },
        handler: () => Promise.resolve({ items: [], nextCursor: null }),
      }),
    ]);
    await request(app).get('/v1/trades?limit=1000').expect(422);
  });

  it("keeps a route's own query schema alongside the pagination one", async () => {
    const seen = vi.fn();
    const app = appWith([
      defineRoute({
        method: 'get',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'List',
        paginated: 'cursor',
        schema: {
          query: z.object({ status: z.enum(['OPEN', 'CLOSED']).optional() }),
          response: paginatedSchema(item),
        },
        handler: (ctx) => {
          seen(ctx.query);
          return Promise.resolve({ items: [], nextCursor: null });
        },
      }),
    ]);

    await request(app).get('/v1/trades?status=OPEN&limit=3').expect(200);
    expect(seen).toHaveBeenCalledWith({ status: 'OPEN', limit: 3 });
  });

  it("treats a response that breaks its own schema as a server bug, not the caller's problem", async () => {
    const onUnexpected = vi.fn();
    const app = appWith(
      [
        defineRoute({
          method: 'get',
          path: '/trades/:id',
          scope: 'CONSUMER',
          summary: 'One',
          schema: { params: z.object({ id: z.uuid() }), response: item },
          handler: () => Promise.resolve({ id: 'not-a-uuid' }),
        }),
      ],
      onUnexpected,
    );

    const response = await request(app).get(`/v1/trades/${ID}`).expect(500);
    expect(response.body).toMatchObject({ code: 'INTERNAL' });
    expect(onUnexpected).toHaveBeenCalled();
  });

  it('refuses to mount a registry that breaks an invariant', () => {
    expect(() =>
      mountRoutes(
        [
          defineRoute({
            method: 'get',
            path: '/trades',
            scope: 'CONSUMER',
            summary: 'List',
            schema: { response: paginatedSchema(item) },
            handler: () => Promise.resolve({ items: [], nextCursor: null }),
          }),
        ],
        { logger },
      ),
    ).toThrow(/paginated/);
  });

  it('runs the idempotency gate only on routes that declare retryable', async () => {
    const guarded: string[] = [];
    const idempotency = vi.fn((ctx: { route: RouteDefinition }, run: () => Promise<unknown>) => {
      guarded.push(ctx.route.path);
      return run();
    });
    const routes = [
      defineRoute({
        method: 'post',
        path: '/retryable',
        scope: 'CONSUMER',
        summary: 'Retryable',
        retryable: true,
        schema: { response: item },
        handler: () => Promise.resolve({ id: ID }),
      }),
      defineRoute({
        method: 'post',
        path: '/not-retryable',
        scope: 'CONSUMER',
        summary: 'Not retryable',
        retryable: false,
        schema: { response: item },
        handler: () => Promise.resolve({ id: ID }),
      }),
    ];
    const app = createApp({
      config,
      logger,
      mountV1: mountRoutes(routes, {
        logger,
        idempotency: idempotency as never,
        resolveActor: asSignedIn,
      }),
    });

    await request(app).post('/v1/retryable').send({}).expect(200);
    await request(app).post('/v1/not-retryable').send({}).expect(200);
    expect(guarded).toEqual(['/retryable']);
  });
});

describe('mountRoutes scope and permission enforcement', () => {
  const probe = (scope: RouteScope, permission?: string, seen?: (actor: Actor) => void) =>
    defineRoute({
      method: 'get',
      path: '/thing',
      scope,
      summary: 'Probe',
      ...(permission ? { permission } : {}),
      schema: { response: item },
      handler: (ctx) => {
        seen?.(ctx.actor);
        return Promise.resolve({ id: ID });
      },
    });

  const principal = (scope: SessionScope, permissions: string[] = []): Principal => ({
    userId: ID,
    publicId: 'KMT-U-7F3K9Q',
    sessionId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c',
    familyId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5d',
    scope,
    status: 'ACTIVE',
    sessionsEpoch: 1,
    amr: ['pwd'],
    roles: [],
    permissions: new Set(permissions),
    companyMembership: null,
  });

  const withActor = (routes: RouteDefinition[], actor: Actor) =>
    createApp({
      config,
      logger,
      mountV1: mountRoutes(routes, { logger, resolveActor: () => Promise.resolve(actor) }),
    });

  it('answers 401 and asks for a bearer token when a scoped route gets no credential', async () => {
    const response = await request(withActor([probe('CONSUMER')], ANONYMOUS_ACTOR))
      .get('/v1/thing')
      .expect(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(response.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it.each([
    ['TOKEN_EXPIRED', 'TOKEN_EXPIRED'],
    ['SESSION_REVOKED', 'SESSION_REVOKED'],
    ['SESSION_EXPIRED', 'SESSION_REVOKED'],
    ['EPOCH_STALE', 'SESSION_REVOKED'],
    ['USER_INACTIVE', 'SESSION_REVOKED'],
    ['TOKEN_INVALID', 'UNAUTHENTICATED'],
  ] as const)(
    'reports the %s failure as %s so the client knows whether to refresh',
    async (failure, code) => {
      const response = await request(withActor([probe('CONSUMER')], { ...ANONYMOUS_ACTOR, failure }))
        .get('/v1/thing')
        .expect(401);
      expect(response.body).toMatchObject({ code });
    },
  );

  it('answers 403, never 401, when a session of another scope calls the route', async () => {
    const response = await request(withActor([probe('STAFF')], actorFor(principal('CONSUMER'))))
      .get('/v1/thing')
      .expect(403);
    expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers 403 without the route permission and runs the handler with it', async () => {
    await request(withActor([probe('STAFF', 'user.suspend')], actorFor(principal('STAFF'))))
      .get('/v1/thing')
      .expect(403);
    await request(withActor([probe('STAFF', 'user.suspend')], actorFor(principal('STAFF', ['user.suspend']))))
      .get('/v1/thing')
      .expect(200);
  });

  it('leaves a PUBLIC route anonymous rather than failing when the credential is bad', async () => {
    const seen = vi.fn();
    await request(
      withActor([probe('PUBLIC', undefined, seen)], { ...ANONYMOUS_ACTOR, failure: 'TOKEN_EXPIRED' }),
    )
      .get('/v1/thing')
      .expect(200);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ key: 'anon', principal: null }));
  });

  it('hands the handler the principal and keys on user:<id>', async () => {
    const seen = vi.fn();
    const actor = actorFor(principal('CONSUMER'));
    await request(withActor([probe('CONSUMER', undefined, seen)], actor))
      .get('/v1/thing')
      .expect(200);
    expect(actor.key).toBe(`user:${ID}`);
    expect(seen).toHaveBeenCalledWith(actor);
  });

  it('refuses the request before the rate limiter spends a point on it', async () => {
    const rateLimit = vi.fn(() => Promise.resolve());
    const route: RouteDefinition = {
      ...probe('STAFF'),
      rateLimit: { points: 1, durationSeconds: 60, by: ['ip'] },
    };
    const app = createApp({
      config,
      logger,
      mountV1: mountRoutes([route], {
        logger,
        rateLimit,
        resolveActor: () => Promise.resolve(ANONYMOUS_ACTOR),
      }),
    });
    await request(app).get('/v1/thing').expect(401);
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe('problem extension members', () => {
  it('carries an ApiError extension into the body without letting it overwrite the known fields', async () => {
    const route = defineRoute({
      method: 'post',
      path: '/otp',
      scope: 'PUBLIC',
      summary: 'Verify',
      retryable: false,
      schema: { body: z.object({}), response: z.object({ ok: z.boolean() }) },
      handler: () => {
        throw new ApiError(422, 'OTP_INVALID', 'That code does not match', 'Check the SMS', undefined, {
          attemptsRemaining: 2,
          // An extension must never be able to rewrite what the client branches on.
          code: 'INTERNAL',
          status: 500,
        });
      },
    });
    const response = await request(appWith([route]))
      .post('/v1/otp')
      .send({});
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'OTP_INVALID',
      status: 422,
      attemptsRemaining: 2,
    });
  });
});
