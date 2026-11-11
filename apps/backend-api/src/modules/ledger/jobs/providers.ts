// Where the Paystack client enters the program, and the only place it does.
//
// `komtru/provider-clients` and test/platform/provider-boundaries.test.ts allow `client.ts` to be
// imported from `jobs/` and nowhere else (design §4.4). Keeping the wiring here rather than inside
// `infrastructure/providerRegistry.ts` is what lets the registry stay the single lookup point for every
// caller while the network code stays inside a job.
import type { VerifiedTransferView } from '../domain/payouts.js';
import type { VerifiedRefundView } from '../domain/refunds.js';
import { createProviderRegistry, type ProviderRegistry } from '../infrastructure/providerRegistry.js';
import {
  createPaystackAdapter,
  verifyCharge,
  verifyRefund,
  verifyTransfer,
  type PaystackClientOptions,
  type VerifiedCharge,
} from '../infrastructure/providers/paystack/client.js';

/** The live registry. One more line per provider, forever. */
export const paymentProviders = (options: PaystackClientOptions): ProviderRegistry =>
  createProviderRegistry({ PAYSTACK: createPaystackAdapter(options) });

/**
 * The transaction verify call (m8 §5), for the funding jobs. Not an adapter method — see
 * `verifyCharge` — so it is wired here, in the one file allowed to import the client.
 */
export const chargeVerifier =
  (options: PaystackClientOptions) =>
  (reference: string): Promise<VerifiedCharge> =>
    verifyCharge(options, reference);

/** Transfer verify (T-073), for the payout jobs. Wired here for the same reason as `chargeVerifier`. */
export const transferVerifier =
  (options: PaystackClientOptions) =>
  (reference: string): Promise<VerifiedTransferView> =>
    verifyTransfer(options, reference);

/** The refund record lookup (T-075), for the refund jobs. Wired here for the same reason as `chargeVerifier`. */
export const refundVerifier =
  (options: PaystackClientOptions) =>
  (providerRefundId: string): Promise<VerifiedRefundView> =>
    verifyRefund(options, providerRefundId);
