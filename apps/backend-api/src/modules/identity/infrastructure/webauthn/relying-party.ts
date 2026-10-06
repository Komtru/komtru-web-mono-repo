// The only file in this codebase that imports `@simplewebauthn/server`.
//
// WebAuthn verification is CBOR, COSE keys and signature checking over an attestation object, and
// hand-writing that would be the opposite of the TOTP decision one directory over: TOTP has
// published test vectors and is forty lines of arithmetic, this is a parser for attacker-supplied
// binary. So it is a dependency — wrapped, so the rest of the module never sees the library's types
// and the relying-party configuration is bound once rather than passed to every call site.
//
// The wrapper also turns the library's THROWS into verdicts. `verifyRegistrationResponse` raises on
// a challenge mismatch, a wrong origin and a dozen other refusals, and a service that let those
// through would answer 500 to a user whose browser simply timed out the prompt.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AppConfig } from '../../../../config/env.js';
import type { Logger } from '../../../../platform/logger.js';

export interface PasskeyDescriptor {
  /** base64url, which is how WebAuthn JSON carries a credential id. */
  id: string;
  transports: string[];
}

export interface VerifiedRegistration {
  credentialId: Buffer;
  publicKey: Buffer;
  counter: number;
  aaguid: string | null;
  transports: string[];
  backedUp: boolean;
}

export interface RelyingParty {
  /** The brand name an authenticator shows the user, also used as the TOTP issuer. */
  rpName: string;
  registrationOptions(input: {
    userId: string;
    userName: string;
    displayName: string;
    exclude: PasskeyDescriptor[];
  }): Promise<Record<string, unknown>>;
  verifyRegistration(input: {
    response: unknown;
    expectedChallenge: string;
  }): Promise<VerifiedRegistration | null>;
  authenticationOptions(input: { allow: PasskeyDescriptor[] }): Promise<Record<string, unknown>>;
  verifyAuthentication(input: {
    response: unknown;
    expectedChallenge: string;
    credential: { id: string; publicKey: Buffer; counter: number; transports: string[] };
  }): Promise<{ verified: boolean; newCounter: number }>;
}

/** The `aaguid` column is a uuid, and the library hands back the all-zero one for "did not say". */
const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000';

export function createRelyingParty(config: AppConfig, logger: Logger): RelyingParty {
  const { rpId, rpName, origins } = config.identity.webauthn;

  // Fails here, naming the variable, rather than at a user's first ceremony. An empty list is not a
  // wildcard: `expectedOrigin: []` makes every origin check vacuous in some library versions and
  // every ceremony fail in others, and neither is a thing to discover in production.
  if (origins.length === 0) {
    throw new Error('WEBAUTHN_ORIGINS is required to build the identity module');
  }

  return {
    rpName,

    registrationOptions: async (input) =>
      (await generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userName: input.userName,
        userDisplayName: input.displayName,
        // The handle the authenticator files the credential under. The opaque user id and never an
        // address: it is stored on the device, syncs to the user's cloud account, and §S12 keeps
        // an email out of everything it can.
        userID: new TextEncoder().encode(input.userId),
        attestationType: 'none',
        excludeCredentials: input.exclude,
        authenticatorSelection: {
          residentKey: 'preferred',
          // 'preferred' and not 'required': this build uses a passkey as a SECOND factor beside a
          // password, so demanding the authenticator's own user verification would turn a security
          // key with no PIN into a factor nobody can enrol.
          userVerification: 'preferred',
        },
      })) as unknown as Record<string, unknown>,

    verifyRegistration: async (input) => {
      let verified;
      try {
        verified = await verifyRegistrationResponse({
          response: input.response as never,
          expectedChallenge: input.expectedChallenge,
          expectedOrigin: origins,
          expectedRPID: rpId,
          // See `authenticatorSelection` above: the second-factor use does not demand UV.
          requireUserVerification: false,
        });
      } catch (error) {
        logger.warn({ err: error }, 'identity: a passkey registration did not verify');
        return null;
      }
      if (!verified.verified) return null;

      const { credential, aaguid, credentialBackedUp } = verified.registrationInfo;
      return {
        credentialId: Buffer.from(credential.id, 'base64url'),
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        aaguid: aaguid && aaguid !== ZERO_AAGUID ? aaguid : null,
        transports: credential.transports ?? [],
        backedUp: credentialBackedUp,
      };
    },

    authenticationOptions: async (input) =>
      (await generateAuthenticationOptions({
        rpID: rpId,
        allowCredentials: input.allow,
        userVerification: 'preferred',
      })) as unknown as Record<string, unknown>,

    verifyAuthentication: async (input) => {
      try {
        const verified = await verifyAuthenticationResponse({
          response: input.response as never,
          expectedChallenge: input.expectedChallenge,
          expectedOrigin: origins,
          expectedRPID: rpId,
          credential: {
            id: input.credential.id,
            publicKey: new Uint8Array(input.credential.publicKey),
            counter: input.credential.counter,
            transports: input.credential.transports,
          },
          requireUserVerification: false,
        });
        return { verified: verified.verified, newCounter: verified.authenticationInfo.newCounter };
      } catch (error) {
        logger.warn({ err: error }, 'identity: a passkey assertion did not verify');
        return { verified: false, newCounter: 0 };
      }
    },
  };
}
