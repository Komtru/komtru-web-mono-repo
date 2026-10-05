// Two API instances and one worker share one Redis: each job is processed exactly once, by the worker.
// (Shared rate-limit state is asserted in T-025, which builds the limiter.) Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { defineModule, type ModuleContext } from '../../src/platform/module.js';
import { startApi } from '../../src/server.js';
import { startWorker } from '../../src/worker-process.js';
import { infraEnabled, pooledUrl } from '../support/db-urls.js';
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
        routes: (router) => {
          router.post('/echo/:id', async (req, res) => {
            await ctx?.queues.producer(queueName).add('echo', { id: Number(req.params.id) });
            res.status(202).end();
          });
        },
      });
    };
    const env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      PORT: '0',
      REDIS_URL: 'redis://localhost:56379',
      POSTGRES_URL: pooledUrl(workerDatabase()),
    };

    const apiA = await startApi(env, [makeModule('api-a')]);
    const apiB = await startApi(env, [makeModule('api-b')]);
    const worker = await startWorker(env, [makeModule('worker')]);
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

  it('takes no jobs and releases its connections when worker startup fails', async () => {
    const queueName = `test.early-${randomUUID().slice(0, 8)}`;
    const processed: unknown[] = [];
    const env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      REDIS_URL: 'redis://localhost:56379',
      POSTGRES_URL: pooledUrl(workerDatabase()),
    };
    const api = await startApi({ ...env, PORT: '0' }, [
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
      await expect(startWorker(env, [broken])).rejects.toThrow(/module failed to start/);
      await new Promise((r) => setTimeout(r, 300));
      expect(processed).toEqual([]);
    } finally {
      await api.stop();
    }
  });
});
