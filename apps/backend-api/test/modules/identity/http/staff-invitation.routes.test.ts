// T-038's route declarations: scopes, permissions and the properties that keep a token out of storage.
import { describe, expect, it } from 'vitest';
import type { Db } from '../../../../src/db/index.js';
import type { StaffInvitationControllerDeps } from '../../../../src/modules/identity/http/controllers/staff-invitation.controller.js';
import { staffInvitationRoutes } from '../../../../src/modules/identity/http/routes/staff-invitation.routes.js';
import {
  acceptBody,
  createStaffInvitationBody,
  listStaffInvitationsResponse,
  startAcceptanceBody,
} from '../../../../src/modules/identity/http/validations/staff-invitation.validation.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import { assertRouteInvariants, routeLabel } from '../../../../src/platform/http/route.js';
import { testLogger } from '../support.js';

const deps: StaffInvitationControllerDeps = {
  db: null as unknown as Db,
  hasher: createHmacHasher('pepper-for-route-declarations'),
  encryption: null as never,
  logger: testLogger,
};

const routes = staffInvitationRoutes(deps);
const route = (label: string) => routes.find((candidate) => routeLabel(candidate) === label);

describe('staff invitation routes (T-038)', () => {
  it('declares exactly the admin and consumer routes', () => {
    expect(routes.map(routeLabel).sort()).toEqual([
      'DELETE /admin/staff-invitations/:invitationId',
      'GET /admin/staff-invitations',
      'POST /admin/staff-invitations',
      'POST /me/staff-invitations/accept',
      'POST /me/staff-invitations/start',
    ]);
  });

  it('passes the registry invariants', () => {
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();
  });

  it('puts every admin route behind STAFF and role.grant, which only SUPER_ADMIN holds', () => {
    for (const label of [
      'POST /admin/staff-invitations',
      'GET /admin/staff-invitations',
      'DELETE /admin/staff-invitations/:invitationId',
    ]) {
      expect(route(label)?.scope).toBe('STAFF');
      expect(route(label)?.permission).toBe('role.grant');
    }
  });

  it('requires a signed-in consumer to accept: nothing about an invitation is public', () => {
    expect(route('POST /me/staff-invitations/start')?.scope).toBe('CONSUMER');
    expect(route('POST /me/staff-invitations/accept')?.scope).toBe('CONSUMER');
    expect(routes.some((r) => r.scope === 'PUBLIC')).toBe(false);
  });

  it('never marks a token-bearing or code-bearing route retryable', () => {
    expect(route('POST /admin/staff-invitations')?.retryable).toBeFalsy();
    expect(route('POST /me/staff-invitations/start')?.retryable).toBeFalsy();
    expect(route('POST /me/staff-invitations/accept')?.retryable).toBeFalsy();
  });

  it('rate-limits the acceptance routes per user and per IP', () => {
    for (const label of ['POST /me/staff-invitations/start', 'POST /me/staff-invitations/accept']) {
      expect([...(route(label)?.rateLimit?.by ?? [])].sort()).toEqual(['ip', 'user']);
    }
  });
});

describe('staff invitation schemas', () => {
  it('takes the address in a body, never a query', () => {
    expect(route('GET /admin/staff-invitations')?.schema.query).toBeDefined();
    const shape = Object.keys(
      (route('GET /admin/staff-invitations')?.schema.query as unknown as { shape: Record<string, unknown> })
        .shape,
    );
    expect(shape).not.toContain('email');
  });

  it('rejects unknown members on the create body', () => {
    const ok = { email: 'jane@example.com', roleCode: 'SUPPORT_AGENT' };
    expect(createStaffInvitationBody.safeParse(ok).success).toBe(true);
    expect(createStaffInvitationBody.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(createStaffInvitationBody.safeParse({ ...ok, email: 'not-an-email' }).success).toBe(false);
  });

  it('wants a six-digit code, a challenge id and a token to accept', () => {
    const ok = { token: 'a'.repeat(43), challengeId: crypto.randomUUID(), code: '123456' };
    expect(acceptBody.safeParse(ok).success).toBe(true);
    expect(acceptBody.safeParse({ ...ok, code: '12345' }).success).toBe(false);
    expect(acceptBody.safeParse({ ...ok, code: 'abcdef' }).success).toBe(false);
    expect(startAcceptanceBody.safeParse({ token: 'short' }).success).toBe(false);
  });

  it('lists nothing that could reveal a token or an address', () => {
    const shape = Object.keys(
      (listStaffInvitationsResponse.shape.items.element as unknown as { shape: Record<string, unknown> })
        .shape,
    );
    for (const forbidden of ['token', 'tokenHash', 'destinationHash', 'destinationEnc', 'email']) {
      expect(shape).not.toContain(forbidden);
    }
  });
});
