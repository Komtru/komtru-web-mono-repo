import { describe, expect, it } from 'vitest';
import * as identity from '../../../src/modules/identity/index.js';
import { modules } from '../../../src/modules/index.js';

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
    const registered = modules.filter((module) => module.name === 'identity');
    expect(registered).toHaveLength(1);
    expect(registered[0]?.seed).toBeTypeOf('function');
  });

  it('only ever names a permission the catalogue knows', () => {
    for (const route of modules.flatMap((module) => module.routes ?? []))
      if (route.permission) expect(identity.isKnownPermission(route.permission)).toBe(true);
  });
});

describe('identity module wiring', () => {
  it('declares the username routes on the module', () => {
    const route = identity.identityModule.routes?.find((r) => r.path === '/usernames/availability');
    expect(route?.rateLimit?.points).toBe(20);
  });

  // Reading the pool before start() is a programming error, not a 500 from an undefined connection.
  it('refuses to serve a route before the module has started', async () => {
    const route = identity.identityModule.routes?.find((r) => r.path === '/me/username/history');
    await expect(
      route?.handler({
        params: {},
        query: {},
        body: {},
        actor: 'user:11111111-1111-4111-8111-111111111111',
        req: {} as never,
        res: {} as never,
      }),
    ).rejects.toThrow(/before the module started/);
  });
});
