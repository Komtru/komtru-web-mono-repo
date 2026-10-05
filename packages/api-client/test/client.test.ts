import { paginatedSchema } from '@komtru/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTokenStore, type AuthSession } from '../src/auth/session.js';
import { createApiClient } from '../src/client.js';
import { defineEndpoint } from '../src/contracts.js';
import { beginUserAction, IDEMPOTENCY_KEY_PATTERN } from '../src/idempotency.js';
import { ProblemError } from '../src/problems.js';
import { startStubServer, type StubServer } from './support/stub-server.js';

const tradeSchema = z.object({ id: z.string() });

const createTrade = defineEndpoint({
  method: 'post',
  path: '/trades',
  scope: 'CONSUMER',
  retryable: true,
  schema: { body: z.object({ amount: z.string() }), response: tradeSchema },
});

const cancelTrade = defineEndpoint({
  method: 'post',
  path: '/trades/:id/cancel',
  scope: 'CONSUMER',
  // A repeat is harmless, so the backend asked for no key.
  retryable: false,
  schema: { params: z.object({ id: z.string() }), response: tradeSchema },
});

const listTrades = defineEndpoint({
  method: 'get',
  path: '/trades',
  scope: 'CONSUMER',
  paginated: 'cursor',
  schema: { query: z.object({ cursor: z.string().optional() }), response: paginatedSchema(tradeSchema) },
});

const problemBody = (status: number, code: string) => ({
  type: 'about:blank',
  title: code,
  status,
  code,
});

describe('createApiClient', () => {
  let server: StubServer;
  let slept: number[];

  beforeEach(async () => {
    server = await startStubServer();
    slept = [];
  });

  afterEach(async () => {
    await server.close();
  });

  const client = (overrides: Partial<Parameters<typeof createApiClient>[0]> = {}) =>
    createApiClient({
      baseUrl: `${server.url}/v1`,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
      retry: { random: () => 1 },
      ...overrides,
    });

  const keysSent = () => server.requests.map((request) => request.headers['idempotency-key']);

  describe('the idempotency key', () => {
    it('sends one key, and the same body, across every attempt of one call', async () => {
      server.reply((_request, call) => {
        if (call === 1)
          return { status: 503, headers: { 'Retry-After': '0' }, body: problemBody(503, 'INTERNAL') };
        if (call === 2) return { status: 409, body: problemBody(409, 'CONFLICT') };
        return { status: 201, body: { id: 'trade-1' } };
      });

      await expect(client().call(createTrade, { body: { amount: '45200000' } })).resolves.toEqual({
        id: 'trade-1',
      });

      expect(server.requests).toHaveLength(3);
      const keys = keysSent();
      expect(new Set(keys).size).toBe(1);
      expect(keys[0]).toMatch(IDEMPOTENCY_KEY_PATTERN);
      expect(server.requests.map((request) => request.body)).toEqual([
        '{"amount":"45200000"}',
        '{"amount":"45200000"}',
        '{"amount":"45200000"}',
      ]);
    });

    it("reuses the caller's key so a retried user action stays one action", async () => {
      server.reply((_request, call) =>
        call === 1 ? { status: 500, body: problemBody(500, 'INTERNAL') } : { status: 201, body: { id: 't' } },
      );
      const action = beginUserAction();
      const api = client({ retry: { maxAttempts: 1 } });

      await expect(
        api.call(createTrade, { body: { amount: '1' } }, { idempotencyKey: action.key }),
      ).rejects.toBeInstanceOf(ProblemError);
      await api.call(createTrade, { body: { amount: '1' } }, { idempotencyKey: action.key });

      expect(keysSent()).toEqual([action.key, action.key]);
    });

    it('sends no key for a route the backend did not mark retryable', async () => {
      server.reply(() => ({ status: 200, body: { id: 't' } }));
      await client().call(cancelTrade, { params: { id: 't' } });
      expect(server.requests[0]?.headers['idempotency-key']).toBeUndefined();
    });

    it('sends no key on a read', async () => {
      server.reply(() => ({ status: 200, body: { items: [], nextCursor: null } }));
      await client().call(listTrades, { query: {} });
      expect(server.requests[0]?.headers['idempotency-key']).toBeUndefined();
    });

    it('reports a replayed response so the UI can say "already done"', async () => {
      server.reply(() => ({
        status: 201,
        headers: { 'Idempotent-Replayed': 'true' },
        body: { id: 'trade-1' },
      }));
      const result = await client().callWithMeta(createTrade, { body: { amount: '1' } });
      expect(result.meta.replayed).toBe(true);
      expect(result.idempotencyKey).toMatch(IDEMPOTENCY_KEY_PATTERN);
    });

    it('stops at a reused key rather than hammering the server with it', async () => {
      server.reply(() => ({ status: 422, body: problemBody(422, 'IDEMPOTENCY_KEY_REUSED') }));
      await expect(client().call(createTrade, { body: { amount: '1' } })).rejects.toMatchObject({
        knownCode: 'IDEMPOTENCY_KEY_REUSED',
      });
      expect(server.requests).toHaveLength(1);
    });
  });

  describe('the retry budget', () => {
    it("waits the server's Retry-After on a 429", async () => {
      server.reply((_request, call) =>
        call === 1
          ? { status: 429, headers: { 'Retry-After': '2' }, body: problemBody(429, 'RATE_LIMITED') }
          : { status: 201, body: { id: 't' } },
      );
      await client().call(createTrade, { body: { amount: '1' } });
      expect(slept).toEqual([2_000]);
    });

    it('gives up after maxAttempts and throws the last problem', async () => {
      server.reply(() => ({ status: 503, body: problemBody(503, 'INTERNAL') }));
      await expect(client().call(createTrade, { body: { amount: '1' } })).rejects.toMatchObject({
        status: 503,
      });
      expect(server.requests).toHaveLength(3);
    });

    it('never retries a mutation the backend did not mark retryable', async () => {
      server.reply(() => ({ status: 503, body: problemBody(503, 'INTERNAL') }));
      await expect(client().call(cancelTrade, { params: { id: 't' } })).rejects.toMatchObject({
        status: 503,
      });
      expect(server.requests).toHaveLength(1);
    });

    it('retries a read, which is idempotent by method', async () => {
      server.reply((_request, call) =>
        call === 1
          ? { status: 500, body: problemBody(500, 'INTERNAL') }
          : { status: 200, body: { items: [], nextCursor: null } },
      );
      await client().call(listTrades, { query: {} });
      expect(server.requests).toHaveLength(2);
    });
  });

  describe('the access token', () => {
    const tokens = (refresh: () => Promise<AuthSession | null>) => createTokenStore({ refresh });

    it('sends the bearer token and refreshes once before one retry on a 401', async () => {
      let refreshes = 0;
      const store = tokens(() => {
        refreshes += 1;
        return Promise.resolve({ accessToken: 'new', scope: 'CONSUMER' });
      });
      store.set({ accessToken: 'old', scope: 'CONSUMER' });
      server.reply((_request, call) =>
        call === 1
          ? { status: 401, body: problemBody(401, 'UNAUTHENTICATED') }
          : { status: 200, body: { items: [], nextCursor: null } },
      );

      await client({ tokens: store }).call(listTrades, { query: {} });

      expect(refreshes).toBe(1);
      expect(server.requests.map((request) => request.headers.authorization)).toEqual([
        'Bearer old',
        'Bearer new',
      ]);
    });

    it('refreshes once for two calls that both 401 at the same time', async () => {
      let refreshes = 0;
      const store = tokens(() => {
        refreshes += 1;
        return Promise.resolve({ accessToken: 'new', scope: 'CONSUMER' });
      });
      store.set({ accessToken: 'old', scope: 'CONSUMER' });
      server.reply((request) =>
        request.headers.authorization === 'Bearer old'
          ? { status: 401, body: problemBody(401, 'UNAUTHENTICATED') }
          : { status: 200, body: { items: [], nextCursor: null } },
      );

      const api = client({ tokens: store });
      await Promise.all([api.call(listTrades, { query: {} }), api.call(listTrades, { query: {} })]);

      expect(refreshes).toBe(1);
      expect(server.requests).toHaveLength(4);
    });

    it('retries only once, then surfaces the 401', async () => {
      let refreshes = 0;
      const store = tokens(() => {
        refreshes += 1;
        return Promise.resolve({ accessToken: `new-${String(refreshes)}`, scope: 'CONSUMER' });
      });
      store.set({ accessToken: 'old', scope: 'CONSUMER' });
      server.reply(() => ({ status: 401, body: problemBody(401, 'UNAUTHENTICATED') }));

      await expect(client({ tokens: store }).call(listTrades, { query: {} })).rejects.toMatchObject({
        knownCode: 'UNAUTHENTICATED',
      });
      expect(server.requests).toHaveLength(2);
      expect(refreshes).toBe(1);
    });

    it('surfaces the 401 without retrying when the session is over', async () => {
      const onSessionEnded = vi.fn();
      const store = createTokenStore({ refresh: () => Promise.resolve(null), onSessionEnded });
      store.set({ accessToken: 'old', scope: 'CONSUMER' });
      server.reply(() => ({ status: 401, body: problemBody(401, 'UNAUTHENTICATED') }));

      await expect(client({ tokens: store }).call(listTrades, { query: {} })).rejects.toMatchObject({
        knownCode: 'UNAUTHENTICATED',
      });
      expect(server.requests).toHaveLength(1);
      expect(onSessionEnded).toHaveBeenCalledTimes(1);
    });

    it('sends no Authorization header when there is no session', async () => {
      server.reply(() => ({ status: 200, body: { items: [], nextCursor: null } }));
      await client().call(listTrades, { query: {} });
      expect(server.requests[0]?.headers.authorization).toBeUndefined();
    });
  });

  it('builds the path and the query from the endpoint', async () => {
    server.reply((request) =>
      request.url.includes('cancel')
        ? { status: 200, body: { id: 't' } }
        : { status: 200, body: { items: [], nextCursor: null } },
    );
    const api = client();
    await api.call(listTrades, { query: { cursor: 'abc' } });
    expect(server.requests[0]?.url).toBe('/v1/trades?cursor=abc');

    await api.call(cancelTrade, { params: { id: 'KMT-88213-NG' } });
    expect(server.requests[1]?.url).toBe('/v1/trades/KMT-88213-NG/cancel');
  });
});
