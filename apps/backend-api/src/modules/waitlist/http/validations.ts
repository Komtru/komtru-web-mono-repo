import { z } from 'zod';
import { WAITLIST_INTENTS } from '../domain/contact.js';

/**
 * What the marketing site posts.
 *
 * `city` is a bounded string rather than an enum: the form offers five options and one of them is
 * "Other", and the list will grow with the launch cities faster than a deployed enum would.
 */
export const signupBody = z.strictObject({
  name: z.string().min(1).max(120),
  contact: z.string().min(1).max(254),
  intent: z.enum(WAITLIST_INTENTS),
  city: z.string().min(1).max(80),
});

/**
 * What comes back: an identifier and a timestamp, and nothing that was sent in.
 *
 * A public, unauthenticated endpoint must not echo a contact detail — it would turn a signup form
 * into an oracle that confirms an address back to whoever typed it.
 */
export const signupResponse = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
