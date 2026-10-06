// T-031: the principal is re-resolved from Postgres on every request and nothing is read off the
// token. Skipped unless KOMTRU_INFRA_TESTS=1.
import type { SessionScope } from '@komtru/shared-types';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEpochCache } from '../../../src/modules/identity/infrastructure/redis/epoch-cache.js';
import {
  resolvePrincipal,
  type PrincipalDeps,
} from '../../../src/modules/identity/services/principal.service.js';
import { createActorResolver } from '../../../src/modules/identity/http/middleware.js';
import { ANONYMOUS_ACTOR, type Actor } from '../../../src/platform/http/principal.js';
import { createRedis } from '../../../src/platform/redis/connections.js';
import { infraEnabled, testKeyPrefix } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  createTestRedis,
  grantRole,
  identityInfrastructure,
  seedUser,
  testConfig,
  testLogger,
} from './support.js';

describe.runIf(infraEnabled)('principal resolution', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let deps: PrincipalDeps;

  beforeEach(() => {
    redis ??= createTestRedis();
    const { signer, epochs } = identityInfrastructure(config, redis);
    deps = { db: t.db(), signer, epochs, logger: testLogger };
  });

  afterAll(() => {
    // Never flush this database wholesale: it is shared with every other test file vitest runs in
    // parallel, and a flush wipes their BullMQ queues out from under a job in flight. Nothing here
    // needs cleaning anyway — every key is `identity:epoch:<a uuid this test just made>`, and the
    // cache writes them with a TTL.
    redis?.disconnect();
  });

  const seedSession = async ({
    scope = 'CONSUMER',
    status = 'ACTIVE',
    idle = "now() + interval '1 day'",
    absolute = "now() + interval '30 days'",
  }: { scope?: SessionScope; status?: string; idle?: string; absolute?: string } = {}) => {
    const { userId, publicId } = await seedUser(t.app(), { status });
    const { rows } = await t.app().query<{ id: string; family_id: string }>(
      `INSERT INTO identity.sessions
         (user_id, scope, family_id, refresh_token_hash, absolute_expires_at, idle_expires_at, amr)
       VALUES ($1, $2, gen_random_uuid(), $3, ${absolute}, ${idle}, ARRAY['pwd'])
       RETURNING id, family_id`,
      [userId, scope, Buffer.from(userId.replaceAll('-', ''), 'hex')],
    );
    const row = rows[0]!;
    const { rows: epochRows } = await t
      .app()
      .query<{ sessions_epoch: number }>(`SELECT sessions_epoch FROM identity.users WHERE id = $1`, [userId]);
    const token = await deps.signer.sign({
      sub: userId,
      sid: row.id,
      scp: scope,
      epc: epochRows[0]!.sessions_epoch,
    });
    return { userId, publicId, sessionId: row.id, familyId: row.family_id, token };
  };

  it('resolves the principal from the database, not from the token', async () => {
    const { userId, publicId, sessionId, familyId, token } = await seedSession();
    const actor = await resolvePrincipal(deps, token);
    expect(actor.key).toBe(`user:${userId}`);
    expect(actor.principal).toMatchObject({
      userId,
      publicId,
      sessionId,
      familyId,
      scope: 'CONSUMER',
      status: 'ACTIVE',
      sessionsEpoch: 1,
      amr: ['pwd'],
      roles: [],
      companyMembership: null,
    });
    expect([...actor.principal!.permissions]).toEqual([]);
  });

  it('stops a revoked session on the very next request', async () => {
    const { sessionId, token } = await seedSession();
    expect((await resolvePrincipal(deps, token)).principal).not.toBeNull();
    await t.app().query(`UPDATE identity.sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
    expect(await resolvePrincipal(deps, token)).toMatchObject({
      principal: null,
      failure: 'SESSION_REVOKED',
    });
  });

  it('rejects a session past its idle deadline and one past its absolute deadline', async () => {
    const idled = await seedSession({ idle: "now() - interval '1 second'" });
    expect(await resolvePrincipal(deps, idled.token)).toMatchObject({ failure: 'SESSION_EXPIRED' });
    const lapsed = await seedSession({ absolute: "now() - interval '1 second'" });
    expect(await resolvePrincipal(deps, lapsed.token)).toMatchObject({ failure: 'SESSION_EXPIRED' });
  });

  it('rejects a session whose row no longer exists', async () => {
    const { sessionId, token } = await seedSession();
    await t.app().query(`DELETE FROM identity.sessions WHERE id = $1`, [sessionId]);
    expect(await resolvePrincipal(deps, token)).toMatchObject({ failure: 'SESSION_REVOKED' });
  });

  it('rejects a token whose epoch the database has moved past, even with a stale cache', async () => {
    const { userId, token } = await seedSession();
    await resolvePrincipal(deps, token); // warms the cache at epoch 1
    expect(await redis.get(`identity:epoch:${userId}`)).toBe('1');
    await t
      .app()
      .query(`UPDATE identity.users SET sessions_epoch = sessions_epoch + 1 WHERE id = $1`, [userId]);
    // The cache still says 1 and would admit the token; the row is what decides.
    expect(await resolvePrincipal(deps, token)).toMatchObject({ failure: 'EPOCH_STALE' });
  });

  it('rejects a stale epoch from the cache without querying the session at all', async () => {
    const { userId, token } = await seedSession();
    await deps.epochs.write(userId, 99);
    const execute = vi.spyOn(deps.db, 'execute');
    expect(await resolvePrincipal(deps, token)).toMatchObject({ failure: 'EPOCH_STALE' });
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
  });

  it('keeps working when Redis is unavailable, falling back to the row', async () => {
    const { token } = await seedSession();
    // A real client pointed at nothing: the cache has to swallow its own failures, because losing
    // the fast deny path must not take the whole API down with it.
    const unreachable = createRedis('redis://localhost:1', { keyPrefix: testKeyPrefix() });
    try {
      const broken: PrincipalDeps = {
        ...deps,
        epochs: createEpochCache(unreachable, 10, testLogger),
      };
      expect((await resolvePrincipal(broken, token)).principal).not.toBeNull();
    } finally {
      unreachable.disconnect();
    }
  });

  it.each(['SUSPENDED', 'LOCKED', 'CLOSED', 'ANONYMISED'])('refuses a %s user', async (status) => {
    const { userId, token } = await seedSession();
    await t.app().query(`UPDATE identity.users SET status = $2 WHERE id = $1`, [userId, status]);
    expect(await resolvePrincipal(deps, token)).toMatchObject({ failure: 'USER_INACTIVE' });
  });

  it.each(['ACTIVE', 'PENDING_VERIFICATION', 'RESTRICTED'])('admits a %s user', async (status) => {
    const { userId, token } = await seedSession();
    await t.app().query(`UPDATE identity.users SET status = $2 WHERE id = $1`, [userId, status]);
    expect((await resolvePrincipal(deps, token)).principal).toMatchObject({ status });
  });

  it('refuses a token whose scope no longer matches the session row', async () => {
    const { sessionId, token } = await seedSession({ scope: 'CONSUMER' });
    await t.app().query(`UPDATE identity.sessions SET scope = 'STAFF' WHERE id = $1`, [sessionId]);
    expect(await resolvePrincipal(deps, token)).toMatchObject({ failure: 'TOKEN_INVALID' });
  });

  it('re-resolves roles and permissions on every request', async () => {
    const { userId, token } = await seedSession({ scope: 'STAFF' });
    expect((await resolvePrincipal(deps, token)).principal!.permissions.size).toBe(0);

    await grantRole(t.app(), userId, 'OPERATIONS_ADMIN', ['user.suspend', 'user.restrict']);
    const granted = (await resolvePrincipal(deps, token)).principal!;
    expect(granted.roles).toEqual(['OPERATIONS_ADMIN']);
    expect([...granted.permissions].sort()).toEqual(['user.restrict', 'user.suspend']);

    await t
      .app()
      .query(`UPDATE identity.admin_role_assignments SET revoked_at = now() WHERE user_id = $1`, [userId]);
    const revoked = (await resolvePrincipal(deps, token)).principal!;
    expect(revoked.roles).toEqual([]);
    expect(revoked.permissions.size).toBe(0);
  });

  it('ignores a role grant that has expired, without any job having run', async () => {
    const { userId, token } = await seedSession({ scope: 'STAFF' });
    await grantRole(t.app(), userId, 'FRAUD_ANALYST', ['user.restrict'], {
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await resolvePrincipal(deps, token)).principal!.permissions.size).toBe(0);
  });

  it('can never see a dual-approval grant without its second approver: the database refuses it', async () => {
    const { userId, token } = await seedSession({ scope: 'STAFF' });
    // The principal query guards this too (`approved_by IS NOT NULL`), but T-030's trigger is what
    // makes the state unreachable in the first place — KT002, asserted here so it stays that way.
    await expect(
      grantRole(t.app(), userId, 'SUPER_ADMIN', ['role.grant'], {
        requiresDualApproval: true,
        approved: false,
      }),
    ).rejects.toMatchObject({ code: 'KT002' });
    expect((await resolvePrincipal(deps, token)).principal!.permissions.size).toBe(0);
  });

  it('reports a forged, tampered or absent token without touching the database', async () => {
    const execute = vi.spyOn(deps.db, 'execute');
    expect(await resolvePrincipal(deps, 'not.a.token')).toMatchObject({ failure: 'TOKEN_INVALID' });
    const stranger = identityInfrastructure(testConfig(), redis).signer;
    const foreign = await stranger.sign({
      sub: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b',
      sid: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c',
      scp: 'CONSUMER',
      epc: 1,
    });
    expect(await resolvePrincipal(deps, foreign)).toMatchObject({ failure: 'TOKEN_INVALID' });
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
  });

  it('reports an expired access token as expired, so the client refreshes rather than signing out', async () => {
    const shortLived = identityInfrastructure(
      testConfig({
        IDENTITY_SIGNING_KEY: config.identity.signingKey!,
        IDENTITY_ACCESS_TOKEN_TTL_SECONDS: '60',
      }),
      redis,
    ).signer;
    const { userId, sessionId } = await seedSession();
    const stale = await shortLived.sign(
      { sub: userId, sid: sessionId, scp: 'CONSUMER', epc: 1 },
      { now: new Date(Date.now() - 600_000) },
    );
    expect(await resolvePrincipal(deps, stale)).toMatchObject({ failure: 'TOKEN_EXPIRED' });
  });
});

describe.runIf(infraEnabled)('the actor resolver', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let resolve: (req: Request) => Promise<Actor>;

  beforeEach(() => {
    redis ??= createTestRedis();
    const { signer, epochs } = identityInfrastructure(config, redis);
    resolve = createActorResolver({ db: t.db(), signer, epochs, logger: testLogger });
  });

  afterAll(() => {
    redis?.disconnect();
  });

  const withHeader = (authorization?: string) =>
    ({
      get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
    }) as Request;

  it('treats no Authorization header as anonymous, not as a failure', async () => {
    expect(await resolve(withHeader())).toEqual(ANONYMOUS_ACTOR);
  });

  it.each(['Basic abc', 'Bearer', 'bearer x y', 'Bearer  '])(
    'rejects %o rather than quietly treating it as anonymous',
    async (header) => {
      expect(await resolve(withHeader(header))).toMatchObject({
        principal: null,
        failure: 'TOKEN_INVALID',
      });
    },
  );
});
