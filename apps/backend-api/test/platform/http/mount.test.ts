import { paginatedSchema } from '@komtru/shared-types';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config/env.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { defineRoute, type RouteDefinition } from '../../../src/platform/http/route.js';
import { createLogger } from '../../../src/platform/logger.js';

const config = loadConfig({
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgresql://x@localhost/x',
  REDIS_URL: 'redis://localhost:56379',
});
const logger = createLogger(config);

const appWith = (routes: RouteDefinition[], onUnexpected = () => {}) =>
  createApp({ config, logger, onUnexpected, mountV1: mountRoutes(routes, { logger }) });

const item = z.object({ id: z.uuid() });
const ID = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';

describe('mountRoutes', () => {
  it('parses params, query and body and hands the handler typed values', async () => {
    const seen = vi.fn();
    const app = appWith([
      defineRoute({
        method: 'post',
        path: '/trades/:id/offers',
        scope: 'CONSUMER',
        summary: 'Offer',
        retryable: false,
        schema: {
          params: z.object({ id: z.uuid() }),
          query: z.object({ dryRun: z.enum(['true', 'false']).default('false') }),
          body: z.object({ amountKobo: z.number().int() }),
          response: item,
        },
        handler: (ctx) => {
          seen(ctx.params, ctx.query, ctx.body);
          return Promise.resolve({ id: ID });
        },
      }),
    ]);

    const response = await request(app)
      .post(`/v1/trades/${ID}/offers`)
      .send({ amountKobo: 1000 })
      .expect(200);

    expect(response.body).toEqual({ id: ID });
    expect(seen).toHaveBeenCalledWith({ id: ID }, { dryRun: 'false' }, { amountKobo: 1000 });
  });

  it('answers 422 with field errors when the body does not match', async () => {
    const app = appWith([
      defineRoute({
        method: 'post',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'Open',
        retryable: false,
        schema: { body: z.object({ amountKobo: z.number().int() }), response: item },
        handler: () => Promise.resolve({ id: ID }),
      }),
    ]);

    const response = await request(app).post('/v1/trades').send({ amountKobo: 'lots' }).expect(422);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'amountKobo' }],
    });
  });

  it('accepts the declared status code', async () => {
    const app = appWith([
      defineRoute({
        method: 'post',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'Open',
        retryable: false,
        status: 201,
        schema: { response: item },
        handler: () => Promise.resolve({ id: ID }),
      }),
    ]);
    await request(app).post('/v1/trades').send({}).expect(201);
  });

  it('adds the pagination query to a cursor-paginated route', async () => {
    const seen = vi.fn();
    const app = appWith([
      defineRoute({
        method: 'get',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'List',
        paginated: 'cursor',
        schema: { response: paginatedSchema(item) },
        handler: (ctx) => {
          seen(ctx.query);
          return Promise.resolve({ items: [], nextCursor: null });
        },
      }),
    ]);

    await request(app).get('/v1/trades?limit=5').expect(200);
    expect(seen).toHaveBeenCalledWith({ limit: 5 });

    await request(app).get('/v1/trades').expect(200);
    expect(seen).toHaveBeenLastCalledWith({ limit: 20 });
  });

  it('rejects a limit above the maximum rather than clamping it silently', async () => {
    const app = appWith([
      defineRoute({
        method: 'get',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'List',
        paginated: 'cursor',
        schema: { response: paginatedSchema(item) },
        handler: () => Promise.resolve({ items: [], nextCursor: null }),
      }),
    ]);
    await request(app).get('/v1/trades?limit=1000').expect(422);
  });

  it("keeps a route's own query schema alongside the pagination one", async () => {
    const seen = vi.fn();
    const app = appWith([
      defineRoute({
        method: 'get',
        path: '/trades',
        scope: 'CONSUMER',
        summary: 'List',
        paginated: 'cursor',
        schema: {
          query: z.object({ status: z.enum(['OPEN', 'CLOSED']).optional() }),
          response: paginatedSchema(item),
        },
        handler: (ctx) => {
          seen(ctx.query);
          return Promise.resolve({ items: [], nextCursor: null });
        },
      }),
    ]);

    await request(app).get('/v1/trades?status=OPEN&limit=3').expect(200);
    expect(seen).toHaveBeenCalledWith({ status: 'OPEN', limit: 3 });
  });

  it("treats a response that breaks its own schema as a server bug, not the caller's problem", async () => {
    const onUnexpected = vi.fn();
    const app = appWith(
      [
        defineRoute({
          method: 'get',
          path: '/trades/:id',
          scope: 'CONSUMER',
          summary: 'One',
          schema: { params: z.object({ id: z.uuid() }), response: item },
          handler: () => Promise.resolve({ id: 'not-a-uuid' }),
        }),
      ],
      onUnexpected,
    );

    const response = await request(app).get(`/v1/trades/${ID}`).expect(500);
    expect(response.body).toMatchObject({ code: 'INTERNAL' });
    expect(onUnexpected).toHaveBeenCalled();
  });

  it('refuses to mount a registry that breaks an invariant', () => {
    expect(() =>
      mountRoutes(
        [
          defineRoute({
            method: 'get',
            path: '/trades',
            scope: 'CONSUMER',
            summary: 'List',
            schema: { response: paginatedSchema(item) },
            handler: () => Promise.resolve({ items: [], nextCursor: null }),
          }),
        ],
        { logger },
      ),
    ).toThrow(/paginated/);
  });

  it('runs the idempotency gate only on routes that declare retryable', async () => {
    const guarded: string[] = [];
    const idempotency = vi.fn((ctx: { route: RouteDefinition }, run: () => Promise<unknown>) => {
      guarded.push(ctx.route.path);
      return run();
    });
    const routes = [
      defineRoute({
        method: 'post',
        path: '/retryable',
        scope: 'CONSUMER',
        summary: 'Retryable',
        retryable: true,
        schema: { response: item },
        handler: () => Promise.resolve({ id: ID }),
      }),
      defineRoute({
        method: 'post',
        path: '/not-retryable',
        scope: 'CONSUMER',
        summary: 'Not retryable',
        retryable: false,
        schema: { response: item },
        handler: () => Promise.resolve({ id: ID }),
      }),
    ];
    const app = createApp({
      config,
      logger,
      mountV1: mountRoutes(routes, { logger, idempotency: idempotency as never }),
    });

    await request(app).post('/v1/retryable').send({}).expect(200);
    await request(app).post('/v1/not-retryable').send({}).expect(200);
    expect(guarded).toEqual(['/retryable']);
  });
});
