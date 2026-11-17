// Moving an account to a new phone number (F-045, screen SP-M05). Your phone number is your Komtru ID, so both numbers are
// proven and the old one is told.
import type { HmacHasher } from '../../../platform/crypto/hmac.js';

/**
 * The two codes of a change are `SENSITIVE_ACTION` challenges, like a step-up and a staff acceptance, and are told apart
 * from those (and from each other) by the destination they are issued against: a hash bound to ONE pending number and to
 * which end of the move the code is for. A code from any other flow, or the code for the other number, hashes to a
 * different destination and can never satisfy this one. The same pattern as `staffInvitationOtpDestinationHash`.
 */
export const PHONE_CHANGE_OTP_DOMAIN = 'identity:phone-change:otp';

export type PhoneChangeEnd = 'CURRENT' | 'NEW';

export const phoneChangeDestinationHash = (
  hasher: HmacHasher,
  input: { userId: string; pendingPhoneId: string; end: PhoneChangeEnd },
): Buffer => hasher.hmac(PHONE_CHANGE_OTP_DOMAIN, `${input.userId}:${input.pendingPhoneId}:${input.end}`);
