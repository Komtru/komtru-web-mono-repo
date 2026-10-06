// The DECLARATIONS for login and the password routes. The behaviour is password.routes.int.test.ts.
import { describe, expect, it } from 'vitest';
import { passwordRoutes } from '../../../../src/modules/identity/http/routes/password.routes.js';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
} from '../../../../src/modules/identity/http/validations/password.validation.js';
import { assertRouteInvariants, type RouteDefinition } from '../../../../src/platform/http/route.js';
import { stubAccountDeps } from '../support.js';

const routes = passwordRoutes(stubAccountDeps());
const byPath = Object.fromEntries(routes.map((route) => [route.path, route])) as Record<
  string,
  RouteDefinition
>;

describe('login and the password routes (M1 §10.1)', () => {
  it('serves every path M1 §10.1 names for this ticket', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'POST /auth/login',
      'POST /auth/password/forgot',
      'POST /auth/password/reset',
      'POST /auth/password/change',
    ]);
  });

  it('passes assertRouteInvariants', () => {
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();
  });

  it('keeps the three recovery routes PUBLIC and the change route behind a session', () => {
    expect(byPath['/auth/login']?.scope).toBe('PUBLIC');
    expect(byPath['/auth/password/forgot']?.scope).toBe('PUBLIC');
    expect(byPath['/auth/password/reset']?.scope).toBe('PUBLIC');
    expect(byPath['/auth/password/change']?.scope).toBe('CONSUMER');
  });

  it('limits login to five a minute per identifier (S4)', () => {
    expect(byPath['/auth/login']?.rateLimit).toMatchObject({ points: 5, durationSeconds: 60 });
    expect(byPath['/auth/login']?.rateLimit?.by).toEqual(['identifier', 'ip', 'device']);
  });

  it('limits password reset to three an hour per identifier (S4)', () => {
    expect(byPath['/auth/password/forgot']?.rateLimit).toMatchObject({
      points: 3,
      durationSeconds: 3600,
    });
  });

  it('answers forgot-password with 202, as M1 §10.1 specifies', () => {
    expect(byPath['/auth/password/forgot']?.status).toBe(202);
  });

  it('declares every route non-retryable: each response carries or spends a live secret', () => {
    for (const route of routes) expect(route.retryable).toBe(false);
  });

  it('gives one budget to every spelling of one identifier', () => {
    const subject = (identifier: string) =>
      byPath['/auth/login']?.rateLimit?.identifierFrom?.({ body: { identifier }, query: {}, params: {} });

    expect(subject('JANE@Gmail.com')).toBe(subject('j.ane+promo@googlemail.com'));
    expect(subject('0802 341 5567')).toBe(subject('+2348023415567'));
    expect(subject('@JaneDoe')).toBe(subject('janedoe'));
    expect(subject('jane@example.com')).not.toBe(subject('john@example.com'));
  });

  it('never puts the identifier itself in the budget key (S12)', () => {
    const subject = byPath['/auth/login']?.rateLimit?.identifierFrom?.({
      body: { identifier: 'jane@example.com' },
      query: {},
      params: {},
    });
    expect(subject).toMatch(/^[0-9a-f]{64}$/);
    expect(subject).not.toContain('jane');
  });

  it('keys a reset on the challenge id half of the token, never on the secret', () => {
    const spec = byPath['/auth/password/reset']?.rateLimit;
    const challengeId = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';
    const subject = spec?.identifierFrom?.({
      body: { resetToken: `${challengeId}.a-very-secret-value` },
      query: {},
      params: {},
    });
    expect(subject).toBe(challengeId);
    expect(subject).not.toContain('a-very-secret-value');
    expect(
      spec?.identifierFrom?.({ body: { resetToken: 'rubbish' }, query: {}, params: {} }),
    ).toBeUndefined();
  });
});

describe('the login and password request shapes', () => {
  it('accepts an email, a phone or a handle in one identifier field (M1 §10.1)', () => {
    for (const identifier of ['jane@example.com', '+2348023415567', 'janedoe', '@janedoe']) {
      expect(loginRequestSchema.safeParse({ identifier, password: 'x'.repeat(12) }).success).toBe(true);
    }
  });

  it('refuses a body asking for a scope, rather than ignoring the field', () => {
    expect(
      loginRequestSchema.safeParse({ identifier: 'janedoe', password: 'x'.repeat(12), scope: 'STAFF' })
        .success,
    ).toBe(false);
  });

  it('leaves currentPassword optional, because M1 §9.3 sets a first password with no older one', () => {
    expect(changePasswordRequestSchema.safeParse({ newPassword: 'x'.repeat(12) }).success).toBe(true);
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: 'y'.repeat(12),
        newPassword: 'x'.repeat(12),
      }).success,
    ).toBe(true);
  });
});
