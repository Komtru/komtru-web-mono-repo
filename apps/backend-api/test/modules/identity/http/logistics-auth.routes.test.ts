// T-086's route declarations: a separate logistics door, public, rate-limited like the others, and
// counted into the shared password bucket so a third route is not a third budget for one account.
import { describe, expect, it } from 'vitest';
import type { PasswordControllerDeps } from '../../../../src/modules/identity/http/controllers/password.controller.js';
import { logisticsAuthRoutes } from '../../../../src/modules/identity/http/routes/logistics-auth.routes.js';
import { passwordRoutes } from '../../../../src/modules/identity/http/routes/password.routes.js';
import { assertRouteInvariants, routeLabel } from '../../../../src/platform/http/route.js';

const routes = logisticsAuthRoutes(null as unknown as PasswordControllerDeps);
const route = (label: string) => routes.find((candidate) => routeLabel(candidate) === label);

describe('logistics sign-in routes (T-086)', () => {
  it('declares the password step and the second-factor step', () => {
    expect(routes.map(routeLabel).sort()).toEqual([
      'POST /auth/logistics/login',
      'POST /auth/logistics/mfa/verify',
    ]);
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();
  });

  it('is public, never retryable, and rate-limited per identifier, IP and device', () => {
    for (const candidate of routes) {
      expect(candidate.scope).toBe('PUBLIC');
      expect(candidate.retryable).toBe(false);
      expect([...(candidate.rateLimit?.by ?? [])].sort()).toEqual(['device', 'identifier', 'ip']);
    }
  });

  it('shares the consumer login’s identifier bucket', () => {
    const consumer = passwordRoutes(null as unknown as PasswordControllerDeps).find(
      (candidate) => routeLabel(candidate) === 'POST /auth/login',
    );
    expect(route('POST /auth/logistics/login')?.rateLimit?.identifierBucket).toBe(
      consumer?.rateLimit?.identifierBucket,
    );
  });
});
