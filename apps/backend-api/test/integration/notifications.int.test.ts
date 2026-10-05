// The whole pipeline: an event published by an API instance becomes exactly one provider call made
// by the worker. The one place every piece is wired the way production wires it. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { defineEvent } from '@komtru/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { publish } from '../../src/platform/events/publish.js';
import { defineRoute } from '../../src/platform/http/route.js';
import { defineModule, type ModuleContext } from '../../src/platform/module.js';
import { createNotifyModule } from '../../src/modules/notify/index.js';
import { defineBinding } from '../../src/modules/notify/domain/binding.js';
import { templateSchema } from '../../src/modules/notify/domain/template.js';
import { startApi } from '../../src/server.js';
import { startWorker } from '../../src/worker-process.js';
import { infraEnabled, pooledUrl, testRedisUrl } from '../support/db-urls.js';
import { useTestDatabase, workerDatabase } from '../support/db.js';
import { eventually } from '../support/eventually.js';
import { startStubServer, type StubServer } from '../support/stub-server.js';
import { createLogger } from '../../src/platform/logger.js';
import { loadConfig } from '../../src/config/env.js';
import { createQueueFactory } from '../../src/platform/queue/factory.js';
import { insertUser, insertVerifiedPhone } from '../modules/notify/support.js';

const TEMPLATE_KEY = 'test.notice';
const EVENT_NAME = 'test.notice.raised';

const noticeRaised = defineEvent(EVENT_NAME, 1, z.object({ userId: z.uuid(), what: z.string() }));

const TEMPLATE = templateSchema.parse({
  templateKey: TEMPLATE_KEY,
  channel: 'SMS',
  category: 'TRADE',
  body: 'Komtru: {{what}}',
  variables: ['what'],
});

const CATALOGUE = {
  templates: [TEMPLATE],
  mappings: [{ eventName: EVENT_NAME, templateKey: TEMPLATE_KEY, enabled: true }],
};

const binding = defineBinding({
  subscriber: 'notify.on-notice-raised',
  event: noticeRaised,
  templateKey: TEMPLATE_KEY,
  recipients: (payload) => [{ userId: payload.userId, variables: { what: payload.what } }],
});

describe.runIf(infraEnabled)('notifications end to end', () => {
  const t = useTestDatabase();
  let stub: StubServer | undefined;

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  const env = (overrides: Record<string, string> = {}) => ({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PORT: '0',
    REDIS_URL: testRedisUrl(),
    POSTGRES_URL: pooledUrl(workerDatabase()),
    // Live SMS, against the stub: the dry-run default would hide the very call this proves.
    NOTIFY_SMS_DRY_RUN: 'false',
    TERMII_API_KEY: 'test-key',
    TERMII_SENDER_ID: 'Komtru',
    TERMII_BASE_URL: stub?.url ?? '',
    NOTIFY_RETRY_BASE_DELAY_MS: '100',
    ...overrides,
  });

  /** A route that publishes the event, so it is genuinely the api that writes the outbox row. */
  const publisher = () => {
    let context: ModuleContext | undefined;
    return defineModule({
      name: 'notice',
      start: (ctx) => {
        context = ctx;
        return Promise.resolve();
      },
      routes: [
        defineRoute({
          method: 'post',
          path: '/notices/:userId',
          scope: 'PUBLIC',
          summary: 'Raise a notice',
          retryable: false,
          status: 202,
          schema: {
            params: z.object({ userId: z.uuid() }),
            query: z.object({ eventId: z.uuid().optional() }),
            response: z.object({ published: z.boolean() }),
          },
          handler: async ({ params, query }) => {
            await context?.db.transaction((tx) =>
              publish(tx, noticeRaised, {
                payload: { userId: params.userId, what: 'your trade moved' },
                ...(query.eventId ? { eventId: query.eventId } : {}),
              }),
            );
            return { published: true };
          },
        }),
      ],
    });
  };

  const notify = () => createNotifyModule({ bindings: [binding], catalogue: CATALOGUE });

  const statusOf = async (userId: string) => {
    const { rows } = await t
      .app()
      .query<{ status: string }>(`SELECT status FROM notify.notifications WHERE user_id = $1`, [userId]);
    return rows.map((r) => r.status);
  };

  /**
   * Puts the same envelope back on the subscriber's queue under a fresh job id. The relay keys its
   * jobs on `<eventId>--<subscriber>`, so re-publishing the outbox row would be swallowed by
   * BullMQ's own deduplication and prove nothing about this module.
   */
  const redeliver = async (eventId: string, userId: string) => {
    const appConfig = loadConfig({
      LOG_LEVEL: 'silent',
      POSTGRES_URL: pooledUrl(workerDatabase()),
      REDIS_URL: testRedisUrl(),
    });
    const factory = createQueueFactory({ redisUrl: appConfig.redis.url, logger: createLogger(appConfig) });
    try {
      await factory.producer('events.notify.on-notice-raised').add('redelivery', {
        eventId,
        eventType: EVENT_NAME,
        version: 1,
        occurredAt: new Date().toISOString(),
        actor: { type: 'SYSTEM' },
        payload: { userId, what: 'your trade moved' },
      });
    } finally {
      await factory.close();
    }
  };

  const outboxTypes = async () => {
    const { rows } = await t
      .app()
      .query<{ event_type: string }>(`SELECT event_type FROM platform.outbox ORDER BY seq`);
    return rows.map((r) => r.event_type);
  };

  it('turns an event published in the api into exactly one provider call from the worker', async () => {
    stub = await startStubServer((_req, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message_id: 'tm-e2e' }));
    });
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345678');

    const api = await startApi(env(), [publisher(), notify()]);
    const worker = await startWorker(env(), [publisher(), notify()]);
    try {
      const { port } = api.server.address() as AddressInfo;
      const eventId = randomUUID();
      const url = `http://127.0.0.1:${String(port)}/v1/notices/${userId}?eventId=${eventId}`;
      expect((await fetch(url, { method: 'POST' })).status).toBe(202);

      await eventually(async () => (await statusOf(userId)).includes('SENT'), 20_000);
      expect(stub.hits).toHaveLength(1);
      expect(JSON.parse(stub.hits[0]?.body ?? '{}')).toMatchObject({
        to: '+2348012345678',
        sms: 'Komtru: your trade moved',
      });
      expect(await outboxTypes()).toEqual([EVENT_NAME, 'notify.notification.sent']);

      // Now force a genuine redelivery with the platform's own guard removed: drop the
      // processed_events marker and hand the subscriber queue the same envelope again under a new
      // job id. That is what a replay, a restored backup or a lost marker looks like, and it is the
      // case the module has to survive on its own. The handler runs a second time, computes the
      // same deterministic notification id, collides with the row that is already SENT, and
      // enqueues nothing — so the user is not texted twice.
      await t.app().query(`DELETE FROM platform.processed_events`);
      await redeliver(eventId, userId);

      await eventually(async () => {
        const { rows } = await t
          .app()
          .query(`SELECT 1 FROM platform.processed_events WHERE subscriber = 'notify.on-notice-raised'`);
        return rows.length > 0;
      }, 20_000);
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(stub.hits).toHaveLength(1);
      expect(await statusOf(userId)).toEqual(['SENT']);
    } finally {
      await Promise.all([api.stop(), worker.stop()]);
    }
  }, 60_000);

  it('dead-letters against a provider that always fails, and publishes it', async () => {
    stub = await startStubServer((_req, res: ServerResponse) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'termii is down' }));
    });
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345679');

    const failing = env({ NOTIFY_MAX_ATTEMPTS: '2' });
    const api = await startApi(failing, [publisher(), notify()]);
    const worker = await startWorker(failing, [publisher(), notify()]);
    try {
      const { port } = api.server.address() as AddressInfo;
      await fetch(`http://127.0.0.1:${String(port)}/v1/notices/${userId}`, { method: 'POST' });

      await eventually(async () => (await statusOf(userId)).includes('DEAD_LETTERED'), 30_000);
      expect(await outboxTypes()).toContain('notify.notification.dead_lettered');
      expect(stub.hits.length).toBeGreaterThanOrEqual(2);
    } finally {
      await Promise.all([api.stop(), worker.stop()]);
    }
  }, 60_000);

  it('suppresses a notification the user opted out of, without calling the provider', async () => {
    stub = await startStubServer((_req, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message_id: 'tm-never' }));
    });
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345670');
    await t.app().query(
      `INSERT INTO notify.notification_preferences (user_id, category, channel, opted_in)
         VALUES ($1, 'TRADE', 'SMS', false)`,
      [userId],
    );

    const api = await startApi(env(), [publisher(), notify()]);
    const worker = await startWorker(env(), [publisher(), notify()]);
    try {
      const { port } = api.server.address() as AddressInfo;
      await fetch(`http://127.0.0.1:${String(port)}/v1/notices/${userId}`, { method: 'POST' });

      await eventually(async () => (await statusOf(userId)).includes('SUPPRESSED'), 20_000);
      expect(stub.hits).toEqual([]);
    } finally {
      await Promise.all([api.stop(), worker.stop()]);
    }
  }, 60_000);

  it('makes no provider call at all when SMS is in dry run', async () => {
    stub = await startStubServer((_req, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message_id: 'tm-never' }));
    });
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345671');

    const dry = env({ NOTIFY_SMS_DRY_RUN: 'true' });
    const api = await startApi(dry, [publisher(), notify()]);
    const worker = await startWorker(dry, [publisher(), notify()]);
    try {
      const { port } = api.server.address() as AddressInfo;
      await fetch(`http://127.0.0.1:${String(port)}/v1/notices/${userId}`, { method: 'POST' });

      await eventually(async () => (await statusOf(userId)).includes('SENT'), 20_000);
      // Rendered, recorded, logged with the recipient masked — and never sent.
      expect(stub.hits).toEqual([]);
      const { rows } = await t
        .app()
        .query<{ provider_reference: string; recipient_masked: string }>(
          `SELECT provider_reference, recipient_masked FROM notify.notifications WHERE user_id = $1`,
          [userId],
        );
      expect(rows[0]).toEqual({ provider_reference: 'dry-run', recipient_masked: '+23480•••5671' });
    } finally {
      await Promise.all([api.stop(), worker.stop()]);
    }
  }, 60_000);

  it('does not let the api process send anything', async () => {
    stub = await startStubServer((_req, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message_id: 'tm-api' }));
    });
    const userId = await insertUser(t.app());
    await insertVerifiedPhone(t.app(), userId, '+2348012345672');

    const api = await startApi(env(), [publisher(), notify()]);
    try {
      const { port } = api.server.address() as AddressInfo;
      await fetch(`http://127.0.0.1:${String(port)}/v1/notices/${userId}`, { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 1_500));

      // No worker, so no relay and no consumer: the outbox row is all there is.
      expect(stub.hits).toEqual([]);
      expect(await statusOf(userId)).toEqual([]);
    } finally {
      await api.stop();
    }
  }, 60_000);
});
