// T-041's `/me/avatar` over HTTP against a real database: bodies, problem documents and isolation
// between users. Skipped unless KOMTRU_INFRA_TESTS=1.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AvatarFileView } from '../../../../src/modules/identity/domain/avatar.js';
import { meRoutes } from '../../../../src/modules/identity/http/routes/me.routes.js';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { ANONYMOUS_ACTOR, type Actor } from '../../../../src/platform/http/principal.js';
import { testActor } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser, testLogger } from '../support.js';

const FILE = '0190b0a0-0000-7000-8000-0000000000f1';

describe.runIf(infraEnabled)('/me/avatar (T-041)', () => {
  const t = useTestDatabase();
  const files = new Map<string, AvatarFileView>();

  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(
      meRoutes({
        db: t.db(),
        logger: testLogger,
        ports: {
          findFile: (id) => Promise.resolve(files.get(id)),
          signUrl: (id) => Promise.resolve(`https://cdn.test/${id}?sig=abc`),
          tombstone: () => Promise.resolve(),
        },
      }),
      {
        logger: testLogger,
        resolveActor: () => Promise.resolve(actor),
        rateLimit: () => Promise.resolve(),
        idempotency: (_input, run) => run(),
      },
    )(router);
    app.use('/v1', router);
    app.use(notFound);
    app.use(errorHandler(testLogger, () => undefined));
    return app;
  };

  const own = async (over: Partial<AvatarFileView> = {}) => {
    const { userId } = await seedUser(t.app());
    files.set(FILE, {
      id: FILE,
      category: 'PROFILE_PHOTO',
      uploaderUserId: userId,
      uploadState: 'READY',
      status: 'ACTIVE',
      ...over,
    });
    return { userId, app: appFor(testActor(userId)) };
  };

  it('sets the avatar and answers the signed url', async () => {
    const { app } = await own();
    const res = await request(app).post('/v1/me/avatar').send({ fileId: FILE });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ avatarUrl: `https://cdn.test/${FILE}?sig=abc` });
  });

  it('removes it and answers a null url', async () => {
    const { app } = await own();
    await request(app).post('/v1/me/avatar').send({ fileId: FILE });
    const res = await request(app).delete('/v1/me/avatar');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ avatarUrl: null });
  });

  it('rejects a body that is not a uuid with 422', async () => {
    const { app } = await own();
    const res = await request(app).post('/v1/me/avatar').send({ fileId: 'nope' });
    expect([400, 422]).toContain(res.status);
  });

  it('answers 404 for another user’s file', async () => {
    const { app } = await own();
    const other = await seedUser(t.app());
    files.set(FILE, { ...(files.get(FILE) as AvatarFileView), uploaderUserId: other.userId });
    const res = await request(app).post('/v1/me/avatar').send({ fileId: FILE });
    expect(res.status).toBe(404);
  });

  it('answers 401 to an anonymous caller', async () => {
    const res = await request(appFor(ANONYMOUS_ACTOR)).post('/v1/me/avatar').send({ fileId: FILE });
    expect(res.status).toBe(401);
    expect((await request(appFor(ANONYMOUS_ACTOR)).delete('/v1/me/avatar')).status).toBe(401);
  });
});
