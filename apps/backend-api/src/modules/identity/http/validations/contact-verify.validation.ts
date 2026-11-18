// F-081's bodies. One pair per channel, because an email and a phone are not the same shape and a
// single `address` field wide enough for both would accept a 254-character "phone number".
import { z } from 'zod';

/** Optional on purpose: absent means "the address already on file"; present replaces an unproven one. */
const emailAddress = z.string().trim().min(3).max(254);
/** The bound `startPhoneChange` uses, so the two ways into a phone number agree. */
const phoneAddress = z.string().trim().min(5).max(32);

export const startEmailVerificationBody = z.strictObject({ address: emailAddress.optional() });
export const startPhoneVerificationBody = z.strictObject({ address: phoneAddress.optional() });

export const startContactVerificationResponse = z.object({
  challengeId: z.uuid(),
  /** Where the code went, masked. The caller already knows the address; the wire need not carry it. */
  maskedDestination: z.string(),
  expiresAt: z.iso.datetime(),
  /** False when the per-destination send budget was spent, so nothing was sent. */
  delivered: z.boolean(),
});

export const confirmContactVerificationBody = z.strictObject({
  challengeId: z.uuid(),
  code: z.string().trim().min(1).max(64),
});

export const confirmContactVerificationResponse = z.object({
  status: z.literal('VERIFIED'),
  /** `CONTACT_VERIFIED` once BOTH channels are proven; otherwise unchanged. */
  verificationLevel: z.string(),
  maskedDestination: z.string(),
});
