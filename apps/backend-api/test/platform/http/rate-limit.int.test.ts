// Rate limiting against real Redis. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../src/platform/http/rateLimit.js';
import { defineRoute, type RateLimitSpec } from '../../../src/platform/http/route.js';
import { createLogger } from '../../../src/platform/logger.js';
import { createRedis } from '../../../src/platform/redis/connections.js';
import { infraEnabled, testRedisUrl } from '../../support/db-urls.js';

const REDIS_URL = testRedisUrl();
const config = loadConfig({
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://x@localhost/x',
  REDIS_URL,
});
const logger = createLogger(config);
const clients = [createRedis(REDIS_URL), createRedis(REDIS_URL)];

// The app client has no offline queue (T-023), so a command sent while it is still connecting fails
// outright — the same reason health readiness waits for `ready` before an instance takes traffic.
beforeAll(async () => {
  for (const client of clients) {
    if (client.status !== 'ready') await new Promise((resolve) => client.once('ready', resolve));
  }
});

afterAll(async () => {
  for (const client of clients) await client.quit().catch(() => client.disconnect());
});

const loginRoute = (rateLimit: RateLimitSpec, handler = () => Promise.resolve({ ok: true })) =>
  defineRoute({
    method: 'post',
    path: '/auth/login',
    scope: 'PUBLIC',
    summary: 'Log in',
    retryable: false,
    rateLimit,
    schema: {
      body: z.object({ email: z.string().optional(), deviceFingerprint: z.string().optional() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler,
  });

/** `instance` picks which Redis client the limiter uses, standing in for a second API process. */
const appWith = (spec: RateLimitSpec, instance = 0, handler?: () => Promise<{ ok: boolean }>) => {
  const gate = createRateLimitGate({ redis: clients[instance]!, logger, keyPrefix: `test-${randomUUID()}` });
  return createApp({
    config,
    logger,
    mountV1: mountRoutes([loginRoute(spec, handler)], { logger, rateLimit: gate }),
  });
};

describe.runIf(infraEnabled)('rate limiting', () => {
  it('lets the budget through and refuses the next request with Retry-After', async () => {
    const app = appWith({ points: 2, durationSeconds: 60, by: ['ip'] });

    await request(app).post('/v1/auth/login').send({}).expect(200);
    await request(app).post('/v1/auth/login').send({}).expect(200);
    const limited = await request(app).post('/v1/auth/login').send({}).expect(429);

    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['ratelimit-limit']).toBe('2');
    expect(limited.headers['ratelimit-remaining']).toBe('0');
    expect(Number(limited.headers['ratelimit-reset'])).toBeGreaterThan(0);
  });

  it('reports what is left on a request that is allowed', async () => {
    const app = appWith({ points: 5, durationSeconds: 60, by: ['ip'] });
    const first = await request(app).post('/v1/auth/login').send({}).expect(200);
    expect(first.headers['ratelimit-remaining']).toBe('4');
  });

  it('shares one budget across two API instances', async () => {
    // Both apps must use the same key prefix: this is the statelessness requirement, that the
    // limit is the fleet's and not each process's.
    const prefix = `test-${randomUUID()}`;
    const apps = clients.map((redis) =>
      createApp({
        config,
        logger,
        mountV1: mountRoutes([loginRoute({ points: 2, durationSeconds: 60, by: ['ip'] })], {
          logger,
          rateLimit: createRateLimitGate({ redis, logger, keyPrefix: prefix }),
        }),
      }),
    );

    await request(apps[0]!).post('/v1/auth/login').send({}).expect(200);
    await request(apps[1]!).post('/v1/auth/login').send({}).expect(200);
    await request(apps[0]!).post('/v1/auth/login').send({}).expect(429);
    await request(apps[1]!).post('/v1/auth/login').send({}).expect(429);
  });

  it('counts each identifier separately', async () => {
    const app = appWith({
      points: 1,
      durationSeconds: 60,
      by: ['identifier'],
      identifierFrom: ({ body }) => (body as { email?: string }).email,
    });

    await request(app).post('/v1/auth/login').send({ email: 'a@komtru.com' }).expect(200);
    await request(app).post('/v1/auth/login').send({ email: 'b@komtru.com' }).expect(200);
    await request(app).post('/v1/auth/login').send({ email: 'a@komtru.com' }).expect(429);
  });

  it('skips the identifier key when the request carries none, rather than lumping them together', async () => {
    const app = appWith({
      points: 1,
      durationSeconds: 60,
      by: ['identifier'],
      identifierFrom: ({ body }) => (body as { email?: string }).email,
    });

    await request(app).post('/v1/auth/login').send({}).expect(200);
    await request(app).post('/v1/auth/login').send({}).expect(200);
  });

  it('charges every declared key, so the strictest one wins', async () => {
    const app = appWith({
      points: 1,
      durationSeconds: 60,
      by: ['ip', 'identifier'],
      identifierFrom: ({ body }) => (body as { email?: string }).email,
    });

    await request(app).post('/v1/auth/login').send({ email: 'a@komtru.com' }).expect(200);
    // A different identifier, but the same IP: the IP budget is spent.
    await request(app).post('/v1/auth/login').send({ email: 'b@komtru.com' }).expect(429);
  });

  it('refuses the request when Redis cannot answer, rather than letting it through', async () => {
    const broken = createRedis('redis://localhost:1');
    const app = createApp({
      config,
      logger,
      mountV1: mountRoutes([loginRoute({ points: 1, durationSeconds: 60, by: ['ip'] })], {
        logger,
        rateLimit: createRateLimitGate({ redis: broken, logger, keyPrefix: `test-${randomUUID()}` }),
      }),
    });

    const response = await request(app).post('/v1/auth/login').send({}).expect(503);
    expect(response.body).toMatchObject({ code: 'INTERNAL' });
    broken.disconnect();
  }, 20_000);

  it('does not charge the budget of a route that declares no limit', async () => {
    const handler = vi.fn(() => Promise.resolve({ ok: true }));
    const gate = createRateLimitGate({ redis: clients[0]!, logger, keyPrefix: `test-${randomUUID()}` });
    const app = createApp({
      config,
      logger,
      mountV1: mountRoutes(
        [
          defineRoute({
            method: 'get',
            path: '/health-ish',
            scope: 'PUBLIC',
            summary: 'Unlimited',
            schema: { response: z.object({ ok: z.boolean() }) },
            handler,
          }),
        ],
        { logger, rateLimit: gate },
      ),
    });

    for (let i = 0; i < 5; i += 1) await request(app).get('/v1/health-ish').expect(200);
    expect(handler).toHaveBeenCalledTimes(5);
  });
});

describe.runIf(infraEnabled)('the per-device budget (M1 §17)', () => {
  const spec: RateLimitSpec = {
    points: 1,
    durationSeconds: 60,
    by: ['device'],
    deviceFrom: ({ body }) => (body as { deviceFingerprint?: string }).deviceFingerprint,
  };

  it('counts one fingerprint across different IPs and different identifiers', async () => {
    const app = appWith(spec);
    const send = (ip: string, email: string) =>
      request(app)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, deviceFingerprint: 'fp-one' });

    expect((await send('203.0.113.1', 'a@example.com')).status).toBe(200);
    // A second IP and a second identifier: neither of the other two keys would have stopped this.
    expect((await send('203.0.113.2', 'b@example.com')).status).toBe(429);
  });

  it('leaves a different fingerprint its own budget', async () => {
    const app = appWith(spec);
    const send = (fingerprint: string) =>
      request(app).post('/v1/auth/login').send({ deviceFingerprint: fingerprint });
    expect((await send('fp-a')).status).toBe(200);
    expect((await send('fp-b')).status).toBe(200);
    expect((await send('fp-a')).status).toBe(429);
  });

  it('skips the key rather than sharing one bucket when the body carries no fingerprint', async () => {
    const app = appWith(spec);
    const send = () => request(app).post('/v1/auth/login').send({});
    expect((await send()).status).toBe(200);
    // An unmetered caller is the deliberate choice: collapsing every fingerprint-less client into
    // one bucket would let any one of them lock out all the others.
    expect((await send()).status).toBe(200);
  });
});
