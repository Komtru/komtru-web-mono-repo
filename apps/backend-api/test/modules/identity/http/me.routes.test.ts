// T-041's `/me/avatar` lines, as declarations.
import { describe, expect, it } from 'vitest';
import type { AvatarDeps } from '../../../../src/modules/identity/services/avatar.service.js';
import { meRoutes } from '../../../../src/modules/identity/http/routes/me.routes.js';
import { assertRouteInvariants } from '../../../../src/platform/http/route.js';

const routes = meRoutes(null as unknown as AvatarDeps);

describe('me routes', () => {
  it('declares POST and DELETE /me/avatar', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'POST /me/avatar',
      'DELETE /me/avatar',
    ]);
  });

  it('passes the platform route invariants', () => {
    expect(() => assertRouteInvariants(routes)).not.toThrow();
  });

  it('needs a consumer session, rate limits both writes and keys neither', () => {
    for (const route of routes) {
      expect(route.scope).toBe('CONSUMER');
      expect(route.rateLimit).toBeDefined();
      expect(route.retryable).toBe(false);
    }
  });
});
