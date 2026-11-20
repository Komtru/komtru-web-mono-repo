// The email or phone a company invites a POC by (m2 §2). Canonicalised the way identity canonicalises
// its own verified contacts, so the address an invitee later verifies hashes to the same lookup value
// the invitation was filed under.
//
// The lookup hash is a keyed HMAC under this module's own domain, never a bare hash: an email address
// is a guessable value, and a leaked invitations table must not confirm a guess.
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { maskEmail, maskPhone, normaliseEmail, normalisePhone } from '../../../platform/identifiers.js';

export const INVITATION_CHANNELS = ['EMAIL', 'PHONE'] as const;
export type InvitationChannel = (typeof INVITATION_CHANNELS)[number];

export const INVITATION_DESTINATION_DOMAIN = 'logistics:invitation:destination';

/** How long a pending invitation waits for its invitee to sign up, mirroring staff invitations (T-038). */
export const INVITATION_TTL_DAYS = 7;

export const invitationExpiry = (from: Date): Date =>
  new Date(from.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

export interface InviteContact {
  channel: InvitationChannel;
  /** What is sealed and sent to: the address as typed (lowercased) or the E.164 number. */
  address: string;
  /** What is hashed for lookup: identity's `email_normal` or `phone_e164`. */
  canonical: string;
  masked: string;
}

/** `null` for a value that is neither a valid email nor a valid phone number. */
export function parseInviteContact(input: { email?: string; phone?: string }): InviteContact | null {
  if (input.email !== undefined) {
    try {
      const { email, emailNormal } = normaliseEmail(input.email);
      return { channel: 'EMAIL', address: email, canonical: emailNormal, masked: maskEmail(email) };
    } catch {
      return null;
    }
  }
  if (input.phone !== undefined) {
    const phone = normalisePhone(input.phone);
    if (!phone) return null;
    return {
      channel: 'PHONE',
      address: phone.phoneE164,
      canonical: phone.phoneE164,
      masked: maskPhone(phone.phoneE164),
    };
  }
  return null;
}

/** The channel is part of the hashed value, so an email and a phone can never share a lookup row. */
export const invitationDestinationHash = (
  hasher: HmacHasher,
  channel: InvitationChannel,
  canonical: string,
): Buffer => hasher.hmac(INVITATION_DESTINATION_DOMAIN, `${channel}:${canonical}`);
