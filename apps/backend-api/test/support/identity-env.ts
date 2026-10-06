// The variables the identity module refuses to boot without, in one place.
//
// `createIdentityAuth` throws, naming the variable, when any of these is missing — deliberately, so
// a misconfigured process dies at startup rather than on somebody's first OTP or first invitation.
// The cost is that every suite which boots a real process has to supply them, and those suites build
// their environment by hand. T-035 added the third key and two such builders went without it, which
// nothing but an infra run would have noticed. One export, spread everywhere, removes that.
import { randomBytes } from 'node:crypto';

export const identityProcessEnv = (): Record<string, string> => ({
  IDENTITY_SIGNING_KEY: randomBytes(32).toString('hex'),
  IDENTITY_SIGNING_KEY_ID: 'test-key',
  /** T-032: an HMAC under an empty key is not an HMAC, and no OTP could be issued. */
  IDENTITY_HMAC_PEPPER: 'p'.repeat(32),
  /** T-035: a party invitation's destination must be stored recoverably to be sent (§S9). */
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
});
