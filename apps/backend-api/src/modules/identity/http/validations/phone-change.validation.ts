// Request and response shapes for the phone-number change (F-045, screen SP-M05).
import { z } from 'zod';

const code = z.string().trim().min(1).max(64);
const handle = { changeId: z.uuid(), challengeId: z.uuid(), code };

export const startPhoneChangeBody = z.strictObject({
  /** As people write it: `0905 118 2290` or `+234 905 118 2290`. The platform makes it canonical. */
  newPhone: z.string().trim().min(5).max(32),
});

export const startPhoneChangeResponse = z.object({
  /** The handle the next two steps carry. */
  changeId: z.uuid(),
  challengeId: z.uuid(),
  /** The CURRENT number, masked: where the first code went. */
  maskedDestination: z.string(),
  expiresAt: z.iso.datetime(),
  /** False when the send budget for that number was spent, so nothing was sent. */
  delivered: z.boolean(),
});

export const confirmCurrentPhoneBody = z.strictObject(handle);

export const confirmCurrentPhoneResponse = z.object({
  challengeId: z.uuid(),
  /** The NEW number, masked: where the second code went. */
  maskedDestination: z.string(),
  expiresAt: z.iso.datetime(),
  delivered: z.boolean(),
});

export const confirmNewPhoneBody = z.strictObject(handle);

export const confirmNewPhoneResponse = z.object({
  status: z.literal('CHANGED'),
  maskedPhone: z.string(),
});
