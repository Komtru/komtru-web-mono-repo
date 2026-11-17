// Moving an account to a new phone number (F-045, screen SP-M05). Your phone number is your Komtru ID, so both numbers are
// proven and the old one is told.
import type { HmacHasher } from '../../../platform/crypto/hmac.js';

/**
 * The two codes of a change are `SENSITIVE_ACTION` challenges, like a step-up and a staff acceptance, and are told apart
 * from those (and from each other) by the destination they are issued against: a hash bound to ONE number and to which end of
 * the move the code is for. A code from any other flow, or the code for the other number, hashes to a different destination
 * and can never satisfy this one. The same pattern as `staffInvitationOtpDestinationHash`.
 *
 * Keyed on the NUMBER and not on the pending row, so the per-destination send budget (3 in ten minutes, 10 a day, §S4) counts
 * every code sent to that number however many times a change is started: a key that was new on every start made the budget
 * unreachable, and a stranger's number could be sent codes without limit. The challenge's own `user_id` (checked by
 * the service) is what ties a code to one account.
 */
export const PHONE_CHANGE_OTP_DOMAIN = 'identity:phone-change:otp';

export type PhoneChangeEnd = 'CURRENT' | 'NEW';

export const phoneChangeDestinationHash = (
  hasher: HmacHasher,
  input: { phoneE164: string; end: PhoneChangeEnd },
): Buffer => hasher.hmac(PHONE_CHANGE_OTP_DOMAIN, `${input.phoneE164}:${input.end}`);

/**
 * How long after a completed change a new one is refused. The notice to the old number is addressed by the retired row, and
 * a second completed change replaces that row, so a chain of changes inside the window of the notices still waiting to be
 * sent would aim the alarm for the first change at the second change's old number. In a takeover that number is the
 * taker's own. The window outlasts the queue and its retries; it is also a pause in which the real owner can notice and act.
 */
export const PHONE_CHANGE_COOLDOWN_MS = 15 * 60 * 1000;
