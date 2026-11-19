// The route table's own invariants, checked without a database or a server. `mountRoutes` runs
// `assertRouteInvariants` at boot, so a mistake here is a process that will not start — this test
// is where that gets found instead.
//
// The RBAC assertion is the one worth reading twice. `dispute.submit_evidence` and
// `dispute.appeal` are in the catalogue but granted to no staff role, deliberately: they belong
// to the two parties on their own case. A CONSUMER route that named one would 403 every real
// user, so the test pins that none does.
import { describe, expect, it } from 'vitest';
import { disputeRoutes } from '../../../src/modules/disputes/http/routes.js';
import { assertRouteInvariants } from '../../../src/platform/http/route.js';
import type { DisputePorts } from '../../../src/modules/disputes/services/ports.js';

const routes = disputeRoutes({
  db: () => {
    throw new Error('the route table must be buildable without a database');
  },
  ports: () => ({}) as DisputePorts,
});

const route = (method: string, path: string) =>
  routes.find((candidate) => candidate.method === method && candidate.path === path);

describe('the route table', () => {
  it('satisfies every invariant the platform checks at boot', () => {
    expect(() => assertRouteInvariants(routes)).not.toThrow();
  });

  it('declares every route the feature needs', () => {
    const declared = routes.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(declared).toEqual(
      [
        'POST /trades/:id/dispute',
        'GET /trades/:id/dispute',
        'GET /disputes',
        'GET /disputes/:id',
        'GET /disputes/:id/timeline',
        'GET /disputes/:id/evidence',
        'GET /disputes/:id/evidence-comparison',
        'POST /disputes/:id/evidence',
        'POST /disputes/:id/mediation/proposals',
        'POST /disputes/:id/mediation/proposals/:proposalId/respond',
        'POST /disputes/:id/withdraw',
        'POST /disputes/:id/appeal',
        'POST /internal/disputes',
        'GET /admin/disputes/queue',
        'POST /admin/disputes/:id/assign',
        'POST /admin/disputes/:id/decide',
        'POST /admin/disputes/:id/appeal-decide',
        'POST /admin/disputes/:id/reopen-evidence',
      ].sort(),
    );
  });

  it('paginates every list', () => {
    for (const path of [
      '/disputes',
      '/disputes/:id/timeline',
      '/disputes/:id/evidence',
      '/admin/disputes/queue',
    ]) {
      expect(route('get', path)?.paginated).toBe('cursor');
    }
  });

  it('decides retryability explicitly on every mutating route', () => {
    for (const r of routes.filter((candidate) => candidate.method !== 'get')) {
      expect(typeof r.retryable, `${r.method} ${r.path}`).toBe('boolean');
    }
  });

  it('gives an idempotency key to everything that moves money or opens a case', () => {
    for (const path of [
      '/trades/:id/dispute',
      '/disputes/:id/mediation/proposals/:proposalId/respond',
      '/disputes/:id/withdraw',
      '/disputes/:id/appeal',
      '/admin/disputes/:id/decide',
      '/admin/disputes/:id/appeal-decide',
    ]) {
      expect(route('post', path)?.retryable, path).toBe(true);
    }
  });

  it('rate limits every route, by user and by ip', () => {
    for (const r of routes) {
      expect(r.rateLimit?.by, `${r.method} ${r.path}`).toEqual(['user', 'ip']);
      expect(r.rateLimit?.points).toBeGreaterThan(0);
    }
  });

  it('never names a party permission on a consumer route', () => {
    const party = ['dispute.submit_evidence', 'dispute.appeal'];
    for (const r of routes.filter((candidate) => candidate.scope === 'CONSUMER')) {
      expect(r.permission, `${r.method} ${r.path}`).toBeUndefined();
      expect(party).not.toContain(r.permission);
    }
  });

  it('names a staff permission on every staff route', () => {
    const staff = routes.filter((r) => r.scope === 'STAFF');
    expect(staff.length).toBeGreaterThan(0);
    for (const r of staff) {
      expect(r.permission, `${r.method} ${r.path}`).toBeDefined();
    }
  });

  it('puts the decision behind dispute.decide and the appeal behind dispute.decide_appeal', () => {
    expect(route('post', '/admin/disputes/:id/decide')?.permission).toBe('dispute.decide');
    expect(route('post', '/admin/disputes/:id/appeal-decide')?.permission).toBe('dispute.decide_appeal');
    expect(route('post', '/admin/disputes/:id/assign')?.permission).toBe('dispute.assign');
    expect(route('get', '/admin/disputes/queue')?.permission).toBe('dispute.view');
  });

  it('tightens the budget on attempt-shaped routes', () => {
    const action = route('post', '/disputes/:id/appeal')?.rateLimit?.points ?? 0;
    const list = route('get', '/disputes')?.rateLimit?.points ?? 0;
    expect(action).toBeLessThan(list);
  });
});
