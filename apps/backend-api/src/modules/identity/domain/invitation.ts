// Party invitations (M1 §5.10, §8.5): tagging someone who has no account yet.
//
// An invitation table is a contact list of people who never signed up, which is why §5.10 stores the
// destination three ways and never in clear: HASHED so a verification can find it, MASKED so a
// screen can show where it went, ENCRYPTED so it can still be sent. This file owns the first of
// those and the token; the service owns the row.
import { sha256, type HmacHasher } from '../../../platform/crypto/hmac.js';
import { randomToken } from '../../../platform/crypto/random.js';

/** §8.5 step 7. After this the invitation expires, the event fires and M7 cancels the trade. */
export const INVITATION_TTL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Domain-separated from the OTP hasher's.
 *
 * Both HMAC an email or a phone under the same pepper. Without separate domains the digest of
 * `jane@gmail.com` in `party_invitations` equals the one in `otp_challenges`, so a leaked row from
 * either table confirms a guess against the other — exactly what crypto/hmac.ts's `domain` exists
 * to prevent.
 */
export const INVITATION_DESTINATION_DOMAIN = 'identity:party-invitation:destination';

/** The side the invitee takes on the trade. Never a capability (§5.10). */
export const INVITED_ROLES = ['BUYER', 'SELLER'] as const;
export type InvitedRole = (typeof INVITED_ROLES)[number];

/**
 * The claim token and the digest stored in `token_hash`.
 *
 * Unkeyed SHA-256, for the reason crypto/hmac.ts gives about refresh tokens: 256 bits of uniform
 * randomness has nothing to brute-force, so a pepper would only make `token_hash` depend on a secret
 * that, if rotated, invalidates every outstanding invitation for no security gain.
 */
export const issueInvitationToken = (): { token: string; tokenHash: Buffer } => {
  const token = randomToken();
  return { token, tokenHash: sha256(token) };
};

export const invitationTokenHash = (token: string): Buffer => sha256(token);

export const invitationExpiry = (from: Date): Date => new Date(from.getTime() + INVITATION_TTL_DAYS * DAY_MS);

export const invitationDestinationHash = (hasher: HmacHasher, canonical: string): Buffer =>
  hasher.hmac(INVITATION_DESTINATION_DOMAIN, canonical);

/**
 * Which `otp_channel` values an invitation to this contact channel may have been stored under.
 *
 * A phone invitation is one destination reachable three ways, and the channel a trade's inviter
 * chose must not decide whether verifying that number claims it: somebody invited over WhatsApp who
 * verifies by SMS has proven the same number. The hash is what identifies the person; the channel
 * only separates a phone from an email, which cannot collide anyway.
 */
export type InvitationChannel = 'SMS' | 'EMAIL' | 'WHATSAPP' | 'VOICE';

export const invitationChannelsFor = (channel: 'EMAIL' | 'PHONE'): readonly InvitationChannel[] =>
  channel === 'EMAIL' ? ['EMAIL'] : ['SMS', 'WHATSAPP', 'VOICE'];
