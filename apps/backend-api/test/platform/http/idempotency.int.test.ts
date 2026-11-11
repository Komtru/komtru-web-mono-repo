// Idempotency against real Postgres and Redis. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { koboSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import {
  createIdempotencyGate,
  IDEMPOTENCY_HEADER,
  pruneIdempotencyKeys,
  REPLAYED_HEADER,
} from '../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import type { Actor } from '../../../src/platform/http/principal.js';
import { defineRoute } from '../../../src/platform/http/route.js';
import { createLogger } from '../../../src/platform/logger.js';
import { createRedis } from '../../../src/platform/redis/connections.js';
import { infraEnabled, testKeyPrefix, testRedisUrl } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

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

const REDIS_URL = testRedisUrl();
const config = loadConfig({
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://x@localhost/x',
  REDIS_URL,
});
const logger = createLogger(config);
const redis = createRedis(REDIS_URL, { keyPrefix: testKeyPrefix() });

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
    // These tests are about the key, not about auth, so the route's CONSUMER scope is satisfied by
    // a fixed signed-in caller; the per-actor test below supplies its own.
    return createApp({
      config,
      logger,
      mountV1: mountRoutes(routes, {
        logger,
        idempotency: gate,
        resolveActor: () => Promise.resolve(signedIn),
      }),
    });
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

  it('keys a body whose money decodes to bigint, telling two amounts apart', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const gate = createIdempotencyGate({ db: t.db(), redis, logger, lockWaitMs: 500 });
    const app = createApp({
      config,
      logger,
      mountV1: mountRoutes(
        [
          defineRoute({
            method: 'post',
            path: '/withdrawals',
            scope: 'CONSUMER',
            summary: 'Withdraw',
            retryable: true,
            status: 201,
            schema: { body: z.object({ amountMinor: koboSchema }), response: z.object({ id: z.uuid() }) },
            handler,
          }),
        ],
        { logger, idempotency: gate, resolveActor: () => Promise.resolve(signedIn) },
      ),
    });
    const key = randomUUID();
    const send = (amountMinor: string) =>
      request(app).post('/v1/withdrawals').set(IDEMPOTENCY_HEADER, key).send({ amountMinor });

    expect((await send('20000')).status).toBe(201);
    expect((await send('20000')).status).toBe(201);
    expect((await send('20001')).status).toBe(422);
    expect(handler).toHaveBeenCalledTimes(1);
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

  it('takes over a key whose owner died, once its lease has lapsed', async () => {
    // The dead owner's attempt never returns; the one that takes over does.
    let release!: () => void;
    let calls = 0;
    const handler = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolve) => (release = resolve));
      return { id: randomUUID() };
    });
    const app = buildApp(handler, { staleInFlightMs: 10, leaseTtlMs: 60_000, lockWaitMs: 100 });
    const key = randomUUID();
    const send = () =>
      request(app).post('/v1/trades').set(IDEMPOTENCY_HEADER, key).send({ amountKobo: 1000 });

    const first = send().then((r) => r);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    // The owner's process is gone: its lease expires and its claim ages out. (Here: drop the lease
    // and age the row, which is what Redis and the clock would do on their own.)
    await redis.del(`idem:CONSUMER:${signedIn.key}:${key}`);
    await t
      .app()
      .query(`UPDATE platform.idempotency_keys SET created_at = now() - interval '1 hour' WHERE key = $1`, [
        key,
      ]);

    const taken = await send().expect(201);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(taken.headers[REPLAYED_HEADER.toLowerCase()]).toBeUndefined();

    const { rows: stored } = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe(201);

    release();
    await first;
  }, 30_000);

  it('refuses a different request under a key that is still in flight', async () => {
    let release!: () => void;
    const handler = vi.fn(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return { id: randomUUID() };
    });
    const app = buildApp(handler, { lockWaitMs: 100 });
    const key = randomUUID();

    const first = request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 1000 })
      .then((r) => r);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());

    const other = await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 2000 })
      .expect(422);
    expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await first;
  }, 30_000);

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

  it('does not take over a handler that is merely slow, however long it runs', async () => {
    // The lease, renewed while the handler works, is what tells a slow owner from a dead one.
    let release!: () => void;
    const handler = vi.fn(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return { id: randomUUID() };
    });
    // Stale window far below the handler's runtime: only the live lease prevents a takeover.
    const app = buildApp(handler, { staleInFlightMs: 10, leaseTtlMs: 2_000, lockWaitMs: 100 });
    const key = randomUUID();
    const send = () =>
      request(app).post('/v1/trades').set(IDEMPOTENCY_HEADER, key).send({ amountKobo: 1000 });

    const first = send().then((r) => r);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 150));

    const second = await send().expect(409);
    expect(second.body).toMatchObject({ code: 'CONFLICT' });
    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await first;
  }, 30_000);

  it('does not let a superseded attempt overwrite the owner response', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: 'superseded' }));
    const app = buildApp(handler);
    const key = randomUUID();
    // A row owned by someone else entirely: this attempt must not be able to complete it.
    await t.app().query(
      `INSERT INTO platform.idempotency_keys (scope, key, actor, request_hash, owner_id, method, path, status, response, completed_at)
       VALUES ('CONSUMER', $1, $2, 'some-other-hash', gen_random_uuid(), 'POST', '/trades', 201, '{"id":"the-owner"}'::jsonb, now())`,
      [key, signedIn.key],
    );

    // Same key, different body: the stored record stands and the client is told so.
    await request(app).post('/v1/trades').set(IDEMPOTENCY_HEADER, key).send({ amountKobo: 9999 }).expect(422);

    const { rows } = await t
      .app()
      .query<{ response: { id: string } }>('SELECT response FROM platform.idempotency_keys');
    expect(rows[0]?.response).toEqual({ id: 'the-owner' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs again once a stored record is past its lifetime', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler, { ttlHours: 0 });
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

    expect(handler).toHaveBeenCalledTimes(2);
    expect(second.body).not.toEqual(first.body);
    expect(second.headers[REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
  });

  // T-029, the other half of it. `completed_at` carries microseconds that the `pg` driver truncates
  // away before JS sees a Date, so a record sitting on the ttl boundary used to be judged twice:
  // once in JS on the app clock at millisecond resolution, once in Postgres at microsecond
  // resolution. Postgres alone decides now, so a settled request can never answer 409.
  it('re-runs a record parked exactly on the ttl boundary rather than conflicting', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler, { ttlHours: 24 });
    const key = randomUUID();
    const send = () =>
      request(app).post('/v1/trades').set(IDEMPOTENCY_HEADER, key).send({ amountKobo: 1000 });

    const first = await send().expect(201);
    // A full ttl old, carrying a microsecond the millisecond-resolution clock cannot represent.
    await t.app().query(
      `UPDATE platform.idempotency_keys
          SET completed_at = now() - make_interval(hours => 24) + interval '1 microsecond'`,
    );

    const second = await send().expect(201);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(second.body).not.toEqual(first.body);
    expect(second.headers[REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('counts a different query string as a different request', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler);
    const key = randomUUID();

    await request(app)
      .post('/v1/trades?dryRun=true')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 1000 })
      .expect(201);
    await request(app)
      .post('/v1/trades?dryRun=false')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 1000 })
      .expect(422);
  });

  it.each(['short', 'has a space in it', 'x'.repeat(256)])('refuses the unusable key %j', async (key) => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler);
    const response = await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, key)
      .send({ amountKobo: 1000 })
      .expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('prunes records past their lifetime so the table stays bounded', async () => {
    const handler = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = buildApp(handler);
    await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, randomUUID())
      .send({ amountKobo: 1000 })
      .expect(201);
    await request(app)
      .post('/v1/trades')
      .set(IDEMPOTENCY_HEADER, randomUUID())
      .send({ amountKobo: 1000 })
      .expect(201);
    await t
      .app()
      .query(
        `UPDATE platform.idempotency_keys SET created_at = now() - interval '2 days' WHERE key = (SELECT min(key) FROM platform.idempotency_keys)`,
      );

    expect(await pruneIdempotencyKeys(t.db(), 24)).toBe(1);
    expect((await rows()).rows).toHaveLength(1);
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
    // The actor seam identity fills in (T-031): here, whoever the header says.
    const app = createApp({
      config,
      logger,
      mountV1: mountRoutes(routes, {
        logger,
        idempotency: gate,
        resolveActor: (req) =>
          // Same signed-in principal, different actor key: the key is the whole point of this test.
          Promise.resolve({
            ...signedIn,
            key: String(req.headers['x-test-actor'] ?? signedIn.key),
          }),
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
