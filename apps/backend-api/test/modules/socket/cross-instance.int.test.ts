// The ticket's named acceptance test: "an event emitted on instance A reaches a socket on instance
// B". Without the Redis adapter this is the test that fails, and it is the only one that can
// distinguish a working adapter from a gateway that merely works in one process.
//
// Skipped unless KOMTRU_INFRA_TESTS=1.
import type { SessionScope } from '@komtru/shared-types';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSession, type SessionDeps } from '../../../src/modules/identity/services/session.service.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  createTestRedis,
  identityInfrastructure,
  seedUser,
  testConfig,
  testLogger,
} from '../identity/support.js';
import {
  client,
  connected,
  nextEvent,
  rejection,
  sharedEnv,
  startInstance,
  type ApiInstance,
} from './support.int.js';

describe.runIf(infraEnabled)('socket fan-out across instances', () => {
  const t = useTestDatabase();
  // Both instances share this environment, so they share a signing key, a Redis and a database —
  // which is what two API processes behind one load balancer actually have.
  const env = sharedEnv({ SOCKET_CORS_ORIGINS: '' });
  const config = testConfig({ IDENTITY_SIGNING_KEY: env.IDENTITY_SIGNING_KEY as string });
  let a: ApiInstance;
  let b: ApiInstance;
  const sockets: Socket[] = [];

  const login = async (scope: SessionScope = 'CONSUMER') => {
    const { userId } = await seedUser(t.app());
    const redis = createTestRedis();
    const { signer, epochs } = identityInfrastructure(config, redis);
    const deps: SessionDeps = { signer, epochs, logger: testLogger };
    const session = await t
      .db()
      .transaction((tx) => createSession(tx, deps, { userId, scope, amr: ['pwd'], ip: '10.0.0.1' }));
    redis.disconnect();
    return { ...session, userId };
  };

  // Vitest's defaults are 5s per test and 10s per hook; two API boots and a real handshake need
  // more than that against a cold template database.
  const BUDGET_MS = 30_000;

  beforeAll(async () => {
    a = await startInstance(env);
    b = await startInstance(env);
  }, BUDGET_MS);

  afterEach(() => {
    while (sockets.length > 0) sockets.pop()?.close();
  });

  afterAll(async () => {
    await a.api.stop();
    await b.api.stop();
  }, BUDGET_MS);

  it(
    'delivers an event emitted on instance A to a socket connected to instance B',
    async () => {
      const session = await login();
      const socket = client(b, { token: session.accessToken });
      sockets.push(socket);
      await connected(socket);

      const received = nextEvent<{ n: number }>(socket, 'test.ping');
      a.gateway.emitToUser(session.userId, 'test.ping', { n: 1 });
      await expect(received).resolves.toEqual({ n: 1 });
    },
    BUDGET_MS,
  );

  it(
    'delivers to a feature room across instances once the socket has joined it',
    async () => {
      const session = await login();
      // Both instances must know the prefix: the authorizer runs where the socket lives (B), and the
      // emit happens on A, which only needs the room name. Not `trade`: that prefix belongs to the
      // trades module (T-068), which claims it at start with a real authorizer.
      for (const instance of [a, b]) instance.gateway.registerRoomAuthorizer('fanout', () => true);
      const socket = client(b, { token: session.accessToken });
      sockets.push(socket);
      await connected(socket);

      const joined: unknown = await socket.emitWithAck('room:join', { prefix: 'fanout', id: 'room-1' });
      expect(joined).toEqual({ joined: true });

      const received = nextEvent<{ ok: boolean }>(socket, 'trade.updated');
      a.gateway.emitToRoom('fanout', 'room-1', 'trade.updated', { ok: true });
      await expect(received).resolves.toEqual({ ok: true });
    },
    BUDGET_MS,
  );

  it(
    'does not deliver a personal push to another user',
    async () => {
      const mine = await login();
      const theirs = await login();
      const socket = client(b, { token: mine.accessToken });
      sockets.push(socket);
      await connected(socket);

      let delivered = false;
      socket.on('test.ping', () => void (delivered = true));
      a.gateway.emitToUser(theirs.userId, 'test.ping', {});
      // Give the adapter's round trip a generous window; the assertion is that nothing arrived.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(delivered).toBe(false);
    },
    BUDGET_MS,
  );

  it(
    'refuses a handshake with no credential',
    async () => {
      const socket = client(b, {});
      sockets.push(socket);
      await expect(rejection(socket)).resolves.toBe('TOKEN_MISSING');
    },
    BUDGET_MS,
  );

  it(
    'refuses a handshake whose credential is not a token this API signed',
    async () => {
      const socket = client(b, { token: 'not.a.jwt' });
      sockets.push(socket);
      await expect(rejection(socket)).resolves.toBe('TOKEN_INVALID');
    },
    BUDGET_MS,
  );

  it(
    'never trusts a client-supplied user id for room membership',
    async () => {
      const mine = await login();
      const theirs = await login();
      const socket = client(b, { token: mine.accessToken, userId: theirs.userId });
      sockets.push(socket);
      await connected(socket);

      let delivered = false;
      socket.on('test.ping', () => void (delivered = true));
      a.gateway.emitToUser(theirs.userId, 'test.ping', {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(delivered).toBe(false);
    },
    BUDGET_MS,
  );

  it(
    'closes its sockets cleanly on shutdown instead of waiting out the HTTP drain',
    async () => {
      // A live websocket keeps server.close() from ever completing, so without a socket closer
      // running BEFORE the drain every shutdown burns the full 5s timeout and then destroys the
      // connection abruptly — which a reconnecting client answers by retrying against a dying
      // instance. `socketDrain` is what makes this fast and graceful.
      const session = await login();
      const instance = await startInstance(env);
      const socket = client(instance, { token: session.accessToken });
      sockets.push(socket);
      await connected(socket);

      const closed = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
      const startedAt = Date.now();
      const outcome = await instance.api.stop();
      await closed;

      expect(outcome.clean).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    },
    BUDGET_MS,
  );
});
