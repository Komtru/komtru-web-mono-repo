// T-068 end to end: two API processes, a real Socket.IO client, the real Postgres. A party joins their
// trade's room and is pushed to; a user who is not a party is refused, and is never pushed to even
// though the push is emitted into the room. Skipped unless KOMTRU_INFRA_TESTS=1.
import type { SessionScope } from '@komtru/shared-types';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSession, type SessionDeps } from '../../../src/modules/identity/services/session.service.js';
import { TRADE_PUSHES, pushHandler } from '../../../src/modules/trades/infrastructure/realtime.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import {
  createTestRedis,
  grantRole,
  identityInfrastructure,
  seedUser,
  testConfig,
  testLogger,
} from '../identity/support.js';
import {
  client,
  connected,
  nextEvent,
  sharedEnv,
  startInstance,
  type ApiInstance,
} from '../socket/support.int.js';
import { driveTo, insertTrade } from './support.js';

describe.runIf(infraEnabled)('trade rooms over a real socket (T-068)', () => {
  const t = useTestDatabase();
  const env = sharedEnv({ SOCKET_CORS_ORIGINS: '' });
  const config = testConfig({ IDENTITY_SIGNING_KEY: env.IDENTITY_SIGNING_KEY as string });
  let a: ApiInstance;
  let b: ApiInstance;
  const sockets: Socket[] = [];
  const BUDGET_MS = 30_000;

  const login = async (scope: SessionScope = 'CONSUMER', permissions?: string[]) => {
    const { userId } = await seedUser(t.app());
    if (permissions) await grantRole(t.owner(), userId, `ROLE_${userId.slice(0, 8)}`, permissions);
    const redis = createTestRedis();
    const { signer, epochs } = identityInfrastructure(config, redis);
    const deps: SessionDeps = { signer, epochs, logger: testLogger };
    const session = await t
      .db()
      .transaction((tx) => createSession(tx, deps, { userId, scope, amr: ['pwd'], ip: '10.0.0.1' }));
    redis.disconnect();
    return { ...session, userId };
  };

  const open = async (instance: ApiInstance, token: string) => {
    const socket = client(instance, { token });
    sockets.push(socket);
    await connected(socket);
    return socket;
  };

  const join = (socket: Socket, id: string): Promise<unknown> =>
    socket.emitWithAck('room:join', { prefix: 'trade', id });

  const tradeFor = async (buyer: string, seller: string): Promise<string> => {
    const id = await insertTrade(t.owner(), { buyer, seller });
    // A sent proposal: a draft is nobody else's yet, so the counterparty could not join its room (and should not).
    await driveTo(t.owner(), id, 'AWAITING_ACCEPTANCE');
    const { rows } = await t
      .owner()
      .query<{ trade_code: string }>(`SELECT trade_code FROM trade.trades WHERE id = $1`, [id]);
    return rows[0]!.trade_code;
  };

  const pushInto = (instance: ApiInstance, tradeCode: string) => {
    const push = TRADE_PUSHES[0]!;
    return pushHandler(
      instance.gateway,
      testLogger,
      push,
    )({
      eventId: 'e',
      eventType: 'trades.trade.state_changed',
      occurredAt: new Date().toISOString(),
      payload: {
        tradeId: '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f9999',
        tradeCode,
        action: 'FUND',
        from: 'PENDING_PAYMENT',
        to: 'FUNDED',
        actorType: 'LEDGER',
      },
    } as never);
  };

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
    'lets both parties join and pushes the update to them across instances, not to a stranger',
    async () => {
      const buyer = await login();
      const seller = await login();
      const stranger = await login();
      const code = await tradeFor(buyer.userId, seller.userId);

      const buyerSocket = await open(b, buyer.accessToken);
      const sellerSocket = await open(a, seller.accessToken);
      const strangerSocket = await open(b, stranger.accessToken);

      expect(await join(buyerSocket, code)).toEqual({ joined: true });
      expect(await join(sellerSocket, code)).toEqual({ joined: true });
      expect(await join(strangerSocket, code)).toEqual({ joined: false, reason: 'FORBIDDEN' });

      let strangerHeard = false;
      strangerSocket.on('trade:updated', () => void (strangerHeard = true));
      const buyerHears = nextEvent<{ status: string; tradeCode: string }>(buyerSocket, 'trade:updated');
      const sellerHears = nextEvent<{ status: string }>(sellerSocket, 'trade:updated');
      // Emitted on A while the buyer's socket lives on B.
      await (
        await pushInto(a, code)
      )();

      expect(await buyerHears).toMatchObject({ status: 'FUNDED', tradeCode: code, kind: 'STATE_CHANGED' });
      expect(await sellerHears).toMatchObject({ status: 'FUNDED' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(strangerHeard).toBe(false);
    },
    BUDGET_MS,
  );

  it(
    'refuses a stranger, a non-party staff member and a made-up trade, and admits trade.view_all staff',
    async () => {
      const buyer = await login();
      const seller = await login();
      const code = await tradeFor(buyer.userId, seller.userId);

      const stranger = await open(a, (await login()).accessToken);
      expect(await join(stranger, code)).toEqual({ joined: false, reason: 'FORBIDDEN' });

      const unprivileged = await open(a, (await login('STAFF', ['trade.view'])).accessToken);
      expect(await join(unprivileged, code)).toEqual({ joined: false, reason: 'FORBIDDEN' });

      const staff = await open(a, (await login('STAFF', ['trade.view_all'])).accessToken);
      expect(await join(staff, code)).toEqual({ joined: true });
      expect(await join(staff, 'KMT-0000000-NG')).toEqual({ joined: false, reason: 'FORBIDDEN' });
    },
    BUDGET_MS,
  );
});
