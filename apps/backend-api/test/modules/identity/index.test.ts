import { describe, expect, it } from 'vitest';
import * as identity from '../../../src/modules/identity/index.js';
import { ANONYMOUS_ACTOR } from '../../../src/platform/http/principal.js';
import { assertRouteInvariants } from '../../../src/platform/http/route.js';
import { registryConfig, stubProcessDeps, testModules } from '../../support/modules.js';

describe('identity module surface', () => {
  it('exports the catalogue and the username surface other modules need', () => {
    for (const name of [
      'skeleton',
      'skeletonVariants',
      'validateUsernameFormat',
      'suggestionCandidates',
      'isAllowed',
      'PERMISSION_CODES',
      'ROLE_CODES',
      'CATALOGUE_COUNTS',
      'seedIdentityCatalogue',
      'checkUsernameAvailability',
      'claimUsername',
      'changeUsername',
      'tombstoneUsername',
      'usernameClaimedEvent',
      'users',
      'usernameHistory',
      'reservedUsernames',
    ])
      expect(identity).toHaveProperty(name);
  });

  it('is registered once, with a seed hook', () => {
    const registered = testModules().filter((module) => module.name === 'identity');
    expect(registered).toHaveLength(1);
    expect(registered[0]?.seed).toBeTypeOf('function');
  });

  it('only ever names a permission the catalogue knows', () => {
    for (const route of testModules().flatMap((module) => module.routes ?? []))
      if (route.permission) expect(identity.isKnownPermission(route.permission)).toBe(true);
  });
});

describe('identity module wiring', () => {
  const routes = () => identity.createIdentityAuth(stubProcessDeps()).routes ?? [];

  it('serves both halves of identity: the auth routes and the username routes', () => {
    const paths = routes().map((r) => r.path);
    expect(paths).toContain('/auth/refresh');
    expect(paths).toContain('/usernames/availability');
  });

  it('declares the username routes on the module', () => {
    expect(routes().find((r) => r.path === '/usernames/availability')?.rateLimit?.points).toBe(20);
  });

  // The routes used to close over a holder that `start()` filled in, so calling one before the
  // process started threw. The builder is handed the pool, so that state is gone - which means the
  // only way a /me route can fail to find a user is the caller not being signed in.
  it('rejects an unauthenticated caller with a 401, not a connection error', async () => {
    const route = routes().find((r) => r.path === '/me/username/history');
    await expect(
      route?.handler({
        params: {},
        query: {},
        body: {},
        actor: ANONYMOUS_ACTOR,
        req: {} as never,
        res: {} as never,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });
});

describe('identity module wiring (T-032)', () => {
  it('refuses to build without IDENTITY_HMAC_PEPPER, naming the variable', () => {
    const config = registryConfig();
    const withoutPepper = { ...config, identity: { ...config.identity, hmacPepper: undefined } };
    expect(() => identity.createIdentityAuth({ ...stubProcessDeps(), config: withoutPepper })).toThrow(
      /IDENTITY_HMAC_PEPPER/,
    );
  });

  it('serves every route M1 §10.1 names for this ticket', () => {
    const paths = (identity.createIdentityAuth(stubProcessDeps()).routes ?? []).map(
      (r) => `${r.method.toUpperCase()} ${r.path}`,
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        'POST /auth/register',
        'POST /auth/otp/resend',
        'POST /auth/verify-otp',
        'POST /auth/login',
        'POST /auth/password/forgot',
        'POST /auth/password/reset',
        'POST /auth/password/change',
        'GET /me/terms',
        'POST /me/terms/accept',
      ]),
    );
  });

  it('passes assertRouteInvariants over the whole module', () => {
    expect(() => {
      assertRouteInvariants(identity.createIdentityAuth(stubProcessDeps()).routes ?? []);
    }).not.toThrow();
  });

  it('declares no duplicate path across the four route groups', () => {
    const labels = (identity.createIdentityAuth(stubProcessDeps()).routes ?? []).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('exports the surface notify and the later identity tickets import', () => {
    for (const name of [
      'hashPassword',
      'verifyPassword',
      'needsRehash',
      'argon2Hasher',
      'checkPasswordPolicy',
      'checkPasswordBreached',
      'lockoutMinutes',
      'otpPurposeLabel',
      'hashDestination',
      'nextStep',
      'termsUpToDate',
      'resolveTermsVersions',
      'writeAudit',
      'AUDIT_ACTIONS',
      'identityUserRegisteredEvent',
      'identityOtpRequestedEvent',
      'identityEmailVerifiedEvent',
      'identityPhoneVerifiedEvent',
      'identityLoginFailedEvent',
      'identityPasswordChangedEvent',
      'identityDeviceSignedInEvent',
      'identityUserStatusChangedEvent',
      'identityVerificationLevelChangedEvent',
    ])
      expect(identity).toHaveProperty(name);
  });
});
