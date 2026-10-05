// Cannibalized from kumtru/backend-apis/src/modules/ledger/infrastructure/providerRegistry.ts (T-001),
// adapted: the adapters are passed in rather than imported.
//
// The one place a ProviderCode becomes a concrete adapter (m8 §6). Nothing outside `jobs/` resolves a
// provider any other way, so adding provider #2 is a new client file plus one more entry here.
//
// Why injected instead of a module-level `{ PAYSTACK: paystackAdapter }`: importing the Paystack client
// here would make this file a provider client by the rules of design §4.4 — a client is importable only
// from `jobs/`, and this registry is reached from services and schedulers too. `jobs/providers.ts` is
// the one file that imports the client and hands the adapter in, which keeps both true at once: the
// registry stays the single lookup point, and the network code stays inside jobs/.
import { ApiError } from '../../../platform/errors.js';
import type { PaymentProviderAdapter, ProviderCode } from '../domain/providerAdapter.js';

export type ProviderAdapters = Partial<Record<ProviderCode, PaymentProviderAdapter>>;

export interface ProviderRegistry {
  getAdapter(code: ProviderCode): PaymentProviderAdapter;
}

/**
 * Which provider handles a brand-new charge. Today: always PAYSTACK.
 *
 * This is the seam a second provider's rollout logic — a config flag, a percentage split, health-based
 * failover — plugs into later. None of that is built now; keeping this function is what makes sure
 * there is one place for it when it is (m8 §6).
 */
export const providerForNewCharge = (): ProviderCode => 'PAYSTACK';

export function createProviderRegistry(adapters: ProviderAdapters): ProviderRegistry {
  for (const [code, adapter] of Object.entries(adapters)) {
    // A registry built at boot is checked at boot: an adapter filed under the wrong code would route
    // a charge to a provider that never collected it, and the ledger would be tagged with a lie.
    if (adapter && adapter.code !== code) {
      throw new Error(`ledger: adapter '${adapter.code}' is registered under the code '${code}'`);
    }
  }

  return {
    getAdapter(code) {
      const adapter = adapters[code];
      if (!adapter) {
        throw new ApiError(
          503,
          'PAYMENT_PROVIDER_UNAVAILABLE',
          'The payment provider is unavailable',
          `no payment provider adapter is registered for ${code}`,
        );
      }
      return adapter;
    },
  };
}
