// Where the Paystack client enters the program, and the only place it does.
//
// `komtru/provider-clients` and test/platform/provider-boundaries.test.ts allow `client.ts` to be
// imported from `jobs/` and nowhere else (design §4.4). Keeping the wiring here rather than inside
// `infrastructure/providerRegistry.ts` is what lets the registry stay the single lookup point for every
// caller while the network code stays inside a job.
import { createProviderRegistry, type ProviderRegistry } from '../infrastructure/providerRegistry.js';
import {
  createPaystackAdapter,
  type PaystackClientOptions,
} from '../infrastructure/providers/paystack/client.js';

/** The live registry. One more line per provider, forever. */
export const paymentProviders = (options: PaystackClientOptions): ProviderRegistry =>
  createProviderRegistry({ PAYSTACK: createPaystackAdapter(options) });
