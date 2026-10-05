import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/platform/logger.js';
import { ApiError } from '../src/platform/errors.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://komtru:komtru@localhost:56432/komtru_v2_dev',
  REDIS_URL: 'redis://localhost:56379',
  ALLOWED_ORIGINS: 'http://localhost:3001',
});
const logger = createLogger(config);

const build = (onUnexpected = vi.fn()) => {
  const app = createApp({
    config,
    logger,
    onUnexpected,
    mountV1: (router) => {
      router.post('/echo', (req, res) => {
        res.json({ received: req.body as unknown });
      });
      router.get('/conflict', () => {
        throw new ApiError(409, 'INVALID_TRANSITION', 'This trade cannot move to that state');
      });
      router.get('/boom', () => {
        throw new Error('database password is hunter2');
      });
      router.get('/async-boom', async () => {
        await Promise.resolve();
        throw new Error('async failure detail');
      });
    },
  });
  return { app, onUnexpected };
};

describe('security headers and CORS', () => {
  it('sets helmet headers', async () => {
    const res = await request(build().app).get('/v1/conflict');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows a configured origin and ignores others', async () => {
    const { app } = build();
    const allowed = await request(app).get('/v1/conflict').set('Origin', 'http://localhost:3001');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    const other = await request(app).get('/v1/conflict').set('Origin', 'http://evil.test');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('problem details', () => {
  it('turns invalid JSON into a 400 problem', async () => {
    const res = await request(build().app)
      .post('/v1/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it.each(['/v1/nope', '/nope'])('returns a 404 problem for %s', async (path) => {
    const res = await request(build().app).get(path);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('maps an ApiError to its status and code', async () => {
    const res = await request(build().app).get('/v1/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      type: 'https://docs.komtru.com/problems/invalid-transition',
      code: 'INVALID_TRANSITION',
      title: 'This trade cannot move to that state',
    });
  });

  it.each(['/v1/boom', '/v1/async-boom'])('hides unexpected errors behind a 500 (%s)', async (path) => {
    const { app, onUnexpected } = build();
    const res = await request(app).get(path).set('X-Request-Id', 'req-123');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 'INTERNAL', title: 'Something went wrong', instance: 'req-123' });
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|async failure detail|at .+\.ts/);
    expect(onUnexpected).toHaveBeenCalledOnce();
  });
});

describe('request ids', () => {
  it('echoes a well-formed client request id', async () => {
    const res = await request(build().app).get('/v1/conflict').set('X-Request-Id', 'abc.DEF_123-x');
    expect(res.headers['x-request-id']).toBe('abc.DEF_123-x');
  });

  it.each(['a'.repeat(500), 'bad id with spaces', 'x;rm -rf'])(
    'replaces an unsafe request id',
    async (id) => {
      const res = await request(build().app).get('/v1/conflict').set('X-Request-Id', id);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('generates a request id when none is sent', async () => {
    const res = await request(build().app).get('/v1/conflict');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
