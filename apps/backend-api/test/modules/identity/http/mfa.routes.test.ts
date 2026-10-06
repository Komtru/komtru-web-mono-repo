// The DECLARATIONS for the MFA routes. The behaviour is mfa.routes.int.test.ts.
import { describe, expect, it } from 'vitest';
import { mfaRoutes } from '../../../../src/modules/identity/http/routes/mfa.routes.js';
import { deviceRoutes } from '../../../../src/modules/identity/http/routes/device.routes.js';
import { passwordRoutes } from '../../../../src/modules/identity/http/routes/password.routes.js';
import { registrationRoutes } from '../../../../src/modules/identity/http/routes/registration.routes.js';
import { assertRouteInvariants, type HttpMethod } from '../../../../src/platform/http/route.js';
import { stubAccountDeps, testLogger } from '../support.js';

const stub = stubAccountDeps();
const routes = mfaRoutes(stub);

const find = (method: HttpMethod, path: string) => {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
};

describe('the MFA routes (M1 §10.1, §10.5)', () => {
  it('declares every endpoint this ticket owns', () => {
    expect(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'POST /auth/mfa/challenge',
      'POST /auth/mfa/verify',
      'GET /me/mfa/factors',
      'POST /me/mfa/totp/enroll',
      'POST /me/mfa/totp/activate',
      'POST /me/mfa/sms/enroll',
      'POST /me/mfa/sms/activate',
      'POST /me/mfa/passkey/register/options',
      'POST /me/mfa/passkey/register/verify',
      'DELETE /me/mfa/factors/:id',
      'POST /me/mfa/recovery-codes',
      'POST /me/step-up/challenge',
      'POST /me/step-up',
    ]);
  });

  it('passes the platform route invariants, alone and beside every other identity route', () => {
    expect(() => {
      assertRouteInvariants(routes);
    }).not.toThrow();

    expect(() => {
      assertRouteInvariants([
        ...routes,
        ...deviceRoutes({ db: stub.db, logger: testLogger }),
        ...passwordRoutes(stub),
        ...registrationRoutes(stub),
      ]);
    }).not.toThrow();
  });

  /** The caller is mid-login and has no session; the mfaToken is the credential. */
  it('keeps the two sign-in routes PUBLIC and everything else behind a consumer session', () => {
    expect(find('post', '/auth/mfa/challenge').scope).toBe('PUBLIC');
    expect(find('post', '/auth/mfa/verify').scope).toBe('PUBLIC');
    for (const route of routes.filter((r) => r.path.startsWith('/me/'))) {
      expect(route.scope, route.path).toBe('CONSUMER');
    }
  });

  it('declares every mutating route non-retryable', () => {
    for (const route of routes.filter((r) => r.method !== 'get')) {
      expect(route.retryable, route.path).toBe(false);
    }
  });

  /**
   * A token is a live credential; putting it in a Redis key and a log field would be §S12 broken by
   * the rate limiter. The challenge id half is a budget subject that is not itself the secret.
   */
  it('keys the sign-in budgets on the challenge id half of the token, never the token', () => {
    const token = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.the-secret-half';
    for (const path of ['/auth/mfa/challenge', '/auth/mfa/verify']) {
      const spec = find('post', path).rateLimit;
      expect(spec?.by).toEqual(['ip', 'identifier', 'device']);
      const subject = spec?.identifierFrom?.({ body: { mfaToken: token }, query: {}, params: {} });
      expect(subject).toBe('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
      expect(subject).not.toContain('the-secret-half');
    }
  });

  it('gives no budget subject for a malformed token rather than keying on rubbish', () => {
    const spec = find('post', '/auth/mfa/verify').rateLimit;
    expect(spec?.identifierFrom?.({ body: { mfaToken: 'nope' }, query: {}, params: {} })).toBeUndefined();
    expect(spec?.identifierFrom?.({ body: {}, query: {}, params: {} })).toBeUndefined();
  });

  it('caps regenerating the backup codes at three an hour, because each call destroys a sheet', () => {
    expect(find('post', '/me/mfa/recovery-codes').rateLimit).toEqual({
      points: 3,
      durationSeconds: 3600,
      by: ['user', 'ip'],
    });
  });

  it('paginates the factor list, which assertRouteInvariants would otherwise refuse', () => {
    expect(find('get', '/me/mfa/factors').paginated).toBe('page');
  });

  describe('POST /auth/mfa/verify body', () => {
    const body = () => find('post', '/auth/mfa/verify').schema.body;
    const base = {
      mfaToken: 'a.b',
      factorId: '11111111-1111-4111-8111-111111111111',
    };

    it('takes exactly one of code and assertion', () => {
      expect(body()?.safeParse({ ...base, code: '123456' }).success).toBe(true);
      expect(body()?.safeParse({ ...base, assertion: { id: 'x' } }).success).toBe(true);
      expect(body()?.safeParse({ ...base, code: '123456', assertion: { id: 'x' } }).success).toBe(false);
      expect(body()?.safeParse(base).success).toBe(false);
    });

    it('is strict, so a field a client invents is a 422 rather than silence', () => {
      expect(body()?.safeParse({ ...base, code: '1', scope: 'STAFF' }).success).toBe(false);
    });
  });

  describe('POST /me/step-up body', () => {
    const body = () => find('post', '/me/step-up').schema.body;

    it('takes exactly one of code, assertion and password', () => {
      const factorId = '11111111-1111-4111-8111-111111111111';
      expect(body()?.safeParse({ factorId, code: '123456' }).success).toBe(true);
      expect(body()?.safeParse({ password: 'a sturdy passphrase 1' }).success).toBe(true);
      expect(body()?.safeParse({ factorId, code: '1', password: 'x' }).success).toBe(false);
      expect(body()?.safeParse({ factorId }).success).toBe(false);
    });
  });

  /** §S7: the gate reads this, and its absence must be a 403 naming the remedy, not a 422. */
  it('accepts a body with no stepUpToken on both §S7 routes, so the gate answers and not the schema', () => {
    expect(find('delete', '/me/mfa/factors/:id').schema.body?.safeParse({}).success).toBe(true);
    expect(find('post', '/me/mfa/recovery-codes').schema.body?.safeParse({}).success).toBe(true);
  });

  it('takes the factor id as a uuid, so a bad one never reaches a ::uuid cast', () => {
    expect(find('delete', '/me/mfa/factors/:id').schema.params?.safeParse({ id: 'nope' }).success).toBe(
      false,
    );
  });
});
