import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_MATRIX } from '../../../src/modules/identity/index.js';
import { geoAdminRoutes } from '../../../src/modules/geo/http/admin.routes.js';
import { geoPublicRoutes } from '../../../src/modules/geo/http/public.routes.js';
import { optionalReason, requireReason } from '../../../src/modules/geo/http/context.js';
import { geoModule } from '../../../src/modules/geo/index.js';
import { moduleSeeds } from '../../../src/modules/index.js';
import { ApiError } from '../../../src/platform/errors.js';
import { assertRouteInvariants, routeLabel } from '../../../src/platform/http/route.js';
import { testModules } from '../../support/modules.js';

const notStarted = () => {
  throw new Error('not started');
};
const deps = { db: notStarted, cache: notStarted };
const publicRoutes = geoPublicRoutes(deps);
const adminRoutes = geoAdminRoutes(deps);

describe('the geo route table', () => {
  it('declares the dropdown APIs and the city request', () => {
    expect(publicRoutes.map(routeLabel).sort()).toEqual([
      'GET /geo/cities',
      'GET /geo/cities/:cityId',
      'GET /geo/states',
      'GET /geo/states/:stateId/cities',
      'POST /geo/city-requests',
    ]);
  });

  it('serves the dropdown reads without a session, cursor-paginated, with a per-IP budget', () => {
    const lists = publicRoutes.filter((r) => r.method === 'get' && r.paginated);
    expect(lists.map(routeLabel).sort()).toEqual([
      'GET /geo/cities',
      'GET /geo/states',
      'GET /geo/states/:stateId/cities',
    ]);
    for (const route of publicRoutes.filter((r) => r.method === 'get')) {
      expect(route.scope, routeLabel(route)).toBe('PUBLIC');
      expect(route.rateLimit?.by, routeLabel(route)).toEqual(['ip']);
    }
    for (const route of lists) expect(route.paginated, routeLabel(route)).toBe('cursor');
  });

  it('lets only a signed-in consumer ask for a city, behind an idempotency key and a budget', () => {
    const submit = publicRoutes.find((r) => r.method === 'post');
    expect(submit?.scope).toBe('CONSUMER');
    expect(submit?.retryable).toBe(true);
    expect(submit?.status).toBe(201);
    expect(submit?.rateLimit?.by).toContain('user');
  });

  it('declares the staff routes: cities add, rename, deactivate, activate; requests add, merge, reject', () => {
    expect(adminRoutes.map(routeLabel).sort()).toEqual([
      'GET /admin/geo/city-requests',
      'GET /admin/geo/states',
      'GET /admin/geo/states/:stateId/cities',
      'PATCH /admin/geo/cities/:id',
      'POST /admin/geo/cities',
      'POST /admin/geo/cities/:id/activate',
      'POST /admin/geo/cities/:id/deactivate',
      'POST /admin/geo/city-requests/:id/add',
      'POST /admin/geo/city-requests/:id/merge',
      'POST /admin/geo/city-requests/:id/reject',
    ]);
  });

  it('puts every staff route behind STAFF scope and geo.manage', () => {
    for (const route of adminRoutes) {
      expect(route.scope, routeLabel(route)).toBe('STAFF');
      expect(route.permission, routeLabel(route)).toBe('geo.manage');
    }
  });

  it('has no DELETE route anywhere: a city is deactivated, never deleted', () => {
    for (const route of [...publicRoutes, ...adminRoutes]) expect(route.method).not.toBe('delete');
  });

  it('only uses a permission the RBAC catalogue holds, granted to SUPER_ADMIN and OPERATIONS_ADMIN', () => {
    expect(PERMISSIONS.map((p) => p.code)).toContain('geo.manage');
    const holders = Object.entries(PERMISSION_MATRIX['geo.manage'])
      .filter(([, grant]) => grant !== 'DENY' && (typeof grant !== 'object' || grant.allow))
      .map(([role]) => role)
      .sort();
    expect(holders).toEqual(['OPERATIONS_ADMIN', 'SUPER_ADMIN']);
  });

  it('passes the platform route invariants as the module registers them', () => {
    expect(() => {
      assertRouteInvariants(geoModule.routes ?? []);
    }).not.toThrow();
  });
});

describe('the geo module', () => {
  it('seeds through the module, so db:migrate and db:seed both reach it', () => {
    expect(geoModule.seed).toBeTypeOf('function');
    expect(moduleSeeds.map((m) => m.name)).toContain('geo');
  });

  it('is in the module registry after identity, whose audit log it writes', () => {
    const names = testModules().map((m) => m.name);
    expect(names).toContain('geo');
    expect(names.indexOf('geo')).toBeGreaterThan(names.indexOf('identity'));
  });
});

describe('reasons', () => {
  const req = (header?: string) =>
    ({ get: (name: string) => (name === 'x-admin-reason' ? header : undefined) }) as unknown as Request;

  it('requires one, from the body or the header, and answers 400 without', () => {
    expect(requireReason(req(), '  duplicate of Jos  ')).toBe('duplicate of Jos');
    expect(requireReason(req('from header'), undefined)).toBe('from header');
    for (const missing of [undefined, '', '   ']) {
      try {
        requireReason(req(), missing);
        expect.unreachable();
      } catch (error) {
        expect((error as ApiError).status).toBe(400);
      }
    }
  });

  it('refuses a reason over 1000 characters', () => {
    expect(() => requireReason(req(), 'x'.repeat(1001))).toThrow(ApiError);
  });

  it('lets a decision go without one', () => {
    expect(optionalReason(req(), undefined)).toBeUndefined();
    expect(optionalReason(req(), '  ')).toBeUndefined();
    expect(optionalReason(req(), 'spelling fixed')).toBe('spelling fixed');
  });
});
