// T-037: `canActAsBuyer(userId)`, design section 6.3's "one identity function" with its lookup.
// The status rule itself is `domain/capability.ts`; what is tested here is the userId entry point,
// the not-ACTIVE refusal, and that there is no caller-supplied way round the merchant block.
import { describe, expect, it, vi } from 'vitest';
import * as identity from '../../../../src/modules/identity/index.js';
import {
  createCapabilityService,
  type BuyerFacts,
  type BuyerFactsLookup,
} from '../../../../src/modules/identity/services/capability.service.js';
import type { CapabilityStatus } from '../../../../src/modules/identity/domain/capability.js';

const serviceWith = (facts: Partial<BuyerFacts> = {}) => {
  const lookup = vi
    .fn<BuyerFactsLookup>()
    .mockResolvedValue({ userStatus: 'ACTIVE', merchantStatus: null, ...facts });
  return { service: createCapabilityService({ facts: lookup }), lookup };
};

describe('capability service: canActAsBuyer(userId)', () => {
  it('is false while an ACTIVE MERCHANT capability exists', async () => {
    const { service, lookup } = serviceWith({ merchantStatus: 'ACTIVE' });
    await expect(service.canActAsBuyer('user-1')).resolves.toBe(false);
    expect(lookup).toHaveBeenCalledWith('user-1');
  });

  it.each<CapabilityStatus | null>([null, 'PENDING', 'SUSPENDED', 'REVOKED'])(
    'is true for an ACTIVE account whose merchant capability is %s',
    async (merchantStatus) => {
      await expect(serviceWith({ merchantStatus }).service.canActAsBuyer('user-1')).resolves.toBe(true);
    },
  );

  it.each(['PENDING_VERIFICATION', 'RESTRICTED', 'SUSPENDED', 'LOCKED', 'CLOSED', 'ANONYMISED', null])(
    'is false for an account that is %s, whatever its capabilities',
    async (userStatus) => {
      await expect(serviceWith({ userStatus }).service.canActAsBuyer('user-1')).resolves.toBe(false);
    },
  );

  it('offers no bypass: a second argument changes nothing for an ACTIVE merchant', async () => {
    const { service } = serviceWith({ merchantStatus: 'ACTIVE' });
    // The type has one parameter; call it as an untyped caller (JavaScript, a cast) would.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const method = service.canActAsBuyer;
    const result: unknown = await Reflect.apply(method, service, ['user-1', { tradeInFlight: true }]);
    expect(result).toBe(false);
  });

  it('agrees with the pure status rule trades and party cards already delegate to', async () => {
    for (const merchantStatus of [null, 'PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const)
      await expect(serviceWith({ merchantStatus }).service.canActAsBuyer('u')).resolves.toBe(
        identity.canActAsBuyer(merchantStatus),
      );
  });

  it('is exported from the identity barrel without shadowing the pure rule', () => {
    expect(identity).toHaveProperty('createCapabilityService');
    expect(identity).toHaveProperty('postgresBuyerFacts');
    expect(identity.canActAsBuyer('ACTIVE')).toBe(false);
    expect(identity.canActAsBuyer.length).toBe(1);
  });
});
