// The upload/retrieval flow end to end through the real app, with Cloudinary's Admin API stood in for
// by a local server. Skipped unless KOMTRU_INFRA_TESTS=1.
//
// The point of driving it through `createApp` rather than calling the services is the half the unit
// tests cannot reach: the scope check mountRoutes applies, the strict body schema, the 202 contract on
// finalize, and the problem-details shape of each refusal.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../../../src/db/index.js';
import { createLogger } from '../../../../src/platform/logger.js';
import type { FilesConfig } from '../../../../src/config/env.js';
import { filesRoutes } from '../../../../src/modules/files/http/routes.js';
import { seedStorageAccounts } from '../../../../src/modules/files/services/account.service.js';
import { createCloudinaryClient } from '../../../../src/modules/files/infrastructure/providers/cloudinary.client.js';
import { bindStore } from '../../../../src/modules/files/jobs/store.js';
import { runFinalizeUpload } from '../../../../src/modules/files/jobs/finalize-upload.job.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { actorFor, ANONYMOUS_ACTOR, type Actor } from '../../../../src/platform/http/principal.js';
import { testPrincipal } from '../../../support/actors.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { startStubServer, type StubServer } from '../../../support/stub-server.js';
import express from 'express';
import { errorHandler, notFound } from '../../../../src/platform/errors.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const files: FilesConfig = {
  accounts: Object.fromEntries(
    [
      'CLOUDINARY_PROFILE',
      'CLOUDINARY_CHAT',
      'CLOUDINARY_TRADE_1',
      'CLOUDINARY_TRADE_2',
      'CLOUDINARY_TRADE_3',
    ].map((prefix) => [prefix, { cloudName: `c-${prefix}`, apiKey: '1234', apiSecret: 'not-a-real-secret' }]),
  ),
  maxUploadBytes: 1_000_000,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
};

let stub: StubServer | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe.runIf(infraEnabled)('files routes', () => {
  const t = useTestDatabase();
  const db = (): Db => createDb(t.app());

  /** A minimal app carrying only this module's routes, with `actor` supplied by the test. */
  const appFor = (actor: Actor) => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountRoutes(filesRoutes({ db, queues: () => enqueued, config: () => files, logger: () => logger }), {
      logger,
      resolveActor: () => Promise.resolve(actor),
    })(router);
    app.use('/v1', router);
    app.use(notFound);
    // The unexpected hook is Sentry's in the real app; here it is a no-op, because an unexpected
    // error should fail the assertion below, not be reported somewhere.
    app.use(errorHandler(logger, () => undefined));
    return app;
  };

  /** A queue factory that records rather than dialling Redis: the job is run by hand below. */
  const jobs: { name: string; data: unknown }[] = [];
  const enqueued = {
    producer: (name: string) => ({
      add: (_jobName: string, data: unknown) => {
        jobs.push({ name, data });
        return Promise.resolve({ id: 'stub' });
      },
    }),
  } as never;

  const consumer = (userId = randomUUID()): Actor => actorFor(testPrincipal(userId));
  const staff = (permissions: string[] = []): Actor =>
    actorFor(testPrincipal(randomUUID(), { scope: 'STAFF', permissions: new Set(permissions) }));

  /** supertest types `body` as any; narrow once, here, so no assertion is repeated per assertion. */
  const body = <T>(response: { body: unknown }): T => response.body as T;

  const upload = async (actor: Actor, payload: Record<string, unknown>) =>
    request(appFor(actor)).post('/v1/files/upload-url').send(payload);

  it('issues a signed ticket that never carries the api secret', async () => {
    await seedStorageAccounts(db(), files, logger);
    const response = await upload(consumer(), {
      category: 'KYC_DOCUMENT',
      visibility: 'PRIVATE_OWNER',
      contentType: 'application/pdf',
    });
    expect(response.status).toBe(201);
    expect(body<{ params: Record<string, string> }>(response).params.type).toBe('authenticated');
    expect(JSON.stringify(response.body)).not.toContain('not-a-real-secret');
  });

  it('refuses an anonymous caller with 401, not 403', async () => {
    const response = await upload(ANONYMOUS_ACTOR, {
      category: 'PROFILE_PHOTO',
      visibility: 'PUBLIC',
      contentType: 'image/jpeg',
    });
    expect(response.status).toBe(401);
  });

  it('400s a body carrying a capture timestamp instead of ignoring it', async () => {
    await seedStorageAccounts(db(), files, logger);
    const response = await upload(consumer(), {
      category: 'PROFILE_PHOTO',
      visibility: 'PUBLIC',
      contentType: 'image/jpeg',
      capturedAt: '2020-01-01T00:00:00Z',
    });
    expect(response.status).toBe(422);
  });

  it('runs upload → finalize → retrieve, with Cloudinary asked rather than the client believed', async () => {
    await seedStorageAccounts(db(), files, logger);
    const actor = consumer();
    const uploaderUserId = actor.principal!.userId;

    const ticket = await upload(actor, {
      category: 'KYC_DOCUMENT',
      visibility: 'PRIVATE_OWNER',
      contentType: 'application/pdf',
    });
    const fileId = body<{ fileId: string }>(ticket).fileId;

    const finalize = await request(appFor(actor)).post(`/v1/files/${fileId}/finalize`).send();
    expect(finalize.status).toBe(202);
    expect(body<{ uploadState: string }>(finalize).uploadState).toBe('RECONCILING');
    expect(jobs.at(-1)).toMatchObject({ name: 'files.finalize-upload', data: { fileId } });

    // Not READY until the job has confirmed with Cloudinary.
    const tooEarly = await request(appFor(actor)).get(`/v1/files/${fileId}`);
    expect(tooEarly.status).toBe(409);

    stub = await startStubServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ public_id: 'x', bytes: 2048, format: 'pdf', resource_type: 'image' }));
    });
    await runFinalizeUpload(
      {
        store: bindStore(db()),
        storage: createCloudinaryClient({ files, logger, baseUrl: stub.url, maxAttempts: 1 }),
        files,
        logger,
      },
      { fileId },
    );

    const served = await request(appFor(actor)).get(`/v1/files/${fileId}`);
    expect(served.status).toBe(200);
    const view = body<{ url: string; sizeBytes: number; fileId: string }>(served);
    expect(view.url).toContain('expires_at=');
    expect(view.sizeBytes).toBe(2048);
    expect(view.fileId).toBe(fileId);
    // D1: the caller never learns which of the five accounts holds the bytes.
    expect(Object.keys(view)).not.toContain('cloudName');
    expect(uploaderUserId).toBeTruthy();
  });

  it('gives a stranger the same 404 as a file that does not exist', async () => {
    await seedStorageAccounts(db(), files, logger);
    const owner = consumer();
    const ticket = await upload(owner, {
      category: 'KYC_DOCUMENT',
      visibility: 'PRIVATE_OWNER',
      contentType: 'application/pdf',
    });

    const theirs = await request(appFor(consumer())).get(
      `/v1/files/${body<{ fileId: string }>(ticket).fileId}`,
    );
    const missing = await request(appFor(consumer())).get(`/v1/files/${randomUUID()}`);
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    type Problem = { code: string; title: string };
    expect(body<Problem>(theirs).code).toBe(body<Problem>(missing).code);
    expect(body<Problem>(theirs).title).toBe(body<Problem>(missing).title);
  });

  it('refuses the admin surface to a consumer session with 403, never 401', async () => {
    // A wrong-scope session is not a credential problem: answering 401 would make the api-client
    // refresh and then sign the user out of the app they are legitimately in.
    const response = await request(appFor(consumer()))
      .post(`/v1/admin/files/${randomUUID()}/tombstone`)
      .send({ reason: 'test' });
    expect(response.status).toBe(403);
  });

  it('refuses a staff session that lacks the permission', async () => {
    const response = await request(appFor(staff([])))
      .post(`/v1/admin/files/${randomUUID()}/tombstone`)
      .send({ reason: 'test' });
    expect(response.status).toBe(403);
  });

  it('lists the storage accounts to an auditor, paginated', async () => {
    await seedStorageAccounts(db(), files, logger);
    const response = await request(appFor(staff(['audit.view']))).get('/v1/internal/storage-accounts');
    expect(response.status).toBe(200);
    expect(body<{ items: unknown[] }>(response).items).toHaveLength(5);
    expect(response.body).toHaveProperty('nextCursor');
    expect(JSON.stringify(response.body)).not.toContain('not-a-real-secret');
  });
});
