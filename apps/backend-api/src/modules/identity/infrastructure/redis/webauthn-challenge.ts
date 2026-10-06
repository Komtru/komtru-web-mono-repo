// The server nonce of a WebAuthn ceremony, between `…/options` and `…/verify`.
//
// In Redis and NOT in `otp_challenges`, deliberately. That table is the right home for a short-lived
// single-use secret with an attempt cap — T-032 made it mean exactly that, and the mfa token and the
// step-up token both live there. A WebAuthn challenge is the opposite shape: a nonce the SERVER
// issued and must READ BACK to hand to the verifier. `otp_challenges` stores only HMACs by design,
// and adding a plaintext column to it would weaken a table that currently cannot leak a code, for
// the sake of a value whose entire life is one browser prompt.
//
// `GETDEL` is what makes it single-use: a replayed ceremony finds nothing, which is the WebAuthn
// anti-replay property the challenge exists for.
import type { Redis } from 'ioredis';
import type { Logger } from '../../../../platform/logger.js';

/** The browser prompt itself times out at 60s; five minutes is generous and bounds the key. */
export const WEBAUTHN_CHALLENGE_TTL_SECONDS = 300;

const KEY = (ceremonyKey: string): string => `mfa:webauthn:${ceremonyKey}`;

export interface WebauthnChallengeStore {
  put(ceremonyKey: string, challenge: string): Promise<void>;
  /** The challenge, removed in the same round trip. `null` when there was none. */
  take(ceremonyKey: string): Promise<string | null>;
}

export function createWebauthnChallengeStore(redis: Redis, logger: Logger): WebauthnChallengeStore {
  return {
    put: async (ceremonyKey, challenge) => {
      await redis.set(KEY(ceremonyKey), challenge, 'EX', WEBAUTHN_CHALLENGE_TTL_SECONDS);
    },
    take: async (ceremonyKey) => {
      try {
        return await redis.getdel(KEY(ceremonyKey));
      } catch (error) {
        // A Redis blip costs the user one retry of the browser prompt. Failing CLOSED is the only
        // safe direction: a ceremony that proceeded without its challenge would verify a signature
        // over a nonce nobody issued.
        logger.error({ err: error }, 'identity: could not read a webauthn challenge');
        return null;
      }
    },
  };
}
