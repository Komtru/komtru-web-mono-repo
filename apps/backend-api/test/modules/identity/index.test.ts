import { describe, expect, it } from 'vitest';
import * as identity from '../../../src/modules/identity/index.js';
import { ANONYMOUS_ACTOR } from '../../../src/platform/http/principal.js';
import { stubProcessDeps, testModules } from '../../support/modules.js';

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
