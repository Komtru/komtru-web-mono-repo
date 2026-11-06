import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_MATRIX } from '../../../src/modules/identity/index.js';
import { configAdminRoutes } from '../../../src/modules/config/http/admin.routes.js';
import { configModule } from '../../../src/modules/config/index.js';
import { assertRouteInvariants, routeLabel } from '../../../src/platform/http/route.js';

const routes = configAdminRoutes({
  db: () => {
    throw new Error('not started');
  },
  accessor: () => {
    throw new Error('not started');
  },
});

describe('M17 admin route table', () => {
  it('declares the section 6 settings, flags and change-log endpoints', () => {
    expect(routes.map(routeLabel).sort()).toEqual([
      'GET /admin/config/change-log',
      'GET /admin/config/flags',
      'GET /admin/config/settings/:namespace',
      'PUT /admin/config/flags/:code',
      'PUT /admin/config/settings/:namespace/:key',
    ]);
  });

  it('is STAFF-scoped everywhere, with config.view to read and config.manage to write', () => {
    for (const route of routes) {
      expect(route.scope, routeLabel(route)).toBe('STAFF');
      expect(route.permission, routeLabel(route)).toBe(
        route.method === 'get' ? 'config.view' : 'config.manage',
      );
    }
  });

  it('only uses permissions the RBAC catalogue holds; reads go to SUPER_ADMIN and OPERATIONS_ADMIN, writes to SUPER_ADMIN alone', () => {
    const codes = new Set<string>(PERMISSIONS.map((permission) => permission.code));
    for (const route of routes) expect(codes.has(route.permission ?? '')).toBe(true);
    const holders = (code: 'config.view' | 'config.manage') =>
      Object.entries(PERMISSION_MATRIX[code])
        .filter(([, grant]) => grant !== 'DENY' && (typeof grant !== 'object' || grant.allow))
        .map(([role]) => role)
        .sort();
    expect(holders('config.view')).toEqual(['OPERATIONS_ADMIN', 'SUPER_ADMIN']);
    expect(holders('config.manage')).toEqual(['SUPER_ADMIN']);
  });

  it('passes the platform route invariants and sits in the config module beside the fee route', () => {
    expect(() => {
      assertRouteInvariants(configModule.routes ?? []);
    }).not.toThrow();
    expect((configModule.routes ?? []).map(routeLabel)).toContain('GET /config/fees');
  });

  it('seeds through the module, so db:migrate and db:seed both reach it', () => {
    expect(configModule.seed).toBeTypeOf('function');
  });
});
