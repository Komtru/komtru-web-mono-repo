// An event published by an API instance reaches its subscriber in the worker, exactly once.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { defineEvent, queueDeadLetteredEvent } from '@komtru/shared-types';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDb } from '../../src/db/index.js';
import { publish } from '../../src/platform/events/publish.js';
import { defineRoute } from '../../src/platform/http/route.js';
import { defineModule, type ModuleContext } from '../../src/platform/module.js';
import { startApi } from '../../src/server.js';
import { startWorker } from '../../src/worker-process.js';
import { infraEnabled, pooledUrl, testRedisUrl } from '../support/db-urls.js';
import { useTestDatabase, workerDatabase } from '../support/db.js';
import { eventually } from '../support/eventually.js';

const env = () => ({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: '0',
  REDIS_URL: testRedisUrl(),
  POSTGRES_URL: pooledUrl(workerDatabase()),
});

describe.runIf(infraEnabled)('domain events end to end', () => {
  const t = useTestDatabase();

  it('publishes from an api instance and handles in the worker, once', async () => {
    const probeCreated = defineEvent('test.probe.created', 1, z.object({ probeId: z.uuid() }));
    const handled: string[] = [];
    const module = (role: string) => {
      let context: ModuleContext | undefined;
      return defineModule({
        name: 'probe',
        start: (ctx) => {
          context = ctx;
          ctx.events.subscribe({
            name: 'probe.on-probe-created',
            event: probeCreated,
            handler: (event) => Promise.resolve(void handled.push(`${role}:${event.payload.probeId}`)),
          });
          return Promise.resolve();
        },
        routes: [
          defineRoute({
            method: 'post',
            path: '/probes/:id',
            scope: 'PUBLIC',
            summary: 'Publish a probe event',
            retryable: false,
            status: 202,
            schema: {
              params: z.object({ id: z.uuid() }),
              response: z.object({ published: z.boolean() }),
            },
            handler: async ({ params: { id } }) => {
              await context?.db.transaction((tx) =>
                publish(tx, probeCreated, {
                  payload: { probeId: id },
                  aggregateType: 'probe',
                  aggregateId: id,
                }),
              );
              return { published: true };
            },
          }),
        ],
      });
    };

    const api = await startApi(env(), [module('api')]);
    const worker = await startWorker(env(), [module('worker')]);
    const probeId = randomUUID();
    try {
      const { port } = api.server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/v1/probes/${probeId}`, { method: 'POST' });
      expect(response.status).toBe(202);

      await eventually(() => handled.length > 0, 10_000);
      await new Promise((resolve) => setTimeout(resolve, 300)); // no duplicate trickles in
      expect(handled).toEqual([`worker:${probeId}`]);

      const { rows } = await t
        .app()
        .query<{ published_at: Date | null }>('SELECT published_at FROM platform.outbox');
      expect(rows[0]?.published_at).not.toBeNull();
      const { rows: markers } = await t
        .app()
        .query<{ subscriber: string }>('SELECT subscriber FROM platform.processed_events');
      expect(markers).toEqual([{ subscriber: 'probe.on-probe-created' }]);
    } finally {
      await Promise.all([api.stop(), worker.stop()]);
    }
  }, 30_000);

  it('does not relay from an api process', async () => {
    const probeCreated = defineEvent('test.unrelayed.created', 1, z.object({ probeId: z.uuid() }));
    const api = await startApi(env(), []);
    try {
      await createDb(t.app()).transaction((tx) =>
        publish(tx, probeCreated, { payload: { probeId: randomUUID() } }),
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const { rows } = await t.app().query('SELECT seq FROM platform.outbox WHERE published_at IS NULL');
      expect(rows).toHaveLength(1);
    } finally {
      await api.stop();
    }
  }, 30_000);

  it('publishes platform.queue.dead_lettered when a job exhausts its attempts', async () => {
    const queueName = `test.doomed-${randomUUID().slice(0, 8)}`;
    const worker = await startWorker(env(), [
      defineModule({
        name: 'doomed',
        queues: [
          {
            name: queueName,
            attempts: 1,
            process: () => Promise.reject(new Error('provider down')),
          },
        ],
        start: (ctx) =>
          ctx.queues
            .producer(queueName)
            .add('doomed', { id: 1 })
            .then(() => undefined),
      }),
    ]);
    try {
      await eventually(async () => {
        const { rows } = await t
          .app()
          .query<{ event_type: string }>('SELECT event_type FROM platform.outbox');
        return rows.some((row) => row.event_type === queueDeadLetteredEvent.eventType);
      }, 15_000);

      const { rows } = await t
        .app()
        .query<{ payload: { queue: string; attempts: number; error: string } }>(
          'SELECT payload FROM platform.outbox WHERE event_type = $1',
          [queueDeadLetteredEvent.eventType],
        );
      expect(rows[0]?.payload).toMatchObject({ queue: queueName, attempts: 1, error: 'provider down' });
    } finally {
      await worker.stop();
    }
  }, 30_000);
});
