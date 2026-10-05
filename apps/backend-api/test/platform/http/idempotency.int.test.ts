// Idempotency against real Postgres and Redis. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import {
  createIdempotencyGate,
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
} from '../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { defineRoute } from '../../../src/platform/http/route.js';
import { createLogger } from '../../../src/platform/logger.js';
import { createRedis } from '../../../src/platform/redis/connections.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

const REDIS_URL = 'redis://localhost:56379';
const config = loadConfig({
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://x@localhost/x',
  REDIS_URL,
});
const logger = createLogger(config);
const redis = createRedis(REDIS_URL);

afterAll(async () => void (await redis.quit().catch(() => redis.disconnect())));

describe.runIf(infraEnabled)('idempotency', () => {
  const t = useTestDatabase();

  const buildApp = (handler: () => Promise<{ id: string }>, options = {}) => {
    const gate = createIdempotencyGate({ db: t.db(), redis, logger, lockWaitMs: 500, ...options });
    const routes = [
      defineRoute({
        method: 'post',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'Open a trade',
        retryable: true,
        status: 201,
        schema: { body: z.object({ amountKobo: z.number().int() }), response: z.object({ id: z.uuid() }) },
        handler,
      }),
    ];
    return createApp({ config, logger, mountV1: mountRoutes(routes, { logger, idempotency: gate }) });
  };

  const rows = () =>
    t
      .app()
      .query<{ key: string; actor: string; status: number | null; completed_at: Date | null }>(
        'SELECT key, actor, status, completed_at FROM platform.idempotency_keys',
      );

  it('runs once and replays the stored response for the same key and body', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler);
    const key = randomUUID();

    const first = await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 1000 })
      .expect(201);
    const second = await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 1000 })
      .expect(201);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
    expect(first.headers[REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
    expect(second.headers[REPLAYED_HEADER.toLowerCase()]).toBe('true');
    expect((await rows()).rows).toHaveLength(1);
  });

  it('answers 422 when the same key arrives with a different body', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler);
    const key = randomUUID();

    await request(app).post('/v1/trades').set(IDEMPOTENCY_HEADER, key).send({ amountKobo: 1000 }).expect(201);
    const reused = await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 2000 })
      .expect(422);

    expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs the handler once when two identical requests race', async () => {
    let release!: () => void;
    const started = vi.fn();
    const handler = vi.fn(async () => {
      started();
      await new Promise<void>((resolve) => (release = resolve));
      return { id: randomUUID() };
    });
    const app = buildApp(handler);
    const key = randomUUID();
    const send = () =>
      request(app).post('/v1/trades').set(IDEMPOTENCY_HEADER, key).send({ amountKobo: 1000 });

    // .then() is what dispatches a supertest request; calling send() alone builds it.
    const first = send().then((r) => r);
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    const second = send().then((r) => r);
    // The loser waits on the lock; let the winner finish while it is waiting.
    setTimeout(() => release(), 50);
    const [a, b] = await Promise.all([first, second]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(b.headers[REPLAYED_HEADER.toLowerCase()]).toBe('true');
  });

  it('answers 409 when the first request is still running after the wait', async () => {
    const handler = vi.fn(
      () => new Promise<{ id: string }>((resolve) => setTimeout(() => resolve({ id: randomUUID() }), 3_000)),
    );
    const app = buildApp(handler, { lockWaitMs: 100 });
    const key = randomUUID();
    const send = () =>
      request(app).post('/v1/trades').set(IDEMPOTENCY_HEADER, key).send({ amountKobo: 1000 });

    const first = send().then((r) => r);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    const second = await send().expect(409);

    expect(second.body).toMatchObject({ code: 'CONFLICT' });
    await first;
  }, 30_000);

  it('takes over a key abandoned by a process that died mid-request', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler, { staleInFlightMs: 50 });
    const key = randomUUID();
    // A row claimed by a process that never came back: no status, no completion.
    await t.app().query(
      `INSERT INTO platform.idempotency_keys (scope, key, actor, request_hash, method, path, created_at)
       VALUES ('CONSUMER', $1, 'anon', 'whatever-it-was', 'POST', '/trades', now() - interval '1 hour')`,
      [key],
    );

    const response = await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 1000 })
      .expect(201);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.headers[REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
    const { rows: stored } = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe(201);
  });

  it('keeps a failed request retryable rather than storing the failure', async () => {
    const handler = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValueOnce({ id: randomUUID() });
    const app = buildApp(handler);
    const key = randomUUID();

    await request(app).post('/v1/trades').set(IDEMPOTENCY_HEADER, key).send({ amountKobo: 1000 }).expect(500);
    const retry = await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 1000 })
      .expect(201);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(retry.headers[REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('does nothing when the client sends no key', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler);

    await request(app).post('/v1/trades').send({ amountKobo: 1000 }).expect(201);
    await request(app).post('/v1/trades').send({ amountKobo: 1000 }).expect(201);

    expect(handler).toHaveBeenCalledTimes(2);
    expect((await rows()).rows).toHaveLength(0);
  });

  it("keeps one actor's key clear of another's", async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const key = randomUUID();
    const gate = createIdempotencyGate({ db: t.db(), redis, logger });
    const routes = [
      defineRoute({
        method: 'post',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'Open a trade',
        retryable: true,
        status: 201,
        schema: { body: z.object({ amountKobo: z.number().int() }), response: z.object({ id: z.uuid() }) },
        handler,
      }),
    ];
    // The actor seam T-030 fills in: here, whoever the header says.
    const app = createApp({
      config,
      logger,
      mountV1: mountRoutes(routes, {
        logger,
        idempotency: gate,
        resolveActor: (req) => String(req.headers['x-test-actor'] ?? 'anon'),
      }),
    });

    const send = (actor: string) =>
      request(app)
        .post('/v1/trades')
        .set(IDEMPOTENCY_HEADER, key)
        .set('x-test-actor', actor)
        .send({ amountKobo: 1000 })
        .expect(201);

    const one = await send('user:a');
    const two = await send('user:b');

    expect(handler).toHaveBeenCalledTimes(2);
    expect(two.body).not.toEqual(one.body);
    expect((await rows()).rows).toHaveLength(2);
  });
});
