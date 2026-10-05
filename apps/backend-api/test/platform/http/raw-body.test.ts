import type { Request } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { ApiError } from '../../../src/platform/errors.js';
import { rawBody, WEBHOOK_PATH_PREFIX } from '../../../src/platform/http/raw-body.js';
import { createLogger } from '../../../src/platform/logger.js';
import { testRedisUrl } from '../../support/db-urls.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: testRedisUrl(),
});
const logger = createLogger(config);

const app = createApp({
  config,
  logger,
  mountV1: (router) => {
    router.post('/webhooks/paystack', (req, res) => {
      res.json({ raw: req.rawBody?.toString('utf8') ?? null, parsed: req.body as unknown });
    });
    router.post('/trades', (req, res) => {
      res.json({ raw: req.rawBody?.toString('utf8') ?? null });
    });
  },
});

// Key order and the escaped non-ASCII character both change under JSON.parse + JSON.stringify, which
// is exactly what breaks a signature check against a reparsed body.
const BODY = '{"b":1,\n  "a":"caf\\u00e9"}';

interface Echo {
  raw: string | null;
  parsed?: unknown;
}

const echo = (body: unknown): Echo => body as Echo;

describe('raw body capture', () => {
  it('gives a webhook route the exact bytes that arrived', async () => {
    const response = await request(app)
      .post('/v1/webhooks/paystack')
      .set('content-type', 'application/json')
      .send(BODY);

    expect(response.status).toBe(200);
    expect(echo(response.body).raw).toBe(BODY);
    expect(JSON.stringify(echo(response.body).parsed)).not.toBe(BODY);
  });

  it('still parses the webhook body as JSON', async () => {
    const response = await request(app)
      .post('/v1/webhooks/paystack')
      .set('content-type', 'application/json')
      .send(BODY);

    expect(echo(response.body).parsed).toEqual({ b: 1, a: 'café' });
  });

  it('retains nothing for an ordinary route', async () => {
    const response = await request(app).post('/v1/trades').set('content-type', 'application/json').send(BODY);

    expect(echo(response.body).raw).toBeNull();
  });

  it('still enforces the body limit on a webhook route', async () => {
    const response = await request(app)
      .post('/v1/webhooks/paystack')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(200_000) }));

    expect(response.status).toBe(413);
  });

  it('prefixes only the versioned webhook mount', () => {
    expect(WEBHOOK_PATH_PREFIX).toBe('/v1/webhooks/');
  });

  it('refuses to guess when the raw body was not captured', () => {
    expect(() => rawBody({ rawBody: undefined } as Request)).toThrow(ApiError);
    expect(() => rawBody({ rawBody: undefined } as Request)).toThrow(/raw body/i);
  });

  it('returns the buffer when it was captured', () => {
    const buffer = Buffer.from('{}', 'utf8');
    expect(rawBody({ rawBody: buffer } as Request)).toBe(buffer);
  });
});
