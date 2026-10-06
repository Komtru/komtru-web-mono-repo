// M20 §9's surface, as declarations. Several of this ticket's acceptance criteria are properties of
// the registration rather than of a handler — which scope may call, which permission, whether a
// capture timestamp can be supplied at all — so they are asserted here.
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES } from '../../../../src/modules/identity/domain/rbac/catalog.js';
import type { FilesConfig } from '../../../../src/config/env.js';
import type { Db } from '../../../../src/db/index.js';
import { createLogger } from '../../../../src/platform/logger.js';
import type { QueueFactory } from '../../../../src/platform/queue/factory.js';
import { ANONYMOUS_ACTOR, type Actor } from '../../../../src/platform/http/principal.js';
import { assertRouteInvariants, type HttpMethod } from '../../../../src/platform/http/route.js';
import { filesRoutes } from '../../../../src/modules/files/http/routes.js';
import { createUploadUrlBody } from '../../../../src/modules/files/http/validations.js';
import { testActor } from '../../../support/actors.js';

const logger = createLogger({ log: { level: 'silent', format: 'json' } } as never);

const files: FilesConfig = {
  accounts: {},
  maxUploadBytes: 1024,
  uploadTicketTtlMinutes: 30,
  signedUrlTtlSeconds: 300,
  quota: { nearPct: 85, disabledPct: 97 },
};

const routes = filesRoutes({
  db: () => ({}) as Db,
  queues: () => ({}) as QueueFactory,
  config: () => files,
  logger: () => logger,
});

const find = (method: HttpMethod, path: string) => {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
};

const ctx = (actor: Actor, overrides: Record<string, unknown> = {}) => ({
  params: {},
  query: {},
  body: {},
  actor,
  req: {} as Request,
  res: {} as Response,
  ...overrides,
});

describe('files routes', () => {
  it('declares the M20 §9 surface', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'POST /files/upload-url',
      'POST /files/:id/finalize',
      'GET /files/:id',
      'GET /admin/files/:id',
      'POST /admin/files/:id/tombstone',
      'POST /admin/files/:id/grants',
      'GET /admin/files/:id/grants',
      'DELETE /admin/files/:id/grants/:grantId',
      'GET /admin/files/:id/access-log',
      'GET /internal/storage-accounts',
      'POST /internal/storage-accounts',
    ]);
  });

  it('passes the platform route invariants', () => {
    expect(() => assertRouteInvariants(routes)).not.toThrow();
  });

  it('scopes the consumer surface to a consumer session', () => {
    for (const [method, path] of [
      ['post', '/files/upload-url'],
      ['post', '/files/:id/finalize'],
      ['get', '/files/:id'],
    ] as const) {
      expect(find(method, path).scope).toBe('CONSUMER');
      expect(find(method, path).permission).toBeUndefined();
    }
  });

  it('puts every admin and internal route behind a staff session and a permission', () => {
    for (const route of routes.filter((r) => r.path.startsWith('/admin') || r.path.startsWith('/internal'))) {
      expect(route.scope).toBe('STAFF');
      expect(route.permission).toBeTruthy();
    }
  });

  it('uses only permissions that exist in the M1 §12.2 catalogue', () => {
    // No file.* permission is introduced: a new code needs a row in the twelve-role matrix, and a
    // permission with no distinct audience is one nobody remembers to grant.
    for (const route of routes) {
      if (route.permission) expect(PERMISSION_CODES).toContain(route.permission);
    }
  });

  it('gives staff a way to retrieve a file at all', () => {
    // Without this route INTERNAL_ONLY — which D2 defines as staff-only — can never be served, a
    // DISPUTE_REVIEWER role grant can never be exercised, and file_access_log.accessed_by_admin_id
    // can never be filled by a real request. Three branches of decideAccess would be dead code.
    const staffRead = find('get', '/admin/files/:id');
    expect(staffRead.scope).toBe('STAFF');
    expect(staffRead.permission).toBe('audit.view');
    expect(staffRead.schema.response).toBe(find('get', '/files/:id').schema.response);
  });

  it('rate-limits the one endpoint that consumes storage quota', () => {
    // Every call writes a row, advances the shared rotation cursor and mints a Cloudinary upload
    // credential. Nothing else in the module bounds how many a single caller may take.
    expect(find('post', '/files/upload-url').rateLimit).toEqual({
      points: 30,
      durationSeconds: 60,
      by: ['ip', 'user'],
    });
  });

  it('takes a destructive permission for tombstoning', () => {
    // Removing a user's uploaded evidence is the same class of act as closing their account.
    expect(find('post', '/admin/files/:id/tombstone').permission).toBe('user.close');
  });

  it('narrows registering a storage account to the permission only SUPER_ADMIN holds', () => {
    // Closer to a deployment action than to operations: a wrong credential_env_prefix here silently
    // removes an account from rotation.
    expect(find('post', '/internal/storage-accounts').permission).toBe('role.grant');
  });

  it('paginates every collection', () => {
    for (const path of [
      '/admin/files/:id/grants',
      '/admin/files/:id/access-log',
      '/internal/storage-accounts',
    ]) {
      expect(find('get', path).paginated).toBe('cursor');
    }
  });

  it('decides retryable on every mutating route', () => {
    for (const route of routes) {
      if (route.method === 'get') continue;
      expect(typeof route.retryable).toBe('boolean');
    }
  });

  it('refuses an anonymous caller through the resolved principal', async () => {
    // requireUserId reads actor.principal, never actor.key. mountRoutes awaits the handler inside an
    // async run(), so a synchronous throw here reaches the problem-details layer exactly as a
    // rejection would — which is why notify's routes are written the same way.
    const refusal = async (run: () => unknown): Promise<unknown> => {
      try {
        await run();
      } catch (error) {
        return error;
      }
      throw new Error('expected a 401');
    };
    expect(
      await refusal(() => find('post', '/files/upload-url').handler(ctx(ANONYMOUS_ACTOR))),
    ).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(await refusal(() => find('get', '/files/:id').handler(ctx(ANONYMOUS_ACTOR)))).toMatchObject({
      status: 401,
    });
  });

  it('never returns the storage object id or the cloud name on a retrieval', () => {
    // D1: a consumer passes a category and never learns which of the five accounts holds the bytes.
    const shape = find('get', '/files/:id').schema.response;
    const keys = Object.keys((shape as unknown as { shape: Record<string, unknown> }).shape);
    expect(keys.sort()).toEqual(['category', 'contentType', 'expiresAt', 'fileId', 'sizeBytes', 'url']);
  });
});

describe('createUploadUrlBody', () => {
  const valid = { category: 'PROFILE_PHOTO', visibility: 'PUBLIC', contentType: 'image/jpeg' };

  it('accepts a well-formed request', () => {
    expect(createUploadUrlBody.parse(valid)).toEqual(valid);
  });

  it('requires an explicit visibility, with no default', () => {
    // D2: the class is set explicitly at upload time and never inferred. A default here — even a
    // conservative one — would be an inference, and getting it wrong in the permissive direction is
    // a KYC document served to the internet.
    expect(() =>
      createUploadUrlBody.parse({ category: 'KYC_DOCUMENT', contentType: 'application/pdf' }),
    ).toThrow();
  });

  it('rejects a client-supplied capture timestamp rather than ignoring it', () => {
    // A park agent app with a wrong device clock must get a 400, not a custody photo stamped in the
    // future. The schema is strict and has no field for one, so the request is refused rather than
    // silently stripped — a client that thinks it sent a capture time should be told it did not.
    expect(() => createUploadUrlBody.parse({ ...valid, capturedAt: '2020-01-01T00:00:00Z' })).toThrow();
  });

  it('rejects a client-supplied hub id', () => {
    // Design §7.3: the hub is resolved server-side from the agent's assignments and is never trusted
    // from the client.
    expect(() =>
      createUploadUrlBody.parse({ ...valid, hubId: '00000000-0000-4000-8000-000000000000' }),
    ).toThrow();
  });

  it('refuses CUSTODY_EVIDENCE over the generic endpoint', () => {
    // M20 has no Park knowledge, so it cannot resolve the hub a custody photo must carry. T-092 calls
    // createUploadTicket through the barrel with the hub it already resolved.
    expect(() =>
      createUploadUrlBody.parse({
        category: 'CUSTODY_EVIDENCE',
        visibility: 'PRIVATE_CASE',
        contentType: 'image/jpeg',
      }),
    ).toThrow();
  });

  it('rejects a category or visibility outside the enums', () => {
    expect(() => createUploadUrlBody.parse({ ...valid, category: 'SOMETHING' })).toThrow();
    expect(() => createUploadUrlBody.parse({ ...valid, visibility: 'SOMETHING' })).toThrow();
  });
});

describe('handlers', () => {
  it('asks for the caller through requireUserId rather than parsing actor.key', async () => {
    // A hand-built actor whose key does not match its principal still resolves to the principal's id:
    // `key` is a storage detail of the idempotency and rate-limit tables, not an authentication fact.
    const actor: Actor = {
      ...testActor('11111111-1111-4111-8111-111111111111'),
      key: 'user:22222222-2222-4222-8222-222222222222',
    };
    // The handler reaches the service, which has no database here, so it fails past the auth check
    // rather than at it — a 401 would mean it read the key.
    let thrown: unknown;
    try {
      await find('post', '/files/upload-url').handler(
        ctx(actor, { body: { category: 'PROFILE_PHOTO', visibility: 'PUBLIC', contentType: 'image/jpeg' } }),
      );
    } catch (error) {
      thrown = error;
    }
    // It fails inside the service, which has no database here — not at the auth check. A 401 would
    // mean the handler had read the mismatched key instead of the principal.
    expect(thrown).toBeDefined();
    expect(thrown).not.toMatchObject({ status: 401 });
  });
});
