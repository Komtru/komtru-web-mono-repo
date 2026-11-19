// Where a KYC adapter enters the program, and the only place it does.
//
// `komtru/provider-clients` and test/platform/provider-boundaries.test.ts allow `*.client.ts` to be
// imported from `jobs/` and nowhere else (design §4.4). Keeping the construction here rather than in
// module.ts means the one import of each client sits inside the directory the rule names.
import type { TrustConfig } from '../../../config/env.js';
import type { Logger } from '../../../platform/logger.js';
import { KycProviderNotConfiguredError } from '../domain/errors.js';
import type { KycProviderAdapter } from '../domain/provider.js';
import type { SocialProofAdapter } from '../domain/social-proof.js';
import { createDojahClient } from '../infrastructure/providers/dojah.client.js';
import { createYouverifyClient } from '../infrastructure/providers/youverify.client.js';
import { createFakeKycClient } from '../infrastructure/providers/fake-kyc.client.js';
import { createFakeSocialClient } from '../infrastructure/providers/fake-social.client.js';

const DOJAH_VARIABLES = ['DOJAH_APP_ID', 'DOJAH_SECRET_KEY', 'DOJAH_BASE_URL'] as const;

const YOUVERIFY_VARIABLES = [
  'YOUVERIFY_SECRET_TOKEN',
  'YOUVERIFY_PUBLIC_MERCHANT_KEY',
  'YOUVERIFY_WEBHOOK_SECRET',
  'YOUVERIFY_BASE_URL',
] as const;

/**
 * The adapter this process will attest identities with. One more branch per provider, forever.
 *
 * Both failure modes are loud at build time rather than at the first verification: a DOJAH selection
 * with no credentials names the three variables, and a FAKE selection says so in the boot log. An
 * operator reading a startup log should never have to find out from a database row which of the two
 * is deciding who may sell on this platform.
 */
export function kycProvider(config: TrustConfig, logger: Logger): KycProviderAdapter {
  if (config.provider === 'YOUVERIFY') {
    // All four or none, like Dojah: which one is missing is a question the operator's own .env
    // answers faster than we can.
    if (!config.youverify) throw new KycProviderNotConfiguredError('YOUVERIFY', YOUVERIFY_VARIABLES);
    return createYouverifyClient(config.youverify, logger);
  }

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

/**
 * The social-proof lookup. One implementation, and no config flag selecting between them — because
 * there is nothing to select.
 *
 * Unlike the KYC adapters this is not "no account yet": neither platform is purchasable at this
 * stage at all. Instagram's Basic Display API died for personal accounts in December 2024 and the
 * Graph API that replaced it needs a Professional account plus a Meta app review; X bills per profile
 * read. A `TRUST_SOCIAL_PROVIDER` variable offering a choice of one would be a configuration
 * surface pretending a decision exists. It becomes a branch, like `kycProvider` above, the day one
 * does.
 *
 * It warns for the same reason the FAKE KYC selection does: an operator reading a boot log should
 * never have to learn from a database row which badges on this platform were attested by nobody.
 */
export function socialProofAdapter(logger: Logger): SocialProofAdapter {
  logger.warn(
    { provider: 'FAKE' },
    'trust: social proof is running on the deterministic FAKE lookup; no Instagram or X integration exists',
  );
  return createFakeSocialClient();
}
