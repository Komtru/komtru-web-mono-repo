// T-037: `canActAsBuyer(userId)`, design section 6.3's "one identity function" with its lookup.
// The status rule itself is `domain/capability.ts` (covered through party cards and invitations);
// what is new and tested here is the userId entry point and the in-flight rule.
import { describe, expect, it, vi } from 'vitest';
import * as identity from '../../../../src/modules/identity/index.js';
import {
  createCapabilityService,
  type MerchantStatusLookup,
} from '../../../../src/modules/identity/services/capability.service.js';
import type { CapabilityStatus } from '../../../../src/modules/identity/domain/capability.js';

const serviceWith = (status: CapabilityStatus | null) => {
  const lookup = vi.fn<MerchantStatusLookup>().mockResolvedValue(status);
  return { service: createCapabilityService({ merchantStatus: lookup }), lookup };
};

describe('capability service: canActAsBuyer(userId)', () => {
  it('is false while an ACTIVE MERCHANT capability exists', async () => {
    const { service, lookup } = serviceWith('ACTIVE');
    await expect(service.canActAsBuyer('user-1')).resolves.toBe(false);
    expect(lookup).toHaveBeenCalledWith('user-1');
  });

  it.each<CapabilityStatus | null>([null, 'PENDING', 'SUSPENDED', 'REVOKED'])(
    'is true when the merchant capability is %s',
    async (status) => {
      await expect(serviceWith(status).service.canActAsBuyer('user-1')).resolves.toBe(true);
    },
  );

  it('lets a trade already in flight finish normally, even for an ACTIVE merchant', async () => {
    const { service, lookup } = serviceWith('ACTIVE');
    await expect(service.canActAsBuyer('user-1', { tradeInFlight: true })).resolves.toBe(true);
    // Nothing to look up: the answer cannot depend on the capability, so do not pay for the query.
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not let the in-flight exemption cover a NEW buyer-side commitment', async () => {
    const { service } = serviceWith('ACTIVE');
    await expect(service.canActAsBuyer('user-1', { tradeInFlight: false })).resolves.toBe(false);
    await expect(service.canActAsBuyer('user-1')).resolves.toBe(false);
  });

  it('agrees with the pure status rule trades and party cards already delegate to', async () => {
    for (const status of [null, 'PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const)
      await expect(serviceWith(status).service.canActAsBuyer('u')).resolves.toBe(
        identity.canActAsBuyer(status),
      );
  });

  it('is exported from the identity barrel without shadowing the pure rule', () => {
    expect(identity).toHaveProperty('createCapabilityService');
    expect(identity).toHaveProperty('postgresMerchantStatus');
    // `canActAsBuyer` on the barrel is still the status function the trades module imports.
    expect(identity.canActAsBuyer('ACTIVE')).toBe(false);
    expect(identity.canActAsBuyer.length).toBe(1);
  });
});
