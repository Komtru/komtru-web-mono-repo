import { describe, expect, it } from 'vitest';
import type { PaymentProviderAdapter } from '../../../src/modules/ledger/domain/providerAdapter.js';
import {
  createProviderRegistry,
  providerForNewCharge,
} from '../../../src/modules/ledger/infrastructure/providerRegistry.js';
import { ApiError } from '../../../src/platform/errors.js';

const adapter = (code: string): PaymentProviderAdapter =>
  ({ code, listBanks: () => Promise.resolve([]) }) as unknown as PaymentProviderAdapter;

describe('the provider registry', () => {
  it('routes every new charge to Paystack today', () => {
    expect(providerForNewCharge()).toBe('PAYSTACK');
  });

  it('resolves a registered adapter', () => {
    const paystack = adapter('PAYSTACK');
    expect(createProviderRegistry({ PAYSTACK: paystack }).getAdapter('PAYSTACK')).toBe(paystack);
  });

  it('resolves the provider chosen for a new charge, which is the contract funding depends on', () => {
    const registry = createProviderRegistry({ PAYSTACK: adapter('PAYSTACK') });
    expect(registry.getAdapter(providerForNewCharge()).code).toBe('PAYSTACK');
  });

  it('refuses a code with no adapter, naming it', () => {
    const registry = createProviderRegistry({});
    expect(() => registry.getAdapter('PAYSTACK')).toThrow(ApiError);
    try {
      registry.getAdapter('PAYSTACK');
    } catch (error) {
      expect((error as ApiError).status).toBe(503);
      expect((error as ApiError).detail).toContain('PAYSTACK');
    }
  });

  it('refuses an adapter registered under a key that is not its own code, at build time', () => {
    // A mis-wired registry must fail at boot, not on the first charge of the day.
    expect(() => createProviderRegistry({ PAYSTACK: adapter('FLUTTERWAVE') })).toThrow(/PAYSTACK/);
  });
});
