// Two API instances and one worker share one Redis: each job is processed exactly once by the worker,
// and the pair shares one rate-limit budget and one idempotency store. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineRoute } from '../../src/platform/http/route.js';
import { defineModule, type ModuleContext } from '../../src/platform/module.js';
import { startApi } from '../../src/server.js';
import { startWorker } from '../../src/worker-process.js';
import { infraEnabled, pooledUrl, testRedisEnv, testRedisUrl } from '../support/db-urls.js';
import { useTestDatabase, workerDatabase } from '../support/db.js';
import { eventually } from '../support/eventually.js';

describe.runIf(infraEnabled)('stateless processes', () => {
  useTestDatabase();

  it('processes jobs enqueued by two API instances exactly once, in the worker', async () => {
    const queueName = `test.echo-${randomUUID().slice(0, 8)}`;
    const processed: { id: number; pid: string }[] = [];
    const makeModule = (role: string) => {
      let ctx: ModuleContext | undefined;
      return defineModule({
        name: 'echo',
        queues: [
          {
            name: queueName,
            process: (data: { id: number }) =>
              Promise.resolve(void processed.push({ id: data.id, pid: role })),
          },
        ],
        start: (context) => {
          ctx = context;
          return Promise.resolve();
        },
        routes: [
          defineRoute({
            method: 'post',
            path: '/echo/:id',
            scope: 'PUBLIC',
            summary: 'Enqueue an echo job',
            retryable: false,
            status: 202,
            schema: {
              params: z.object({ id: z.string().regex(/^\d+$/) }),
              response: z.object({ queued: z.boolean() }),
            },
            handler: async ({ params: { id } }) => {
              await ctx?.queues.producer(queueName).add('echo', { id: Number(id) });
              return { queued: true };
            },
          }),
        ],
      });
    };
    const env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      PORT: '0',
      REDIS_URL: testRedisUrl(),
      ...testRedisEnv(),
      POSTGRES_URL: pooledUrl(workerDatabase()),
    };

    const apiA = await startApi(env, () => [makeModule('api-a')]);
    const apiB = await startApi(env, () => [makeModule('api-b')]);
    const worker = await startWorker(env, () => [makeModule('worker')]);
    try {
      const ports = [apiA, apiB].map((api) => (api.server.address() as AddressInfo).port);
      await Promise.all(
        Array.from({ length: 20 }, (_, id) =>
          fetch(`http://127.0.0.1:${ports[id % 2]}/v1/echo/${id}`, { method: 'POST' }),
        ),
      );
      await eventually(() => processed.length >= 20);
      await new Promise((r) => setTimeout(r, 200)); // no duplicates trickle in
      expect(processed.map((p) => p.id).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, i) => i),
      );
      expect(new Set(processed.map((p) => p.pid))).toEqual(new Set(['worker']));
    } finally {
      await Promise.all([apiA.stop(), apiB.stop(), worker.stop()]);
    }
  });

  it('shares one rate-limit budget and one idempotency store across two instances', async () => {
    const path = `/limited-${randomUUID().slice(0, 8)}`;
    const handled: string[] = [];
    const makeModule = (role: string) =>
      defineModule({
        name: 'limited',
        routes: [
          defineRoute({
            method: 'post',
            path,
            scope: 'PUBLIC',
            summary: 'A limited, retryable route',
            retryable: true,
            rateLimit: { points: 2, durationSeconds: 60, by: ['ip'] },
            schema: {
              body: z.object({ note: z.string() }),
              response: z.object({ by: z.string(), id: z.string() }),
            },
            handler: ({ body: { note } }) => {
              handled.push(`${role}:${note}`);
              return Promise.resolve({ by: role, id: randomUUID() });
            },
          }),
        ],
      });

    const env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      PORT: '0',
      REDIS_URL: testRedisUrl(),
      ...testRedisEnv(),
      POSTGRES_URL: pooledUrl(workerDatabase()),
    };
    const apiA = await startApi(env, () => [makeModule('api-a')]);
    const apiB = await startApi(env, () => [makeModule('api-b')]);
    try {
      const url = (api: typeof apiA) =>
        `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/v1${path}`;
      const key = randomUUID();
      const post = (api: typeof apiA, body: unknown, idempotencyKey?: string) =>
        fetch(url(api), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify(body),
        });

      // One budget of 2 for the pair: the first instance spends one, the second the other, and the
      // third request is refused wherever it lands.
      const first = await post(apiA, { note: 'one' }, key);
      expect(first.status).toBe(200);
      const replay = await post(apiB, { note: 'one' }, key);
      expect(replay.status).toBe(200);
      expect(replay.headers.get('idempotent-replayed')).toBe('true');
      expect(await replay.json()).toEqual(await first.clone().json());

      const third = await post(apiA, { note: 'two' });
      expect(third.status).toBe(429);
      expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);

      // The handler ran once, on one instance, despite the retry landing on the other.
      expect(handled).toEqual(['api-a:one']);
    } finally {
      await Promise.all([apiA.stop(), apiB.stop()]);
    }
  }, 30_000);

  it('takes no jobs and releases its connections when worker startup fails', async () => {
    const queueName = `test.early-${randomUUID().slice(0, 8)}`;
    const processed: unknown[] = [];
    const env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      REDIS_URL: testRedisUrl(),
      ...testRedisEnv(),
      POSTGRES_URL: pooledUrl(workerDatabase()),
    };
    const api = await startApi({ ...env, PORT: '0' }, () => [
      defineModule({
        name: 'early',
        queues: [{ name: queueName, process: () => Promise.resolve() }],
        start: (ctx) =>
          ctx.queues
            .producer(queueName)
            .add('x', {})
            .then(() => undefined),
      }),
    ]);
    try {
      const broken = defineModule({
        name: 'early',
        queues: [{ name: queueName, process: (d: unknown) => Promise.resolve(void processed.push(d)) }],
        start: () => Promise.reject(new Error('module failed to start')),
      });
      await expect(startWorker(env, () => [broken])).rejects.toThrow(/module failed to start/);
      await new Promise((r) => setTimeout(r, 300));
      expect(processed).toEqual([]);
    } finally {
      await api.stop();
    }
  });
});
