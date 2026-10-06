// Where a KYC adapter enters the program, and the only place it does.
//
// `komtru/provider-clients` and test/platform/provider-boundaries.test.ts allow `*.client.ts` to be
// imported from `jobs/` and nowhere else (design §4.4). Keeping the construction here rather than in
// module.ts means the one import of each client sits inside the directory the rule names.
import type { TrustConfig } from '../../../config/env.js';
import type { Logger } from '../../../platform/logger.js';
import { KycProviderNotConfiguredError } from '../domain/errors.js';
import type { KycProviderAdapter } from '../domain/provider.js';
import { createDojahClient } from '../infrastructure/providers/dojah.client.js';
import { createFakeKycClient } from '../infrastructure/providers/fake-kyc.client.js';

const DOJAH_VARIABLES = ['DOJAH_APP_ID', 'DOJAH_SECRET_KEY', 'DOJAH_BASE_URL'] as const;

/**
 * The adapter this process will attest identities with. One more branch per provider, forever.
 *
 * Both failure modes are loud at build time rather than at the first verification: a DOJAH selection
 * with no credentials names the three variables, and a FAKE selection says so in the boot log. An
 * operator reading a startup log should never have to find out from a database row which of the two
 * is deciding who may sell on this platform.
 */
export function kycProvider(config: TrustConfig, logger: Logger): KycProviderAdapter {
  if (config.provider === 'DOJAH') {
    // `loadConfig` leaves `dojah` absent unless all three are set, so the message lists all three:
    // which one is missing is a question the operator's own .env answers faster than we can.
    if (!config.dojah) throw new KycProviderNotConfiguredError('DOJAH', DOJAH_VARIABLES);
    return createDojahClient(config.dojah);
  }

  logger.warn(
    { provider: 'FAKE', flag: 'TRUST_KYC_PROVIDER' },
    'trust: identity verification is running on the deterministic FAKE adapter; every level it grants is recorded as provider=FAKE',
  );
  return createFakeKycClient();
}
