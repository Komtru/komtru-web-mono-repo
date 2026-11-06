// The social-proof lookup, and the honest state of it: there is no integration behind this.
//
// M1 §7.2 is the decision and §8's posture on KYC vendors applies here with more force, because
// neither platform is purchasable at all at this stage. Instagram's Basic Display API died for
// personal accounts in December 2024 and the Graph API that replaced it requires a Professional
// account plus a Meta app review; X charges per profile read. So this is the seam, scripted — the
// same posture `fake-kyc.client.ts` takes, for the same reason, and a `*.client.ts` so the T-028
// boundary keeps it reachable from `jobs/` and nowhere else.
//
// Scripted by the handle's last character so every branch is reachable by hand, and so the four
// outcomes a caller must distinguish are exercised by default rather than by an opt-in a test has to
// remember to configure: `...z` is an unknown handle, `...y` has no code up, `...x` is the platform
// refusing to answer, everything else passes.
import type { SocialLookupResult, SocialProofAdapter } from '../../domain/social-proof.js';

const BY_TRAILING_CHAR: Record<string, SocialLookupResult> = {
  z: { outcome: 'NOT_FOUND' },
  y: { outcome: 'NO_CODE' },
  x: { outcome: 'INDETERMINATE' },
};

export function createFakeSocialClient(): SocialProofAdapter {
  return {
    // Named in one grep, so "which badges were attested by nobody" is answerable from the log the
    // day a real integration exists.
    name: 'FAKE',
    lookup: ({ handle }) =>
      // `foundIn: 'bio'` and NOT the profile's text. The adapter is given the code and returns a
      // verdict precisely so the bio stays inside the adapter, where it is discarded: storing
      // somebody's bio because we happened to read it is collecting personal data to answer a
      // yes/no question we already have the answer to.
      Promise.resolve(
        BY_TRAILING_CHAR[handle.slice(-1).toLowerCase()] ?? { outcome: 'CODE_PRESENT', foundIn: 'bio' },
      ),
  };
}
