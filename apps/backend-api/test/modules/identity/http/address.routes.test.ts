// T-042's `/me/addresses` lines, as declarations.
import { describe, expect, it } from 'vitest';
import type { Db } from '../../../../src/db/index.js';
import { addressRoutes } from '../../../../src/modules/identity/http/routes/address.routes.js';
import { assertRouteInvariants, type HttpMethod } from '../../../../src/platform/http/route.js';

const routes = addressRoutes({ db: null as unknown as Db });
const find = (method: HttpMethod, path: string) => {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
};

describe('address routes', () => {
  it('declares the five endpoints', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'GET /me/addresses',
      'POST /me/addresses',
      'PATCH /me/addresses/:id',
      'POST /me/addresses/:id/archive',
      'POST /me/addresses/:id/default',
    ]);
  });

  it('passes the platform route invariants', () => {
    expect(() => assertRouteInvariants(routes)).not.toThrow();
  });

  it('needs a consumer session everywhere', () => {
    for (const route of routes) expect(route.scope).toBe('CONSUMER');
  });

  it('cursor-paginates the list', () => {
    expect(find('get', '/me/addresses').paginated).toBe('cursor');
  });

  it('keys only the create on an idempotency key, and answers it 201', () => {
    expect(find('post', '/me/addresses')).toMatchObject({ retryable: true, status: 201 });
    for (const route of routes.filter((r) => r.method !== 'get' && r.path !== '/me/addresses')) {
      expect(route.retryable).toBe(false);
    }
  });

  it('rate limits every write', () => {
    for (const route of routes.filter((r) => r.method !== 'get')) expect(route.rateLimit).toBeDefined();
  });

  it('has no DELETE: an address is archived, never deleted', () => {
    expect(routes.some((r) => r.method === 'delete')).toBe(false);
  });
});
