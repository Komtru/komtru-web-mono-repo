// M1 §11. Identity's domain events, declared once so publisher and subscriber share a schema.
//
// Only the username events are here; T-031, T-032, T-034 and T-039 add theirs beside them.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';

/** First claim of a handle. Search indexes it; analytics counts it as onboarding completed. */
export const usernameClaimedEvent = defineEvent(
  'identity.username.claimed',
  1,
  z.object({
    userId: z.uuid(),
    username: z.string().min(3).max(30),
  }),
);

/**
 * A handle moved. `from` is carried in the payload because the consumers that matter — search,
 * notifications, trades — need to know what to retire, and M1 §6.4's snapshot rule means nobody may
 * resolve a historical handle at read time to find out.
 */
export const usernameChangedEvent = defineEvent(
  'identity.username.changed',
  1,
  z.object({
    userId: z.uuid(),
    from: z.string().min(3).max(30),
    to: z.string().min(3).max(30),
    reason: z.string().min(1),
    /** True when staff forced it (T-037's `username.force_change`), not the user. */
    forced: z.boolean().default(false),
  }),
);
