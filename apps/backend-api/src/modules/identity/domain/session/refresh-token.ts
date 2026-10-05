// The opaque half of M1 D5. The token is 256 bits of randomness handed to the client once; the
// database only ever sees its SHA-256, so a dump of `identity.sessions` is not a set of live
// credentials.
//
// Unkeyed sha256 rather than the keyed `hmac` helper, for the reason that helper's own header gives:
// the input is already 256 uniform bits, so there is nothing to brute-force, and a pepper would make
// every session in the system depend on a secret that cannot be rotated without logging everyone out.
import { sha256 } from '../../../../platform/crypto/hmac.js';
import { randomToken } from '../../../../platform/crypto/random.js';

/** 32 bytes = 256 bits, per M1 D5. */
const REFRESH_TOKEN_BYTES = 32;

export interface IssuedRefreshToken {
  /** Returned to the client once and never stored. */
  token: string;
  /** What goes in `sessions.refresh_token_hash`. */
  hash: Buffer;
}

export function issueRefreshToken(): IssuedRefreshToken {
  const token = randomToken(REFRESH_TOKEN_BYTES);
  return { token, hash: sha256(token) };
}

export const refreshTokenHash = (token: string): Buffer => sha256(token);
