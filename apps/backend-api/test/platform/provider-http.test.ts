import type { ServerResponse } from 'node:http';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProviderHttpError,
  ProviderUnavailableError,
  providerRequest,
  redactUrl,
} from '../../src/platform/providers/http.js';
import { startStubServer, type StubServer } from '../support/stub-server.js';

const silent = pino({ level: 'silent' });

/** A logger whose lines are captured as parsed objects. */
const recordingLogger = () => {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'debug' },
    {
      write: (line: string) => {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
  return { logger, lines };
};

let server: StubServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('redactUrl', () => {
  it('redacts every query value and keeps the parameter names', () => {
    expect(redactUrl('https://api.x.test/v1/a?api_key=sk_live_1&page=2')).toBe(
      'https://api.x.test/v1/a?api_key=[redacted]&page=[redacted]',
    );
  });

  it('redacts the short names a denylist would miss', () => {
    // ?code= is the OAuth authorization code, which is exactly the flow the breaker exists for.
    expect(redactUrl('https://accounts.x.test/token?code=4%2F0Ab&sig=abc&auth=xyz')).toBe(
      'https://accounts.x.test/token?code=[redacted]&sig=[redacted]&auth=[redacted]',
    );
  });

  it('redacts credentials carried in the url userinfo', () => {
    expect(redactUrl('https://user:pw@api.x.test/v1/a')).toBe('https://[redacted]@api.x.test/v1/a');
  });

  it('never throws on a url it cannot parse', () => {
    expect(redactUrl('not a url')).toBe('[unparseable url]');
  });
});

describe('providerRequest', () => {
  it('returns the status and the parsed json body of a 2xx response', async () => {
    server = await startStubServer((_req, res) => json(res, 200, { status: true, data: { id: 'ch_1' } }));

    const response = await providerRequest<{ status: boolean; data: { id: string } }>(silent, {
      provider: 'paystack',
      operation: 'charge.verify',
      method: 'GET',
      url: `${server.url}/transaction/verify/ref_1`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: true, data: { id: 'ch_1' } });
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('sends the body as json alongside the caller headers', async () => {
    server = await startStubServer((_req, res) => json(res, 200, {}));

    await providerRequest(silent, {
      provider: 'paystack',
      operation: 'transfer.initiate',
      method: 'POST',
      url: `${server.url}/transfer`,
      headers: { authorization: 'Bearer sk_test' },
      body: { amount: 1000 },
    });

    const [hit] = server.hits;
    expect(hit?.body).toBe('{"amount":1000}');
    expect(hit?.headers['content-type']).toBe('application/json');
    expect(hit?.headers.authorization).toBe('Bearer sk_test');
  });

  it('throws ProviderHttpError carrying the status and parsed body on a 4xx', async () => {
    server = await startStubServer((_req, res) => json(res, 422, { message: 'bad' }));

    const error = await providerRequest(silent, {
      provider: 'paystack',
      operation: 'charge.verify',
      method: 'GET',
      url: `${server.url}/x`,
      maxAttempts: 3,
      backoffMs: 1,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ provider: 'paystack', status: 422, body: { message: 'bad' } });
    expect(server.hits).toHaveLength(1);
  });

  it('retries an idempotent GET through 5xx responses and returns the eventual success', async () => {
    server = await startStubServer((_req, res, hit) =>
      hit < 2 ? json(res, 500, { message: 'oops' }) : json(res, 200, { ok: true }),
    );

    const response = await providerRequest(silent, {
      provider: 'paystack',
      operation: 'charge.verify',
      method: 'GET',
      url: `${server.url}/x`,
      backoffMs: 1,
    });

    expect(response.body).toEqual({ ok: true });
    expect(server.hits).toHaveLength(3);
  });

  it('retries a 429', async () => {
    server = await startStubServer((_req, res, hit) =>
      hit === 0 ? json(res, 429, { message: 'slow down' }) : json(res, 200, { ok: true }),
    );

    await providerRequest(silent, {
      provider: 'termii',
      operation: 'sms.send',
      method: 'GET',
      url: `${server.url}/x`,
      backoffMs: 1,
    });

    expect(server.hits).toHaveLength(2);
  });

  it('makes exactly one attempt for a POST that is not declared idempotent', async () => {
    server = await startStubServer((_req, res) => json(res, 500, { message: 'oops' }));

    await expect(
      providerRequest(silent, {
        provider: 'paystack',
        operation: 'transfer.initiate',
        method: 'POST',
        url: `${server.url}/x`,
        backoffMs: 1,
      }),
    ).rejects.toBeInstanceOf(ProviderHttpError);

    expect(server.hits).toHaveLength(1);
  });

  it('retries a POST the caller declares idempotent', async () => {
    server = await startStubServer((_req, res, hit) =>
      hit === 0 ? json(res, 503, {}) : json(res, 200, { ok: true }),
    );

    await providerRequest(silent, {
      provider: 'paystack',
      operation: 'transfer.initiate',
      method: 'POST',
      url: `${server.url}/x`,
      idempotent: true,
      backoffMs: 1,
    });

    expect(server.hits).toHaveLength(2);
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    server = await startStubServer((_req, res) => json(res, 500, { message: 'oops' }));

    const error = await providerRequest(silent, {
      provider: 'paystack',
      operation: 'charge.verify',
      method: 'GET',
      url: `${server.url}/x`,
      maxAttempts: 2,
      backoffMs: 1,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).status).toBe(500);
    expect(server.hits).toHaveLength(2);
  });

  it('fails with reason timeout when an attempt outlives timeoutMs', async () => {
    server = await startStubServer(() => {
      // Never responds.
    });

    const error = await providerRequest(silent, {
      provider: 'dojah',
      operation: 'kyc.verify',
      method: 'POST',
      url: `${server.url}/x`,
      timeoutMs: 30,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).reason).toBe('timeout');
  });

  it('fails with reason timeout when the body stalls after the headers arrive', async () => {
    // A draining load balancer accepts the connection, sends headers and then stops. fetch resolves on
    // the headers, so the deadline has to cover the body too.
    server = await startStubServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"partial":');
    });

    const error = await providerRequest(silent, {
      provider: 'google',
      operation: 'oauth.token',
      method: 'POST',
      url: `${server.url}/x`,
      timeoutMs: 30,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).reason).toBe('timeout');
  });

  it('retries an idempotent call whose body stalls', async () => {
    server = await startStubServer((_req, res, hit) => {
      if (hit === 0) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"partial":');
        return;
      }
      json(res, 200, { ok: true });
    });

    const response = await providerRequest(silent, {
      provider: 'google',
      operation: 'oauth.certs',
      method: 'GET',
      url: `${server.url}/x`,
      timeoutMs: 40,
      backoffMs: 1,
    });

    expect(response.body).toEqual({ ok: true });
    expect(server.hits).toHaveLength(2);
  });

  it('retries a timeout on an idempotent call and succeeds once the provider answers', async () => {
    server = await startStubServer((_req, res, hit) => {
      if (hit === 0) return; // first attempt hangs until its deadline
      json(res, 200, { ok: true });
    });

    const response = await providerRequest(silent, {
      provider: 'dojah',
      operation: 'kyc.verify',
      method: 'GET',
      url: `${server.url}/x`,
      timeoutMs: 40,
      backoffMs: 1,
    });

    expect(response.status).toBe(200);
    expect(server.hits).toHaveLength(2);
  });

  it('fails with reason network when the host refuses the connection', async () => {
    const error = await providerRequest(silent, {
      provider: 'paystack',
      operation: 'charge.verify',
      method: 'GET',
      // Port 1 is privileged and never bound, so this refuses deterministically.
      url: 'http://127.0.0.1:1/x',
      maxAttempts: 1,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).reason).toBe('network');
  });

  it('stops when the caller aborts and does not retry', async () => {
    const controller = new AbortController();
    server = await startStubServer(() => controller.abort());

    const error = await providerRequest(silent, {
      provider: 'paystack',
      operation: 'charge.verify',
      method: 'GET',
      url: `${server.url}/x`,
      signal: controller.signal,
      backoffMs: 1,
    }).catch((e: unknown) => e);

    expect(error).toBe(controller.signal.reason);
    expect(server.hits).toHaveLength(1);
  });

  it('returns the raw text when the provider does not send json', async () => {
    server = await startStubServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('OK');
    });

    const response = await providerRequest(silent, {
      provider: 'termii',
      operation: 'sms.send',
      method: 'GET',
      url: `${server.url}/x`,
    });

    expect(response.body).toBe('OK');
  });

  it('returns the raw text when a provider promising json sends an error page', async () => {
    server = await startStubServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('<html>502 Bad Gateway</html>');
    });

    const response = await providerRequest(silent, {
      provider: 'termii',
      operation: 'sms.send',
      method: 'GET',
      url: `${server.url}/x`,
    });

    expect(response.body).toBe('<html>502 Bad Gateway</html>');
  });

  it('returns undefined for an empty body', async () => {
    server = await startStubServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    const response = await providerRequest(silent, {
      provider: 'termii',
      operation: 'sms.send',
      method: 'GET',
      url: `${server.url}/x`,
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();
  });

  it('logs one line per attempt with the url redacted and no request or response body', async () => {
    server = await startStubServer((_req, res, hit) =>
      hit === 0 ? json(res, 500, { secretish: 'response-detail' }) : json(res, 200, { ok: true }),
    );
    const { logger, lines } = recordingLogger();

    await providerRequest(logger, {
      provider: 'paystack',
      operation: 'transfer.initiate',
      method: 'POST',
      url: `${server.url}/transfer?api_key=sk_live_secret`,
      headers: { authorization: 'Bearer sk_live_secret' },
      body: { account: '0123456789' },
      idempotent: true,
      backoffMs: 1,
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ provider: 'paystack', operation: 'transfer.initiate', attempt: 1 });
    expect(lines[1]).toMatchObject({ attempt: 2, status: 200 });
    expect(lines[1]?.url).toContain('api_key=[redacted]');
    expect(typeof lines[1]?.durationMs).toBe('number');

    const dump = JSON.stringify(lines);
    expect(dump).not.toContain('sk_live_secret');
    expect(dump).not.toContain('0123456789');
    expect(dump).not.toContain('response-detail');
  });

  it('logs a retryable failure at warn and the final give-up at error', async () => {
    server = await startStubServer((_req, res) => json(res, 500, {}));
    const { logger, lines } = recordingLogger();

    await providerRequest(logger, {
      provider: 'paystack',
      operation: 'charge.verify',
      method: 'GET',
      url: `${server.url}/x`,
      maxAttempts: 2,
      backoffMs: 1,
    }).catch(() => undefined);

    // pino levels: warn 40, error 50.
    expect(lines.map((line) => line.level)).toEqual([40, 50]);
  });
});
