import { describe, expect, it } from 'vitest';
import * as identity from '../../../src/modules/identity/index.js';
import { smsUndeliverable } from '../../../src/modules/identity/index.js';
import { ANONYMOUS_ACTOR } from '../../../src/platform/http/principal.js';
import { assertRouteInvariants } from '../../../src/platform/http/route.js';
import { registryConfig, stubProcessDeps, testModules } from '../../support/modules.js';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/platform/logger.js';
import { identityProcessEnv } from '../../support/identity-env.js';

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
        'GET /auth/terms',
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

describe('identity module wiring (T-035)', () => {
  const auth = () => identity.createIdentityAuth(stubProcessDeps());

  it('serves every route M1 §10.4 names', () => {
    const paths = (auth().routes ?? []).map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /parties/lookup',
        'POST /parties/lookup',
        'GET /parties/suggest',
        'POST /parties/invite',
        'GET /parties/invitations/:token',
      ]),
    );
  });

  it('schedules the invitation expiry sweep, so M7 is never left waiting', () => {
    expect(identity.identityModule(auth()).schedules?.map((job) => job.name)).toContain(
      identity.PARTY_INVITATIONS_EXPIRE_SCHEDULE,
    );
  });

  it('schedules the staff invitation expiry sweep', () => {
    expect(identity.identityModule(auth()).schedules?.map((job) => job.name)).toContain(
      identity.STAFF_INVITATIONS_EXPIRE_SCHEDULE,
    );
  });

  it('refuses to build without ENCRYPTION_KEY, naming the variable', () => {
    // An invitation destination has to be stored recoverably to be sent. A process that cannot
    // encrypt one should say so while it is starting, not on the first invitation.
    const config = registryConfig();
    const withoutKey = { ...config, crypto: {} };
    expect(() => identity.createIdentityAuth({ ...stubProcessDeps(), config: withoutKey })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  it('exports the party surface T-061 and the trades module need', () => {
    for (const name of [
      'canActAsBuyer',
      'partyCard',
      'badgesFor',
      'lookupParty',
      'suggestParties',
      'createInvitation',
      'claimInvitationsForDestination',
      'expireInvitations',
      'identityPartyLookupPerformedEvent',
      'identityPartyInvitationClaimedEvent',
      'identityPartyInvitationExpiredEvent',
      'partyInvitations',
    ])
      expect(identity).toHaveProperty(name);
  });

  it('answers canActAsBuyer so trades can delegate rather than keep a second copy', () => {
    expect(identity.canActAsBuyer('ACTIVE')).toBe(false);
    expect(identity.canActAsBuyer('SUSPENDED')).toBe(true);
    expect(identity.canActAsBuyer(null)).toBe(true);
  });
});

describe('every env a real process is started from satisfies identity (T-035)', () => {
  // `createIdentityAuth` throws when a key is missing, and the suites that boot real processes build
  // their environment by hand. `identityProcessEnv()` is the one list they all spread, and this is
  // the assertion that it is still sufficient — because nothing but an infra run would otherwise
  // notice a fourth key added to the module and not added to that list.
  it('builds the identity module from identityProcessEnv() alone', () => {
    const config = loadConfig({
      LOG_LEVEL: 'silent',
      POSTGRES_URL: 'postgresql://x@localhost/x',
      REDIS_URL: 'redis://localhost:6379',
      ...identityProcessEnv(),
    });
    expect(() =>
      identity.createIdentityAuth({
        db: {} as never,
        redis: {} as never,
        config,
        logger: createLogger(config),
      }),
    ).not.toThrow();
  });
});

describe('smsUndeliverable', () => {
  const config = (nodeEnv: string, smsDryRun: boolean, termii: boolean) =>
    ({
      nodeEnv,
      notify: {
        smsDryRun,
        ...(termii ? { termii: { apiKey: 'k', senderId: 'K', baseUrl: 'https://x' } } : {}),
      },
    }) as unknown as Parameters<typeof smsUndeliverable>[0];

  it('is true outside production whenever no text will really go out', () => {
    expect(smsUndeliverable(config('development', true, true))).toBe(true);
    expect(smsUndeliverable(config('test', false, false))).toBe(true);
  });

  it('is false outside production when SMS really sends', () => {
    expect(smsUndeliverable(config('development', false, true))).toBe(false);
  });

  it('is never true in production, where an emailed code must not prove a phone', () => {
    expect(smsUndeliverable(config('production', true, false))).toBe(false);
    expect(smsUndeliverable(config('production', false, false))).toBe(false);
  });
});
