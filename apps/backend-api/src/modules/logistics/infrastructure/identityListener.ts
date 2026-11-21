// m2 §2 REVISED: a pending invitation materialises when its invitee proves the address. The two
// identity events carry only ids, so the proven address is read back from identity's own tables
// (through its barrel), VERIFIED rows only, in the subscriber's transaction.
import { and, eq, isNotNull } from 'drizzle-orm';
import type { EventBus } from '../../../platform/events/bus.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import {
  identityEmailVerifiedEvent,
  identityPhoneVerifiedEvent,
  userEmails,
  userPhones,
} from '../../identity/index.js';
import { materialiseInvitations } from '../services/invitation.service.js';

export const EMAIL_VERIFIED_SUBSCRIBER = 'logistics.on-email-verified';
export const PHONE_VERIFIED_SUBSCRIBER = 'logistics.on-phone-verified';

export function subscribeToIdentity(events: EventBus, hasher: () => HmacHasher): void {
  events.subscribe({
    name: EMAIL_VERIFIED_SUBSCRIBER,
    event: identityEmailVerifiedEvent,
    handler: async ({ payload }, tx) => {
      const email = (
        await tx
          .select({ canonical: userEmails.emailNormal })
          .from(userEmails)
          .where(
            and(
              eq(userEmails.id, payload.emailId),
              eq(userEmails.userId, payload.userId),
              isNotNull(userEmails.verifiedAt),
            ),
          )
      )[0];
      if (!email) return;
      await materialiseInvitations(tx, hasher(), {
        userId: payload.userId,
        channel: 'EMAIL',
        canonical: email.canonical,
      });
    },
  });

  events.subscribe({
    name: PHONE_VERIFIED_SUBSCRIBER,
    event: identityPhoneVerifiedEvent,
    handler: async ({ payload }, tx) => {
      const phone = (
        await tx
          .select({ canonical: userPhones.phoneE164 })
          .from(userPhones)
          .where(
            and(
              eq(userPhones.id, payload.phoneId),
              eq(userPhones.userId, payload.userId),
              isNotNull(userPhones.verifiedAt),
            ),
          )
      )[0];
      if (!phone) return;
      await materialiseInvitations(tx, hasher(), {
        userId: payload.userId,
        channel: 'PHONE',
        canonical: phone.canonical,
      });
    },
  });
}
