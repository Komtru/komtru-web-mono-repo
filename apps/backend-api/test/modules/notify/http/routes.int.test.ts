// The consumer routes, mounted the way the API mounts them. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../src/app.js';
import { loadConfig } from '../../../../src/config/env.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { notifyRoutes } from '../../../../src/modules/notify/http/routes.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../../support/db-urls.js';
import { ANONYMOUS_ACTOR, testActor } from '../../../support/actors.js';
import type { Actor } from '../../../../src/platform/http/principal.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertNotification, insertUser } from '../support.js';

interface FeedItem {
  id: string;
  body: string;
  readAt: string | null;
}
interface Preference {
  category: string;
  channel: string;
  optedIn: boolean;
}
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** supertest types `body` as `any`; one cast here keeps every assertion below typed. */
const page = <T>(res: Response): Page<T> => res.body as Page<T>;
const problem = (res: Response): { code?: string; detail?: string } =>
  res.body as { code?: string; detail?: string };

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
  ...testRedisEnv(),
});
const logger = createLogger(config);

describe.runIf(infraEnabled)('notify routes', () => {
  const t = useTestDatabase();
  let userId: string;
  let caller: Actor;

  /** `caller` is read at request time, so one app serves the anonymous and the signed-in cases. */
  const app = (): Express =>
    createApp({
      config,
      logger,
      mountV1: mountRoutes(
        notifyRoutes(() => t.db()),
        { logger, resolveActor: () => Promise.resolve(caller) },
      ),
    });

  /** The stored MARKETING/SMS preference, read back through the API rather than the table. */
  const marketingSms = async () => {
    const res = await request(app()).get('/v1/notification-preferences?limit=100');
    return page<Preference>(res).items.find((p) => p.category === 'MARKETING' && p.channel === 'SMS');
  };

  const inApp = (overrides: Record<string, unknown> = {}) =>
    insertNotification(t.app(), {
      user_id: userId,
      channel: 'IN_APP',
      category: 'TRADE',
      status: 'SENT',
      rendered_body: 'A trade moved',
      ...overrides,
    });

  beforeEach(async () => {
    userId = await insertUser(t.app());
    caller = testActor(userId);
  });

  describe('without a session', () => {
    beforeEach(() => {
      caller = ANONYMOUS_ACTOR;
    });

    it.each([
      ['get', '/v1/notifications'],
      ['get', '/v1/notification-preferences'],
    ])('answers 401 on %s %s', async (method, path) => {
      const res = await (method === 'get' ? request(app()).get(path) : request(app()).put(path));
      expect(res.status).toBe(401);
      expect(problem(res).code).toBe('UNAUTHENTICATED');
    });

    it('answers 401 on mark-read', async () => {
      const res = await request(app()).post(`/v1/notifications/${randomUUID()}/mark-read`);
      expect(res.status).toBe(401);
    });

    it('answers 401 on a preference change', async () => {
      const res = await request(app())
        .put('/v1/notification-preferences')
        .send({ preferences: [{ category: 'MARKETING', channel: 'SMS', optedIn: false }] });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /notifications', () => {
    it('returns only the caller’s in-app notifications, newest first', async () => {
      const other = await insertUser(t.app());
      await inApp({ rendered_body: 'first', queued_at: new Date(Date.now() - 2000) });
      await inApp({ rendered_body: 'second', queued_at: new Date(Date.now() - 1000) });
      await inApp({ user_id: other, rendered_body: 'theirs' });
      // An email we sent is not feed content.
      await insertNotification(t.app(), { user_id: userId, channel: 'EMAIL', rendered_body: 'emailed' });

      const res = await request(app()).get('/v1/notifications');

      expect(res.status).toBe(200);
      expect(page<FeedItem>(res).items.map((i) => i.body)).toEqual(['second', 'first']);
    });

    it('pages with a cursor', async () => {
      await inApp({ rendered_body: 'a', queued_at: new Date(Date.now() - 2000) });
      await inApp({ rendered_body: 'b', queued_at: new Date(Date.now() - 1000) });

      const first = await request(app()).get('/v1/notifications?limit=1');
      expect(page<FeedItem>(first).items.map((i) => i.body)).toEqual(['b']);
      expect(page<FeedItem>(first).nextCursor).toEqual(expect.any(String));

      const second = await request(app()).get(
        `/v1/notifications?limit=1&cursor=${encodeURIComponent(String(page<FeedItem>(first).nextCursor))}`,
      );
      expect(page<FeedItem>(second).items.map((i) => i.body)).toEqual(['a']);
      expect(page<FeedItem>(second).nextCursor).toBeNull();
    });
  });

  describe('POST /notifications/:id/mark-read', () => {
    it('marks one read', async () => {
      const id = await inApp();

      await expect(request(app()).post(`/v1/notifications/${id}/mark-read`)).resolves.toMatchObject({
        status: 200,
        body: { read: true },
      });

      const feed = await request(app()).get('/v1/notifications');
      expect(page<FeedItem>(feed).items[0]?.readAt).toEqual(expect.any(String));
    });

    it('is harmless twice', async () => {
      const id = await inApp();
      await request(app()).post(`/v1/notifications/${id}/mark-read`);

      await expect(request(app()).post(`/v1/notifications/${id}/mark-read`)).resolves.toMatchObject({
        status: 200,
      });
    });

    it('404s on another user’s notification, the same as on one that does not exist', async () => {
      const other = await insertUser(t.app());
      const theirs = await inApp({ user_id: other });

      const mine = await request(app()).post(`/v1/notifications/${randomUUID()}/mark-read`);
      const stolen = await request(app()).post(`/v1/notifications/${theirs}/mark-read`);

      expect(stolen.status).toBe(404);
      expect(problem(stolen)).toEqual(problem(mine));
    });
  });

  describe('notification preferences', () => {
    it('returns every changeable pair, defaulting to opted in', async () => {
      const res = await request(app()).get('/v1/notification-preferences?limit=100');

      expect(res.status).toBe(200);
      const items = page<Preference>(res).items;
      expect(items.every((p) => p.optedIn)).toBe(true);
      // SECURITY is not a switch, and neither is the in-app record itself.
      expect(items.some((p) => p.category === 'SECURITY')).toBe(false);
      expect(items.some((p) => p.channel === 'IN_APP')).toBe(false);
    });

    it('stores and reads back a MARKETING opt-out', async () => {
      const res = await request(app())
        .put('/v1/notification-preferences')
        .send({ preferences: [{ category: 'MARKETING', channel: 'SMS', optedIn: false }] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: 1 });
      expect(await marketingSms()).toMatchObject({ optedIn: false });
    });

    it('pages the matrix rather than overrunning the default limit', async () => {
      const first = await request(app()).get('/v1/notification-preferences?limit=2');

      expect(page<Preference>(first).items).toHaveLength(2);
      expect(page<Preference>(first).nextCursor).toEqual(expect.any(String));

      const second = await request(app()).get(
        `/v1/notification-preferences?limit=2&cursor=${encodeURIComponent(
          String(page<Preference>(first).nextCursor),
        )}`,
      );
      expect(page<Preference>(second).items[0]).not.toEqual(page<Preference>(first).items[0]);
    });

    it('updates an existing preference rather than failing on it', async () => {
      const body = { preferences: [{ category: 'MARKETING', channel: 'SMS', optedIn: false }] };
      await request(app()).put('/v1/notification-preferences').send(body);

      const res = await request(app())
        .put('/v1/notification-preferences')
        .send({ preferences: [{ category: 'MARKETING', channel: 'SMS', optedIn: true }] });

      expect(res.status).toBe(200);
      expect(await marketingSms()).toMatchObject({ optedIn: true });
    });

    it('refuses to store a SECURITY opt-out', async () => {
      const res = await request(app())
        .put('/v1/notification-preferences')
        .send({ preferences: [{ category: 'SECURITY', channel: 'SMS', optedIn: false }] });

      expect(res.status).toBe(422);
      expect(problem(res).detail).toContain('always delivered');
      const { rows } = await t
        .app()
        .query(`SELECT 1 FROM notify.notification_preferences WHERE category = 'SECURITY'`);
      expect(rows).toEqual([]);
    });

    it('stores nothing at all when one entry in the batch is SECURITY', async () => {
      const res = await request(app())
        .put('/v1/notification-preferences')
        .send({
          preferences: [
            { category: 'MARKETING', channel: 'SMS', optedIn: false },
            { category: 'SECURITY', channel: 'SMS', optedIn: false },
          ],
        });

      expect(res.status).toBe(422);
      const { rows } = await t.app().query(`SELECT 1 FROM notify.notification_preferences`);
      expect(rows).toEqual([]);
    });
  });
});
