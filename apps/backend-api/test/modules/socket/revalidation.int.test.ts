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
      const timer = setTimeout(() => reject(new Error('the socket was never disconnected')), 20_000);
      socket.once('disconnect', (reason: string) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });

  beforeAll(async () => {
    redis = createTestRedis();
    const { signer, epochs } = identityInfrastructure(config, redis);
    deps = { signer, epochs, logger: testLogger };
    a = await startInstance(env);
    b = await startInstance(env);
  });

  afterEach(() => {
    while (sockets.length > 0) sockets.pop()?.close();
  });

  afterAll(async () => {
    await a.api.stop();
    await b.api.stop();
    // Never flush: this Redis database is shared with every other test file vitest runs in parallel.
    redis.disconnect();
  });

  it('disconnects an already-open socket when the user’s session epoch bumps', async () => {
    const session = await login();
    const socket = client(b, { token: session.accessToken });
    sockets.push(socket);
    await connected(socket);

    const revoked = nextEvent<{ code: string }>(socket, 'auth:revoked', 20_000);
    const closed = disconnected(socket);
    // M1 D5's kill switch: bump the epoch and revoke every session, in one transaction. Nothing
    // here tells the socket layer anything — the sweep is what notices.
    await applyKillSwitch(t.db(), deps, { userId: session.userId, reason: 'test' });

    await expect(revoked).resolves.toEqual({ code: 'EPOCH_STALE' });
    await expect(closed).resolves.toBeTruthy();
  });

  it('disconnects on logout, which revokes the family without bumping the epoch', async () => {
    const session = await login();
    const socket = client(b, { token: session.accessToken });
    sockets.push(socket);
    await connected(socket);

    const revoked = nextEvent<{ code: string }>(socket, 'auth:revoked', 20_000);
    // Logout: the whole refresh-token family goes, the epoch does not move. The sweep must still
    // notice, because the epoch is not the only thing that can kill a session.
    await revokeSessionFamily(t.db(), { refreshToken: session.refreshToken, reason: 'logout' });

    await expect(revoked).resolves.toEqual({ code: 'SESSION_REVOKED' });
  });

  it('drops a socket held by instance B when instance A calls disconnectUser', async () => {
    const session = await login();
    const socket = client(b, { token: session.accessToken });
    sockets.push(socket);
    await connected(socket);

    const closed = disconnected(socket);
    a.gateway.disconnectUser(session.userId, 'suspended');
    await expect(closed).resolves.toBeTruthy();
  });

  it('keeps a socket whose session is untouched across a sweep', async () => {
    const session = await login();
    const socket = client(b, { token: session.accessToken });
    sockets.push(socket);
    await connected(socket);

    // Two sweep intervals, so at least one has certainly run.
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    expect(socket.connected).toBe(true);
  }, 30_000);
});
