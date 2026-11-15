import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertRouteInvariants, type RouteContext } from '../../../src/platform/http/route.js';
import { testActor } from '../../support/actors.js';
import { testModule, testModules } from '../../support/modules.js';

describe('the merchant module in the registry', () => {
  it('is registered once, after the modules it reads and before notify, which subscribes to it', () => {
    const names = testModules().map((module) => module.name);
    expect(names.filter((name) => name === 'merchant')).toHaveLength(1);
    for (const earlier of ['identity', 'files', 'trust', 'geo', 'ledger', 'config', 'cases']) {
      expect(names.indexOf(earlier), earlier).toBeLessThan(names.indexOf('merchant'));
    }
    expect(names.indexOf('merchant')).toBeLessThan(names.indexOf('notify'));
  });

  it('declares its routes and its one queue, and passes the platform’s route invariants', () => {
    const module = testModule('merchant');
    expect(() => {
      assertRouteInvariants(module.routes ?? []);
    }).not.toThrow();
    expect(
      (module.routes ?? []).map((route) => `${route.method.toUpperCase()} ${route.path}`).sort(),
    ).toEqual([
      'GET /admin/merchant/applications',
      'GET /admin/merchant/applications/:id',
      'GET /admin/merchant/applications/count',
      'GET /merchant/applications/me',
      'POST /admin/merchant/applications/:id/approve',
      'POST /admin/merchant/applications/:id/assign',
      'POST /admin/merchant/applications/:id/reject',
      'POST /admin/merchant/applications/:id/request-changes',
      'POST /merchant/applications/:id/resubmit',
      'POST /merchant/applications/:id/submit',
      'PUT /merchant/applications/me',
    ]);
    expect(module.queues?.map((queue) => queue.name)).toEqual(['merchant.collect-evidence']);
  });

  it('refuses a request that arrives before start(), rather than reaching for a connection it has not got', async () => {
    const route = testModule('merchant').routes?.find((r) => r.path === '/merchant/applications/me');
    const ctx = { actor: testActor(randomUUID()) } as unknown as RouteContext;
    await expect((async () => route?.handler(ctx))()).rejects.toThrow(/before start\(\)/);
  });

  it('does not build the listings half of M5: T-056 is deferred out of the MVP', () => {
    const paths = (testModule('merchant').routes ?? []).map((route) => route.path);
    expect(paths.filter((path) => /listing|stock|storefront/.test(path))).toEqual([]);
  });
});
