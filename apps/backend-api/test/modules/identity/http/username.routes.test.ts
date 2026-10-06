// The route declarations are where M1 §10.3's acceptance criteria live — the 20-per-minute limit on
// availability is a property of the registration, not of a handler.
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { usernameRoutes } from '../../../../src/modules/identity/http/username.controller.js';
import type { UsernameServiceDeps } from '../../../../src/modules/identity/services/username.service.js';
import { ApiError } from '../../../../src/platform/errors.js';
import { assertRouteInvariants, type HttpMethod } from '../../../../src/platform/http/route.js';
import { ANONYMOUS_ACTOR, type Actor } from '../../../../src/platform/http/principal.js';

const deps = { db: {} as UsernameServiceDeps['db'] };
const routes = usernameRoutes(deps);

const find = (method: HttpMethod, path: string) => {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
};

const ctx = (actor: Actor) => ({
  params: {},
  query: {},
  body: {},
  actor,
  req: {} as Request,
  res: {} as Response,
});

describe('username routes', () => {
  it('declares the four §10.3 endpoints', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'GET /usernames/availability',
      'POST /me/username',
      'PATCH /me/username',
      'GET /me/username/history',
    ]);
  });

  it('rate-limits availability at 20 per minute', () => {
    expect(find('get', '/usernames/availability').rateLimit).toEqual({
      points: 20,
      durationSeconds: 60,
      by: ['ip', 'user'],
    });
  });

  it('passes the platform route invariants', () => {
    expect(() => assertRouteInvariants(routes)).not.toThrow();
  });

  it('scopes the /me routes to a consumer session and availability to PUBLIC', () => {
    expect(find('get', '/usernames/availability').scope).toBe('PUBLIC');
    for (const [method, path] of [
      ['post', '/me/username'],
      ['patch', '/me/username'],
      ['get', '/me/username/history'],
    ] as const)
      expect(find(method, path).scope).toBe('CONSUMER');
  });

  it('declares every mutating route retryable, so a repeated claim is idempotent', () => {
    expect(find('post', '/me/username').retryable).toBe(true);
    expect(find('patch', '/me/username').retryable).toBe(true);
  });

  it('paginates the history', () => {
    expect(find('get', '/me/username/history').paginated).toBe('page');
  });

  it.each([
    ['post', '/me/username'],
    ['patch', '/me/username'],
    ['get', '/me/username/history'],
  ] as const)('refuses %s %s with no principal', async (method, path) => {
    await expect(find(method, path).handler(ctx(ANONYMOUS_ACTOR))).rejects.toMatchObject({ status: 401 });
  });

  it('does not require a principal to check availability', () => {
    expect(find('get', '/usernames/availability').scope).toBe('PUBLIC');
  });

  it('validates the query before the service sees it', () => {
    const query = find('get', '/usernames/availability').schema.query;
    expect(query?.safeParse({}).success).toBe(false);
    expect(query?.safeParse({ username: 'janedoe' }).success).toBe(true);
    expect(query?.safeParse({ username: 'a'.repeat(64) }).success).toBe(false);
  });

  it('requires a reason to change a handle', () => {
    const body = find('patch', '/me/username').schema.body;
    expect(body?.safeParse({ username: 'janedoe' }).success).toBe(false);
    expect(body?.safeParse({ username: 'janedoe', reason: 'rebrand' }).success).toBe(true);
  });

  it('answers 401 as an ApiError, not as a thrown string', async () => {
    await expect(find('post', '/me/username').handler(ctx(ANONYMOUS_ACTOR))).rejects.toBeInstanceOf(ApiError);
  });
});
