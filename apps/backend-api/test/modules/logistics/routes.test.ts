// T-086's route table and the portal's authorization, without a database: every check here runs before
// a handler could reach for one. The scope of every route is the platform's to enforce (mount.ts); the
// company and the ADMIN-vs-OPERATOR rule are this module's, in its controllers.
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../../src/db/index.js';
import * as http from '../../../src/modules/logistics/http/controllers.js';
import { logisticsRoutes } from '../../../src/modules/logistics/http/routes.js';
import {
  inviteBody,
  invitationsQuery,
  membersQuery,
  updateMemberBody,
} from '../../../src/modules/logistics/http/validations.js';
import type { LogisticsCrypto } from '../../../src/modules/logistics/services/member.service.js';
import { assertRouteInvariants, routeLabel } from '../../../src/platform/http/route.js';
import { ANONYMOUS_ACTOR, testActor } from '../../support/actors.js';
import { testModule, testModules } from '../../support/modules.js';

/** A database that fails the test if anything reaches it. */
const untouchable = new Proxy(
  {},
  {
    get: () => {
      throw new Error('the database was reached before authorization refused the call');
    },
  },
) as Db;
const deps: http.LogisticsHttpDeps = { db: () => untouchable, crypto: () => ({}) as LogisticsCrypto };
const routes = logisticsRoutes(deps);
const req = { ip: '127.0.0.1', get: () => undefined } as unknown as Request;
const route = (label: string) => routes.find((candidate) => routeLabel(candidate) === label);

const ADMIN_ROUTES = [
  'GET /admin/logistics/companies',
  'GET /admin/logistics/companies/:id/members',
  'PATCH /admin/logistics/companies/:id',
  'POST /admin/logistics/companies',
];
const PORTAL_ROUTES = [
  'DELETE /logistics/invitations/:id',
  'GET /logistics/invitations',
  'GET /logistics/me',
  'GET /logistics/members',
  'PATCH /logistics/members/:id',
  'POST /logistics/members',
];

const logisticsActor = (role: string | null, companyId = randomUUID()) =>
  testActor(randomUUID(), {
    scope: 'LOGISTICS',
    companyMembership: role === null ? null : { companyId, role },
  });

describe('logistics routes (T-086, m2 §5)', () => {
  it('declares exactly the admin and portal routes, and passes the registry invariants', () => {
    expect(routes.map(routeLabel).sort()).toEqual([...ADMIN_ROUTES, ...PORTAL_ROUTES].sort());
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();
  });

  it('puts every admin route behind STAFF and logistics.manage', () => {
    for (const label of ADMIN_ROUTES) {
      expect(route(label)?.scope, label).toBe('STAFF');
      expect(route(label)?.permission, label).toBe('logistics.manage');
    }
  });

  it('puts every portal route behind LOGISTICS, and none of them is public', () => {
    for (const label of PORTAL_ROUTES) expect(route(label)?.scope, label).toBe('LOGISTICS');
    expect(routes.some((candidate) => candidate.scope === 'PUBLIC')).toBe(false);
  });

  it('accepts no companyId from a portal request: strict bodies refuse it, queries never read it', () => {
    const companyId = randomUUID();
    expect(inviteBody.safeParse({ email: 'a@example.com', role: 'OPERATOR', companyId }).success).toBe(false);
    expect(updateMemberBody.safeParse({ role: 'ADMIN', companyId }).success).toBe(false);
    expect(membersQuery.parse({ companyId })).not.toHaveProperty('companyId');
    expect(invitationsQuery.parse({ companyId })).not.toHaveProperty('companyId');
    for (const label of PORTAL_ROUTES) {
      const params = route(label)?.schema.params;
      if (params) expect(params.safeParse({ id: randomUUID(), companyId }).success, label).toBe(false);
    }
  });

  it('takes exactly one of an email and a phone to invite', () => {
    expect(inviteBody.safeParse({ email: 'a@example.com', role: 'OPERATOR' }).success).toBe(true);
    expect(inviteBody.safeParse({ phone: '08031234567', role: 'ADMIN' }).success).toBe(true);
    expect(inviteBody.safeParse({ role: 'ADMIN' }).success).toBe(false);
    expect(
      inviteBody.safeParse({ email: 'a@example.com', phone: '08031234567', role: 'ADMIN' }).success,
    ).toBe(false);
  });

  it('takes one change at a time: a role, or removal', () => {
    expect(updateMemberBody.safeParse({ role: 'OPERATOR' }).success).toBe(true);
    expect(updateMemberBody.safeParse({ status: 'REMOVED' }).success).toBe(true);
    expect(updateMemberBody.safeParse({ status: 'ACTIVE' }).success).toBe(false);
    expect(updateMemberBody.safeParse({ role: 'OPERATOR', status: 'REMOVED' }).success).toBe(false);
  });
});

describe('the portal derives the company from the principal (m2 §5b)', () => {
  it('reads company and role off the re-resolved membership', () => {
    const companyId = randomUUID();
    const member = http.portalMember(logisticsActor('OPERATOR', companyId));
    expect(member).toMatchObject({ companyId, role: 'OPERATOR' });
  });

  it('answers 403 NO_LOGISTICS_ACCESS for a LOGISTICS session whose membership is gone', () => {
    expect(() => http.portalMember(logisticsActor(null))).toThrow(
      expect.objectContaining({ status: 403, code: 'NO_LOGISTICS_ACCESS' }),
    );
    expect(() => http.portalMember(logisticsActor('SOMETHING_ELSE'))).toThrow(
      expect.objectContaining({ code: 'NO_LOGISTICS_ACCESS' }),
    );
  });

  it('answers 401 for no caller at all', () => {
    expect(() => http.portalMember(ANONYMOUS_ACTOR)).toThrow(expect.objectContaining({ status: 401 }));
  });

  it('refuses an OPERATOR every roster change before touching the database', () => {
    const operator = logisticsActor('OPERATOR');
    const refused: unknown = expect.objectContaining({ status: 403, code: 'FORBIDDEN' });
    expect(() =>
      http.portalInviteHandler(deps, operator, req, { email: 'a@example.com', role: 'OPERATOR' }),
    ).toThrow(refused);
    expect(() =>
      http.portalUpdateMemberHandler(deps, operator, req, randomUUID(), { status: 'REMOVED' }),
    ).toThrow(refused);
    expect(() => http.portalCancelInvitationHandler(deps, operator, req, randomUUID())).toThrow(refused);
  });

  it('refuses an invalid contact as a 422 before touching the database', () => {
    expect(() =>
      http.portalInviteHandler(deps, logisticsActor('ADMIN'), req, {
        email: 'not-an-email',
        role: 'OPERATOR',
      }),
    ).toThrow(expect.objectContaining({ status: 422, code: 'VALIDATION_FAILED' }));
  });
});

describe('the logistics module in the registry', () => {
  it('is registered once, after identity and before notify, which tells invitees', () => {
    const names = testModules().map((module) => module.name);
    expect(names.filter((name) => name === 'logistics')).toHaveLength(1);
    expect(names.indexOf('identity')).toBeLessThan(names.indexOf('logistics'));
    expect(names.indexOf('logistics')).toBeLessThan(names.indexOf('notify'));
  });

  it('refuses a request that arrives before start()', async () => {
    const me = testModule('logistics').routes?.find((r) => r.path === '/logistics/me');
    const ctx = { actor: logisticsActor('ADMIN') } as never;
    await expect((async () => me?.handler(ctx))()).rejects.toThrow(/before start\(\)/);
  });
});
