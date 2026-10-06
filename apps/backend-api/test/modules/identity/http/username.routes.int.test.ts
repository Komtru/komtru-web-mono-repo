// `paginated: 'page'` is a promise the platform enforces: mount.ts merges page/limit into the query
// and refuses a response longer than the caller's limit. A route that declares pagination and then
// ignores it answers 500 to a perfectly valid `?limit=1`, which no declaration-shaped test catches.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { usernameRoutes } from '../../../../src/modules/identity/http/username.controller.js';
import { seedIdentityCatalogue } from '../../../../src/modules/identity/infrastructure/postgres/seed.js';
import { changeUsername, claimUsername } from '../../../../src/modules/identity/services/username.service.js';
import { createLogger } from '../../../../src/platform/logger.js';
import { loadConfig } from '../../../../src/config/env.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { infraEnabled, testRedisEnv, testRedisUrl } from '../../../support/db-urls.js';
import { testActor } from '../../../support/actors.js';
import { useTestDatabase } from '../../../support/db.js';
import { insertUser } from '../infrastructure/postgres/support.js';

const logger = createLogger(
  loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
    REDIS_URL: testRedisUrl(),
    ...testRedisEnv(),
  }),
);

describe.runIf(infraEnabled)('GET /me/username/history', () => {
  const t = useTestDatabase();

  const appFor = (userId: string) => {
    const app = express();
    const router = express.Router();
    const history = usernameRoutes({ db: t.db() }).filter((r) => r.path === '/me/username/history');
    mountRoutes(history, { logger, resolveActor: () => Promise.resolve(testActor(userId)) })(router);
    app.use('/v1', router);
    return app;
  };

  const withThreeHandles = async (): Promise<string> => {
    await seedIdentityCatalogue(t.db());
    const user = await insertUser(t.app());
    let now = new Date('2026-10-05T12:00:00Z');
    const clock = { now: () => now };
    await claimUsername({ db: t.db(), ...clock }, { userId: user, username: 'handleone' });
    for (const username of ['handletwo', 'handlethree']) {
      now = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
      await changeUsername({ db: t.db(), ...clock }, { userId: user, username, reason: 'rebrand' });
    }
    return user;
  };

  interface HistoryPage {
    items: { username: string }[];
    page: number;
    limit: number;
    total: number;
  }

  it('honours the caller limit instead of returning everything', async () => {
    const app = appFor(await withThreeHandles());
    const get = async (query: string): Promise<{ status: number; body: HistoryPage }> => {
      const response = await request(app).get(`/v1/me/username/history${query}`);
      return { status: response.status, body: response.body as HistoryPage };
    };

    const all = await get('');
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ page: 1, limit: 20, total: 3 });
    expect(all.body.items).toHaveLength(3);

    const first = await get('?limit=1');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0]?.username).toBe('handlethree');

    const second = await get('?limit=1&page=2');
    expect(second.status).toBe(200);
    expect(second.body.items[0]?.username).toBe('handletwo');
    expect(second.body).toMatchObject({ page: 2, limit: 1, total: 3 });
  });

  it('answers 401 without a principal', async () => {
    await seedIdentityCatalogue(t.db());
    const app = express();
    const router = express.Router();
    mountRoutes(
      usernameRoutes({ db: t.db() }).filter((r) => r.path === '/me/username/history'),
      {
        logger,
      },
    )(router);
    app.use('/v1', router);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status((error as { status?: number }).status ?? 500).end();
    });
    expect((await request(app).get('/v1/me/username/history')).status).toBe(401);
  });
});
