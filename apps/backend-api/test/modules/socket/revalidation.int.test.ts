// The other half of the ticket: "sessions are re-validated when the user's session epoch bumps;
// revoked sockets disconnect". The unit tests in services/revalidate.test.ts pin the policy; this
// pins that the policy is actually armed, against a real `users.sessions_epoch` bumped by identity's
// own kill switch, over a real WebSocket.
//
// Skipped unless KOMTRU_INFRA_TESTS=1.
import type { Redis } from 'ioredis';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  applyKillSwitch,
  bumpSessionsEpoch,
  createSession,
  revokeSessionFamily,
  type SessionDeps,
} from '../../../src/modules/identity/services/session.service.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  createTestRedis,
  identityInfrastructure,
  seedUser,
  testConfig,
  testLogger,
} from '../identity/support.js';
import { client, connected, nextEvent, sharedEnv, startInstance, type ApiInstance } from './support.int.js';

describe.runIf(infraEnabled)('re-validating a live socket', () => {
  const t = useTestDatabase();
  // The configured floor, so a sweep lands inside the test's budget. Production runs at 30s.
  const env = sharedEnv({ SOCKET_REVALIDATE_INTERVAL_SECONDS: '5' });
  const config = testConfig({ IDENTITY_SIGNING_KEY: env.IDENTITY_SIGNING_KEY as string });
  let a: ApiInstance;
  let b: ApiInstance;
  let redis: Redis;
  let deps: SessionDeps;
  const sockets: Socket[] = [];

  const login = async () => {
    const { userId } = await seedUser(t.app());
    const session = await t
      .db()
      .transaction((tx) =>
        createSession(tx, deps, { userId, scope: 'CONSUMER', amr: ['pwd'], ip: '10.0.0.1' }),
      );
    return { ...session, userId };
  };

  const disconnected = (socket: Socket): Promise<string> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the socket was never disconnected')), 30_000);
      socket.once('disconnect', (reason: string) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });

  // Vitest's defaults are 5s per test and 10s per hook; a sweep alone can be SWEEP_MS away, on top
  // of seeding, a session transaction and two API boots.
  const BUDGET_MS = 40_000;
  const SWEEP_MS = 5_000;

  beforeAll(async () => {
    redis = createTestRedis();
    const { signer, epochs } = identityInfrastructure(config, redis);
    deps = { signer, epochs, logger: testLogger };
    a = await startInstance(env);
    b = await startInstance(env);
  }, BUDGET_MS);

  afterEach(() => {
    while (sockets.length > 0) sockets.pop()?.close();
  });

  afterAll(async () => {
    await a.api.stop();
    await b.api.stop();
    // Never flush: this Redis database is shared with every other test file vitest runs in parallel.
    redis.disconnect();
  });

  it(
    'disconnects an already-open socket when the user’s session epoch bumps',
    async () => {
      const session = await login();
      const socket = client(b, { token: session.accessToken });
      sockets.push(socket);
      await connected(socket);

      const revoked = nextEvent<{ code: string }>(socket, 'auth:revoked', 30_000);
      const closed = disconnected(socket);
      // The epoch ALONE, with the session rows left alive. `applyKillSwitch` would also revoke every
      // session, and `resolvePrincipal` checks `revoked_at` before the epoch — so this is the only
      // way to prove the epoch itself is what disconnects the socket. Nothing here tells the socket
      // layer anything; the sweep is what notices.
      await t.db().transaction((tx) => bumpSessionsEpoch(tx, session.userId));
      await deps.epochs.invalidate(session.userId);

      await expect(revoked).resolves.toEqual({ code: 'EPOCH_STALE' });
      await expect(closed).resolves.toBeTruthy();
    },
    BUDGET_MS,
  );

  it(
    'disconnects on the full M1 D5 kill switch, which revokes the sessions too',
    async () => {
      const session = await login();
      const socket = client(b, { token: session.accessToken });
      sockets.push(socket);
      await connected(socket);

      const revoked = nextEvent<{ code: string }>(socket, 'auth:revoked', 30_000);
      await applyKillSwitch(t.db(), deps, { userId: session.userId, reason: 'test' });
      // SESSION_REVOKED rather than EPOCH_STALE: `resolvePrincipal` checks `revoked_at` first, and
      // the kill switch does both in one transaction. Either answer disconnects the socket.
      await expect(revoked).resolves.toEqual({ code: 'SESSION_REVOKED' });
    },
    BUDGET_MS,
  );

  it(
    'disconnects on logout, which revokes the family without bumping the epoch',
    async () => {
      const session = await login();
      const socket = client(b, { token: session.accessToken });
      sockets.push(socket);
      await connected(socket);

      const revoked = nextEvent<{ code: string }>(socket, 'auth:revoked', 30_000);
      // Logout: the whole refresh-token family goes, the epoch does not move. The sweep must still
      // notice, because the epoch is not the only thing that can kill a session.
      await revokeSessionFamily(t.db(), { refreshToken: session.refreshToken, reason: 'logout' });

      await expect(revoked).resolves.toEqual({ code: 'SESSION_REVOKED' });
    },
    BUDGET_MS,
  );

  it(
    'drops a socket held by instance B when instance A calls disconnectUser',
    async () => {
      const session = await login();
      const socket = client(b, { token: session.accessToken });
      sockets.push(socket);
      await connected(socket);

      const closed = disconnected(socket);
      a.gateway.disconnectUser(session.userId, 'suspended');
      await expect(closed).resolves.toBeTruthy();
    },
    BUDGET_MS,
  );

  it(
    'keeps a socket whose session is untouched across a sweep',
    async () => {
      const session = await login();
      const socket = client(b, { token: session.accessToken });
      sockets.push(socket);
      await connected(socket);

      // Two sweep intervals plus slack, so at least one has certainly run.
      await new Promise((resolve) => setTimeout(resolve, SWEEP_MS * 2 + 1_000));
      expect(socket.connected).toBe(true);
    },
    BUDGET_MS,
  );
});
