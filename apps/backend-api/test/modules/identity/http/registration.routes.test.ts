// The route DECLARATIONS: what `assertRouteInvariants` sees at boot, with no database and no Redis.
// The behaviour behind them is registration.routes.int.test.ts.
import { describe, expect, it } from 'vitest';
import { registrationRoutes } from '../../../../src/modules/identity/http/routes/registration.routes.js';
import {
  registerRequestSchema,
  verifyOtpRequestSchema,
} from '../../../../src/modules/identity/http/validations/registration.validation.js';
import { assertRouteInvariants, type RouteDefinition } from '../../../../src/platform/http/route.js';
import { stubAccountDeps } from '../support.js';

const routes = registrationRoutes(stubAccountDeps());
const byPath = Object.fromEntries(routes.map((route) => [route.path, route])) as Record<
  string,
  RouteDefinition
>;

describe('the registration routes (M1 §10.1)', () => {
  it('serves every path this ticket owns', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'POST /auth/register',
      'POST /auth/otp/resend',
      'POST /auth/verify-otp',
      'GET /me/terms',
      'POST /me/terms/accept',
    ]);
  });

  it('passes assertRouteInvariants', () => {
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();
  });

  it('opens registration, resend and verify to anyone and keeps the terms routes signed in', () => {
    expect(byPath['/auth/register']?.scope).toBe('PUBLIC');
    expect(byPath['/auth/otp/resend']?.scope).toBe('PUBLIC');
    expect(byPath['/auth/verify-otp']?.scope).toBe('PUBLIC');
    expect(byPath['/me/terms']?.scope).toBe('CONSUMER');
    expect(byPath['/me/terms/accept']?.scope).toBe('CONSUMER');
  });

  it('declares every mutating route non-retryable, because each response carries a live secret', () => {
    for (const path of ['/auth/register', '/auth/otp/resend', '/auth/verify-otp', '/me/terms/accept']) {
      expect(byPath[path]?.retryable).toBe(false);
    }
  });

  it('limits by IP, by identifier and by device, which M1 §17 asks to trigger independently', () => {
    for (const path of ['/auth/register', '/auth/otp/resend', '/auth/verify-otp']) {
      expect(byPath[path]?.rateLimit?.by).toEqual(['ip', 'identifier', 'device']);
    }
  });

  it('keys /auth/register on a digest of the NORMALISED identifier, never on the address', () => {
    const spec = byPath['/auth/register']?.rateLimit;
    const subject = (body: unknown) => spec?.identifierFrom?.({ body, query: {}, params: {} });

    const digest = subject({ channel: 'EMAIL', email: 'jane@example.com' });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('jane');

    // Two spellings of one mailbox share a budget, or the limit limits nothing.
    expect(subject({ channel: 'EMAIL', email: 'J.ane+promo@GoogleMail.com' })).toBe(
      subject({ channel: 'EMAIL', email: 'jane@gmail.com' }),
    );
    expect(subject({ channel: 'PHONE', phone: '0802 341 5567' })).toBe(
      subject({ channel: 'PHONE', phone: '+2348023415567' }),
    );
  });

  it('spends no budget key on a body it cannot read an identifier out of', () => {
    const spec = byPath['/auth/register']?.rateLimit;
    expect(spec?.identifierFrom?.({ body: {}, query: {}, params: {} })).toBeUndefined();
    expect(
      spec?.identifierFrom?.({ body: { channel: 'EMAIL', email: 'nonsense' }, query: {}, params: {} }),
    ).toBeUndefined();
  });

  it('bounds the register 409 with a per-IP budget of its own, not the route default', () => {
    // A duplicate contact is answerable (409) so a client can send the user to sign in, which makes
    // the route an enumeration surface. The per-identifier key never repeats for an attacker
    // walking a list of addresses, so the per-IP budget is the only one that binds — and it has to
    // be tight enough to matter.
    const spec = byPath['/auth/register']?.rateLimit;
    expect(spec?.perKey?.ip).toBeDefined();
    expect(spec?.perKey?.ip?.points).toBeLessThanOrEqual(10);
  });

  it('reads the device key off the fingerprint the body carries', () => {
    const spec = byPath['/auth/verify-otp']?.rateLimit;
    expect(spec?.deviceFrom?.({ body: { deviceFingerprint: 'fp-1' }, query: {}, params: {} })).toBe('fp-1');
    expect(spec?.deviceFrom?.({ body: {}, query: {}, params: {} })).toBeUndefined();
  });
});

describe('the registration request shapes', () => {
  const base = { acceptedTermsVersion: '2026-08-01' };

  it('requires a password on the EMAIL path and allows none on the PHONE path (M1 §9.3)', () => {
    expect(
      registerRequestSchema.safeParse({ ...base, channel: 'EMAIL', email: 'jane@example.com' }).success,
    ).toBe(false);
    expect(registerRequestSchema.safeParse({ ...base, channel: 'PHONE', phone: '08023415567' }).success).toBe(
      true,
    );
  });

  it('refuses a body naming one channel and carrying the other', () => {
    expect(
      registerRequestSchema.safeParse({
        ...base,
        channel: 'PHONE',
        phone: '08023415567',
        email: 'jane@example.com',
      }).success,
    ).toBe(false);
  });

  it('refuses a field the server would ignore, rather than dropping it silently', () => {
    expect(
      registerRequestSchema.safeParse({
        ...base,
        channel: 'PHONE',
        phone: '08023415567',
        status: 'ACTIVE',
      }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        ...base,
        channel: 'PHONE',
        phone: '08023415567',
        scope: 'STAFF',
      }).success,
    ).toBe(false);
  });

  it('defaults the marketing opt-in to off, as NDPA §15 requires of a separate consent', () => {
    const parsed = registerRequestSchema.parse({ ...base, channel: 'PHONE', phone: '08023415567' });
    expect(parsed.marketingOptIn).toBe(false);
  });

  it('accepts only a six-digit code', () => {
    const challengeId = '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';
    expect(verifyOtpRequestSchema.safeParse({ challengeId, code: '482913' }).success).toBe(true);
    expect(verifyOtpRequestSchema.safeParse({ challengeId, code: '48291' }).success).toBe(false);
    expect(verifyOtpRequestSchema.safeParse({ challengeId, code: '48291a' }).success).toBe(false);
    expect(verifyOtpRequestSchema.safeParse({ challengeId, code: ' 482913 ' }).success).toBe(false);
  });
});
