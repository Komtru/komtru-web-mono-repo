import { paginatedSchema } from '@komtru/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildPath, buildQuery } from '../src/contracts.js';
import { NetworkError, ProblemError, ResponseShapeError, TimeoutError } from '../src/problems.js';
import { createTransport } from '../src/transport.js';
import { startStubServer, type StubServer } from './support/stub-server.js';

describe('buildPath', () => {
  it('interpolates and encodes every parameter', () => {
    expect(buildPath('/trades/:id/parcels/:parcelId', { id: 'KMT 1', parcelId: 7 })).toBe(
      '/trades/KMT%201/parcels/7',
    );
  });

  it('refuses a path with a parameter nobody supplied', () => {
    expect(() => buildPath('/trades/:id', {})).toThrow(TypeError);
    expect(() => buildPath('/trades/:id', undefined)).toThrow(TypeError);
  });
});

describe('buildQuery', () => {
  it('drops absent values, repeats arrays and stringifies scalars', () => {
    expect(buildQuery({ limit: 20, cursor: undefined, open: true, state: ['FUNDED', 'SHIPPED'] })).toBe(
      '?limit=20&open=true&state=FUNDED&state=SHIPPED',
    );
  });

  it('is empty for nothing to send', () => {
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({ cursor: undefined })).toBe('');
  });
});

describe('createTransport', () => {
  let server: StubServer;

  beforeEach(async () => {
    server = await startStubServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const transport = (timeoutMs?: number) =>
    createTransport({ baseUrl: `${server.url}/v1`, ...(timeoutMs ? { timeoutMs } : {}) });

  it('sends JSON and parses the response against the schema', async () => {
    server.reply(() => ({ status: 201, body: { id: 'trade-1' } }));
    const result = await transport().send({
      method: 'post',
      path: '/trades',
      body: { amount: '45200000' },
      responseSchema: z.object({ id: z.string() }),
    });

    expect(result.data).toEqual({ id: 'trade-1' });
    expect(result.meta.status).toBe(201);
    const sent = server.requests[0];
    expect(sent?.url).toBe('/v1/trades');
    expect(sent?.headers['content-type']).toBe('application/json');
    expect(sent?.headers.accept).toBe('application/json');
    expect(sent?.body).toBe('{"amount":"45200000"}');
  });

  it('sends no body and no content type when there is nothing to send', async () => {
    server.reply(() => ({ status: 200, body: {} }));
    await transport().send({ method: 'get', path: '/trades/t1' });
    expect(server.requests[0]?.headers['content-type']).toBeUndefined();
  });

  it('resolves undefined for a 204', async () => {
    server.reply(() => ({ status: 204 }));
    const result = await transport().send({ method: 'delete', path: '/trades/t1' });
    expect(result.data).toBeUndefined();
    expect(result.meta.status).toBe(204);
  });

  it('throws a ProblemError carrying the server problem', async () => {
    server.reply(() => ({
      status: 409,
      body: { type: 'about:blank', title: 'Not allowed from here', status: 409, code: 'INVALID_TRANSITION' },
    }));
    await expect(transport().send({ method: 'post', path: '/trades/t1/ship' })).rejects.toMatchObject({
      name: 'ProblemError',
      knownCode: 'INVALID_TRANSITION',
      status: 409,
      synthetic: false,
    });
  });

  it('surfaces a proxy error page as a synthetic problem, not a parse crash', async () => {
    server.reply(() => ({ status: 502, body: '<html>bad gateway</html>' }));
    const error = await transport()
      .send({ method: 'get', path: '/trades' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).synthetic).toBe(true);
    expect((error as ProblemError).status).toBe(502);
  });

  it('throws ResponseShapeError when the server breaks its own contract', async () => {
    // `nextCursor` is never omitted on a cursor page; a server that omits it is the bug.
    server.reply(() => ({ status: 200, body: { items: [{ id: 'a' }] } }));
    await expect(
      transport().send({
        method: 'get',
        path: '/trades',
        responseSchema: paginatedSchema(z.object({ id: z.string() })),
      }),
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it('aborts at the timeout as a TimeoutError', async () => {
    server.reply(() => ({ status: 200, body: {}, delayMs: 200 }));
    await expect(transport(20).send({ method: 'get', path: '/trades' })).rejects.toBeInstanceOf(TimeoutError);
  });

  it("propagates a caller's abort as a NetworkError, not a timeout", async () => {
    server.reply(() => ({ status: 200, body: {}, delayMs: 200 }));
    const controller = new AbortController();
    const pending = transport(5_000).send({ method: 'get', path: '/trades', signal: controller.signal });
    controller.abort();
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(TimeoutError);
  });

  it('passes default headers and per-request headers through', async () => {
    server.reply(() => ({ status: 200, body: {} }));
    await createTransport({ baseUrl: server.url, defaultHeaders: { 'X-App': 'park' } }).send({
      method: 'get',
      path: '/ping',
      headers: { 'Idempotency-Key': 'abcdefgh' },
    });
    expect(server.requests[0]?.headers['x-app']).toBe('park');
    expect(server.requests[0]?.headers['idempotency-key']).toBe('abcdefgh');
  });
});
