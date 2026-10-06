// T-031: refresh rotation, reuse detection and the M1 D5 kill switch, against real Postgres and
// Redis. Skipped unless KOMTRU_INFRA_TESTS=1.
import type { SessionScope } from '@komtru/shared-types';
import type { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyKillSwitch,
  createSession,
  refreshSession,
  revokeAllSessions,
  revokeSessionFamily,
  type IssuedSession,
  type SessionDeps,
} from '../../../src/modules/identity/services/session.service.js';
import {
  resolvePrincipal,
  type PrincipalDeps,
} from '../../../src/modules/identity/services/principal.service.js';
import { sha256 } from '../../../src/platform/crypto/hmac.js';
import { eventually } from '../../support/eventually.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  createTestRedis,
  identityInfrastructure,
  outboxEventTypes,
  seedUser,
  testConfig,
  testLogger,
} from './support.js';

describe.runIf(infraEnabled)('sessions', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let deps: SessionDeps;
  let principalDeps: PrincipalDeps;

  beforeEach(() => {
    redis ??= createTestRedis();
    const { signer, epochs } = identityInfrastructure(config, redis);
    deps = { signer, epochs, logger: testLogger };
    principalDeps = { db: t.db(), signer, epochs, logger: testLogger };
  });

  afterAll(() => {
    // Never flush this database wholesale: it is shared with every other test file vitest runs in
    // parallel, and a flush wipes their BullMQ queues out from under a job in flight. Nothing here
    // needs cleaning anyway — every key is `identity:epoch:<a uuid this test just made>`, and the
    // cache writes them with a TTL.
    redis?.disconnect();
  });

  const login = async (scope: SessionScope = 'CONSUMER'): Promise<IssuedSession & { userId: string }> => {
    const { userId } = await seedUser(t.app());
    const session = await t
      .db()
      .transaction((tx) => createSession(tx, deps, { userId, scope, amr: ['pwd'], ip: '10.0.0.1' }));
    return { ...session, userId };
  };

  const rowsOfFamily = async (familyId: string) => {
    const { rows } = await t.app().query<{
      id: string;
      user_id: string;
      scope: string;
      consumed_at: Date | null;
      revoked_at: Date | null;
      revoke_reason: string | null;
      parent_session_id: string | null;
      absolute_expires_at: Date;
      idle_expires_at: Date;
    }>(`SELECT * FROM identity.sessions WHERE family_id = $1 ORDER BY issued_at`, [familyId]);
    return rows;
  };

  describe('creation', () => {
    it('stores only the hash of a 256-bit refresh token', async () => {
      const issued = await login();
      expect(Buffer.from(issued.refreshToken, 'base64url')).toHaveLength(32);
      const { rows } = await t
        .app()
        .query<{ refresh_token_hash: Buffer }>(
          `SELECT refresh_token_hash FROM identity.sessions WHERE id = $1`,
          [issued.sessionId],
        );
      expect(rows[0]!.refresh_token_hash).toEqual(sha256(issued.refreshToken));
    });

    it('mints an access token the principal resolver accepts', async () => {
      const issued = await login();
      const actor = await resolvePrincipal(principalDeps, issued.accessToken);
      expect(actor.principal).toMatchObject({ sessionId: issued.sessionId, scope: 'CONSUMER' });
      expect(issued.expiresIn).toBe(600);
    });

    it("publishes identity.session.created inside the caller's transaction", async () => {
      const { userId } = await seedUser(t.app());
      await expect(
        t.db().transaction(async (tx) => {
          await createSession(tx, deps, { userId, scope: 'CONSUMER', amr: ['pwd'] });
          throw new Error('the login failed after the session was written');
        }),
      ).rejects.toThrow('the login failed');
      expect(await outboxEventTypes(t.app())).toEqual([]);
      const { rows } = await t.app().query(`SELECT 1 FROM identity.sessions`);
      expect(rows).toHaveLength(0);

      const issued = await login();
      expect(await outboxEventTypes(t.app())).toEqual(['identity.session.created']);
      const { rows: events } = await t
        .app()
        .query<{ payload: Record<string, unknown> }>(`SELECT payload FROM platform.outbox`);
      expect(events[0]!.payload).toMatchObject({
        sessionId: issued.sessionId,
        familyId: issued.familyId,
        scope: 'CONSUMER',
        amr: ['pwd'],
        ip: '10.0.0.1',
      });
    });

    it('refuses to open a session for a user who may not have one', async () => {
      const { userId } = await seedUser(t.app(), { status: 'SUSPENDED' });
      await expect(
        t.db().transaction((tx) => createSession(tx, deps, { userId, scope: 'CONSUMER', amr: ['pwd'] })),
      ).rejects.toThrow(/status/i);
    });

    it('gives staff the 30-minute idle and 8-hour absolute window', async () => {
      const issued = await login('STAFF');
      const minutes = (from: Date) => Math.round((from.getTime() - Date.now()) / 60_000);
      expect(minutes(issued.idleExpiresAt)).toBe(30);
      expect(minutes(issued.absoluteExpiresAt)).toBe(480);
    });
  });

  describe('rotation', () => {
    it('consumes the old row and issues a child in the same family', async () => {
      const first = await login();
      const result = await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
      expect(result.outcome).toBe('ROTATED');
      if (result.outcome !== 'ROTATED') return;

      const rows = await rowsOfFamily(first.familyId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ id: first.sessionId, revoked_at: null });
      expect(rows[0]!.consumed_at).not.toBeNull();
      expect(rows[1]).toMatchObject({
        id: result.session.sessionId,
        parent_session_id: first.sessionId,
        user_id: first.userId,
        scope: 'CONSUMER',
      });
      expect(result.session.refreshToken).not.toBe(first.refreshToken);
    });

    it('keeps the absolute deadline across a rotation and slides only the idle one', async () => {
      const first = await login('STAFF');
      const result = await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
      if (result.outcome !== 'ROTATED') throw new Error('expected a rotation');
      expect(result.session.absoluteExpiresAt).toEqual(first.absoluteExpiresAt);
      expect(result.session.idleExpiresAt.getTime()).toBeGreaterThanOrEqual(first.idleExpiresAt.getTime());
    });

    it('never lets a consumer refresh token mint a staff or logistics session', async () => {
      const first = await login('CONSUMER');
      const result = await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
      if (result.outcome !== 'ROTATED') throw new Error('expected a rotation');
      expect(result.session.scope).toBe('CONSUMER');
      expect(await deps.signer.verify(result.session.accessToken)).toMatchObject({ scp: 'CONSUMER' });

      const { rows } = await t
        .app()
        .query<{ scope: string; user_id: string }>(
          `SELECT DISTINCT scope, user_id FROM identity.sessions WHERE family_id = $1`,
          [first.familyId],
        );
      expect(rows).toEqual([{ scope: 'CONSUMER', user_id: first.userId }]);
    });

    it('reports an unknown refresh token without revoking anything', async () => {
      const first = await login();
      expect(await refreshSession(t.db(), deps, { refreshToken: 'nobody-minted-this' })).toEqual({
        outcome: 'UNKNOWN',
      });
      expect((await rowsOfFamily(first.familyId))[0]!.revoked_at).toBeNull();
    });

    it('refuses a session past its idle deadline and one past its absolute deadline', async () => {
      for (const column of ['idle_expires_at', 'absolute_expires_at']) {
        const issued = await login();
        await t
          .app()
          .query(`UPDATE identity.sessions SET ${column} = now() - interval '1 second' WHERE id = $1`, [
            issued.sessionId,
          ]);
        expect(await refreshSession(t.db(), deps, { refreshToken: issued.refreshToken })).toEqual({
          outcome: 'EXPIRED',
        });
      }
    });

    it('refuses a revoked session', async () => {
      const issued = await login();
      await t
        .app()
        .query(`UPDATE identity.sessions SET revoked_at = now() WHERE id = $1`, [issued.sessionId]);
      expect(await refreshSession(t.db(), deps, { refreshToken: issued.refreshToken })).toEqual({
        outcome: 'REVOKED',
      });
    });

    it.each(['SUSPENDED', 'LOCKED', 'CLOSED'])(
      'refuses to refresh for a %s user and leaves the token unspent',
      async (status) => {
        const issued = await login();
        await t.app().query(`UPDATE identity.users SET status = $2 WHERE id = $1`, [issued.userId, status]);
        expect(await refreshSession(t.db(), deps, { refreshToken: issued.refreshToken })).toEqual({
          outcome: 'USER_INACTIVE',
        });
        // Refusing is not a licence to replay: the row must not have been consumed on the way out.
        expect((await rowsOfFamily(issued.familyId))[0]!.consumed_at).toBeNull();
      },
    );
  });

  describe('reuse detection', () => {
    it('kills the family and publishes the risk event when a consumed token is replayed', async () => {
      const first = await login();
      await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
      const replay = await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
      expect(replay).toMatchObject({ outcome: 'REUSED', familyId: first.familyId });

      const rows = await rowsOfFamily(first.familyId);
      expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(0);
      expect(rows.every((row) => row.revoke_reason === 'reuse_detected')).toBe(true);
      expect(await outboxEventTypes(t.app())).toContain('identity.session.reuse_detected');
    });

    it('stops the access token of every session in the killed family', async () => {
      const first = await login();
      const rotated = await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
      if (rotated.outcome !== 'ROTATED') throw new Error('expected a rotation');
      expect((await resolvePrincipal(principalDeps, rotated.session.accessToken)).principal).not.toBeNull();

      await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
      expect(await resolvePrincipal(principalDeps, rotated.session.accessToken)).toMatchObject({
        failure: 'SESSION_REVOKED',
      });
    });

    it('lets exactly one of two simultaneous refreshes of the same token win', async () => {
      const first = await login();
      const results = await Promise.all([
        refreshSession(t.db(), deps, { refreshToken: first.refreshToken }),
        refreshSession(t.db(), deps, { refreshToken: first.refreshToken }),
      ]);
      expect(results.filter((r) => r.outcome === 'ROTATED')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'REUSED')).toHaveLength(1);
      // The replay killed the family the winner had just extended: nothing is left alive.
      const rows = await rowsOfFamily(first.familyId);
      expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(0);
    });

    it('does not touch another family', async () => {
      const mine = await login();
      const theirs = await login();
      await refreshSession(t.db(), deps, { refreshToken: mine.refreshToken });
      await refreshSession(t.db(), deps, { refreshToken: mine.refreshToken });
      expect((await rowsOfFamily(theirs.familyId))[0]!.revoked_at).toBeNull();
    });
  });

  describe('revocation', () => {
    it('revokes the whole family on logout, and every session of the user on allDevices', async () => {
      const first = await login();
      const second = await t
        .db()
        .transaction((tx) =>
          createSession(tx, deps, { userId: first.userId, scope: 'CONSUMER', amr: ['pwd'] }),
        );
      const rotated = await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
      if (rotated.outcome !== 'ROTATED') throw new Error('expected a rotation');

      expect(
        await revokeSessionFamily(t.db(), {
          refreshToken: rotated.session.refreshToken,
          reason: 'logout',
        }),
      ).toBe(2);
      expect((await rowsOfFamily(second.familyId))[0]!.revoked_at).toBeNull();

      expect(
        await revokeSessionFamily(t.db(), {
          refreshToken: second.refreshToken,
          allDevices: true,
          reason: 'logout_all',
        }),
      ).toBe(1);
      expect((await rowsOfFamily(second.familyId))[0]!.revoked_at).not.toBeNull();
    });

    it('reports nothing revoked for a token nobody minted', async () => {
      expect(await revokeSessionFamily(t.db(), { refreshToken: 'unknown', reason: 'logout' })).toBe(0);
    });

    it('leaves the current session alone when a password change revokes the others', async () => {
      const mine = await login();
      const other = await t
        .db()
        .transaction((tx) =>
          createSession(tx, deps, { userId: mine.userId, scope: 'CONSUMER', amr: ['pwd'] }),
        );
      const revoked = await t.db().transaction((tx) =>
        revokeAllSessions(tx, {
          userId: mine.userId,
          reason: 'password_changed',
          exceptSessionId: mine.sessionId,
        }),
      );
      expect(revoked).toBe(1);
      expect((await rowsOfFamily(mine.familyId))[0]!.revoked_at).toBeNull();
      expect((await rowsOfFamily(other.familyId))[0]!.revoked_at).not.toBeNull();
    });
  });

  describe('the kill switch (M1 D5)', () => {
    it('bumps the epoch, revokes every session and makes a refresh fail, in one transaction', async () => {
      const issued = await login();
      // Warm the epoch cache first: the kill switch must beat a cache that still says otherwise.
      await resolvePrincipal(principalDeps, issued.accessToken);

      const result = await applyKillSwitch(t.db(), deps, { userId: issued.userId, reason: 'fraud' });
      expect(result).toEqual({ epoch: 2, revoked: 1 });

      const { rows } = await t
        .app()
        .query<{ sessions_epoch: number }>(`SELECT sessions_epoch FROM identity.users WHERE id = $1`, [
          issued.userId,
        ]);
      expect(rows[0]!.sessions_epoch).toBe(2);

      // The revoked-session check fires before the epoch one, and the epoch would have caught it
      // too; what matters is that the access token is dead either way.
      expect(await resolvePrincipal(principalDeps, issued.accessToken)).toMatchObject({
        principal: null,
        failure: 'SESSION_REVOKED',
      });
      // The half of D5 that the epoch alone does not cover: the refresh token must be dead too.
      expect(await refreshSession(t.db(), deps, { refreshToken: issued.refreshToken })).toEqual({
        outcome: 'REVOKED',
      });
    });

    it('drops the cached epoch so the fast deny path is right immediately', async () => {
      const issued = await login();
      await resolvePrincipal(principalDeps, issued.accessToken);
      expect(await redis.get(`identity:epoch:${issued.userId}`)).toBe('1');
      await applyKillSwitch(t.db(), deps, { userId: issued.userId, reason: 'fraud' });
      expect(await redis.get(`identity:epoch:${issued.userId}`)).toBeNull();
    });
  });
});

/**
 * The interleaving a single family-wide UPDATE cannot see. Under READ COMMITTED the revoke's
 * snapshot is taken when the statement starts; blocking on a locked row re-checks that row through
 * EvalPlanQual but never re-scans for rows inserted meanwhile. The rotation's child is therefore a
 * phantom to the revoke that runs beside it.
 */
describe.runIf(infraEnabled)('a revoke racing a rotation', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let deps: SessionDeps;

  beforeEach(() => {
    redis ??= createTestRedis();
    const { signer, epochs } = identityInfrastructure(config, redis);
    deps = { signer, epochs, logger: testLogger };
  });

  afterAll(() => {
    // Never flush this database wholesale: it is shared with every other test file vitest runs in
    // parallel, and a flush wipes their BullMQ queues out from under a job in flight. Nothing here
    // needs cleaning anyway — every key is `identity:epoch:<a uuid this test just made>`, and the
    // cache writes them with a TTL.
    redis?.disconnect();
  });

  /** True once some backend in this database is waiting on a lock — i.e. the racer has arrived. */
  const someoneIsBlocked = async () => {
    const { rows } = await t.app().query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return Number(rows[0]!.n) > 0;
  };

  const liveSessions = async (familyId: string) => {
    const { rows } = await t
      .app()
      .query<{ n: string }>(
        `SELECT count(*) AS n FROM identity.sessions WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId],
      );
    return Number(rows[0]!.n);
  };

  /**
   * Parks a rotation inside its open transaction, after the child row is inserted and before the
   * commit: `signer.sign` is the last thing `refreshSession` awaits before returning.
   */
  const pausingDeps = (): { deps: SessionDeps; parked: Promise<void>; release: () => void } => {
    let release!: () => void;
    let arrived!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const parked = new Promise<void>((resolve) => (arrived = resolve));
    let armed = true;
    return {
      release,
      parked,
      deps: {
        ...deps,
        signer: {
          ...deps.signer,
          sign: async (claims, options) => {
            const token = await deps.signer.sign(claims, options);
            if (armed) {
              armed = false;
              arrived();
              await gate;
            }
            return token;
          },
        },
      },
    };
  };

  it('kills the child a rotation committed while the family revoke was blocked', async () => {
    const { userId } = await seedUser(t.app());
    const first = await t
      .db()
      .transaction((tx) => createSession(tx, deps, { userId, scope: 'CONSUMER', amr: ['pwd'] }));
    const second = await refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
    if (second.outcome !== 'ROTATED') throw new Error('expected a rotation');

    // T1: rotate the newest token, and park it with its child row inserted but uncommitted.
    const paused = pausingDeps();
    const rotation = refreshSession(t.db(), paused.deps, {
      refreshToken: second.session.refreshToken,
    });
    await paused.parked;

    // T2: replay the oldest, consumed token of the same family. It locks a different row, so it
    // reaches its family-wide revoke and blocks there on the row T1 holds.
    const replay = refreshSession(t.db(), deps, { refreshToken: first.refreshToken });
    await eventually(someoneIsBlocked);

    paused.release();
    const [rotationResult, replayResult] = await Promise.all([rotation, replay]);

    expect(rotationResult.outcome).toBe('ROTATED');
    expect(replayResult).toMatchObject({ outcome: 'REUSED' });
    // The alarm fired, so nothing in this family may still be usable — least of all the token the
    // rotation just minted, which in the theft case is the thief's.
    expect(await liveSessions(first.familyId)).toBe(0);
  });

  it('kills the child a rotation committed while the kill switch was blocked', async () => {
    const { userId } = await seedUser(t.app());
    const issued = await t
      .db()
      .transaction((tx) => createSession(tx, deps, { userId, scope: 'CONSUMER', amr: ['pwd'] }));

    const paused = pausingDeps();
    const rotation = refreshSession(t.db(), paused.deps, { refreshToken: issued.refreshToken });
    await paused.parked;

    const suspension = applyKillSwitch(t.db(), deps, { userId, reason: 'fraud' });
    await eventually(someoneIsBlocked);

    paused.release();
    const [rotationResult] = await Promise.all([rotation, suspension]);
    expect(rotationResult.outcome).toBe('ROTATED');

    // M1 D5: suspension revokes every session. A survivor would simply refresh and mint a token
    // carrying the new epoch, which is the epoch-only kill switch bug the spec names.
    expect(await liveSessions(issued.familyId)).toBe(0);
  });
});
