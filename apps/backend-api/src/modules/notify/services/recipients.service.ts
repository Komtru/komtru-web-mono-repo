// Where a notification actually goes.
//
// Resolved from identity every time, never copied into notify: an address changes, and a second
// copy of everyone's phone number is a second thing to leak. The notification row keeps only the
// masked form, which is what support needs and what an attacker cannot use.
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { NotificationChannel } from '@komtru/shared-types';
import { devices, userEmails, userPhones, users } from '../../identity/index.js';
import { maskEmail, maskPhone } from '../../../platform/identifiers.js';
import type { Db } from '../../../db/index.js';
import type { Tx } from '../../../platform/events/publish.js';

/** Either pool or transaction: dispatch resolves inside the handler's tx, the job on its own. */
type Reader = Db | Tx;

export interface Destination {
  /** An email address, an E.164 phone, or the push tokens of the user's active devices. */
  address: string[];
  /** `j•••@gmail.com`, `+23480•••5678`, `devices:2`. Safe to log and to store. */
  masked: string;
}

/** Channels that address a phone number. */
const PHONE_CHANNELS: readonly NotificationChannel[] = ['SMS', 'WHATSAPP', 'VOICE'];

export interface DestinationOptions {
  /**
   * Fall back to an unverified contact when the user has NO verified one on this channel.
   *
   * It is a fallback and not a preference, and that distinction is the whole safety argument. A
   * registration OTP has to reach an address nobody has proven yet — it is the thing that proves it
   * — so "nothing verified exists" must resolve to the unverified primary. But a user who already
   * has a verified address and later adds an unverified one must still receive their PASSWORD RESET
   * at the proven address: preferring the primary would send a recovery code to an address the
   * account holder never confirmed, which is the failure the verified-only filter exists to stop.
   *
   * `allowsUnverifiedDestination` in domain/binding.ts is the only thing that sets it. Dispatch and
   * the send job both derive it from `templateKey`, a column on the notification row, so the two
   * cannot disagree — a row QUEUED at dispatch and dead-lettered at send is worse than either
   * answer taken consistently.
   */
  allowUnverified?: boolean;
  /**
   * Which phone a phone channel goes to: the proven one (default), the one being proven, or the one just replaced. Only the
   * phone-change templates set it, and only through `phoneTargetFor` (domain/binding.ts).
   */
  phoneTarget?: 'PRIMARY' | 'PENDING' | 'RETIRED';
}

export async function resolveDestination(
  reader: Reader,
  userId: string,
  channel: NotificationChannel,
  options: DestinationOptions = {},
): Promise<Destination | undefined> {
  // Nowhere to send it and nothing to resolve: the row IS the delivery.
  if (channel === 'IN_APP') return { address: [], masked: 'in-app' };

  if (channel === 'EMAIL') {
    const rows = await reader
      .select({ email: userEmails.email, verifiedAt: userEmails.verifiedAt })
      .from(userEmails)
      .where(
        options.allowUnverified
          ? eq(userEmails.userId, userId)
          : and(
              eq(userEmails.userId, userId),
              eq(userEmails.isPrimary, true),
              isNotNull(userEmails.verifiedAt),
            ),
      )
      // Verified first, primary second. A verified non-primary address beats an unverified primary
      // one: the fallback exists for an account with nothing proven, not to let an unproven address
      // take precedence the moment somebody makes it primary.
      .orderBy(asc(sql`${userEmails.verifiedAt} IS NULL`), asc(sql`NOT ${userEmails.isPrimary}`))
      .limit(1);
    const row = rows[0];
    // Unverified is the same as absent here: sending to an address nobody proved they own is how a
    // password-reset link reaches the wrong person. The one exception is the OTP that MAKES an
    // address verified — demanding verification before sending it is a cycle no user can break.
    if (!row) return undefined;
    return { address: [row.email], masked: maskEmail(row.email) };
  }

  if (
    PHONE_CHANNELS.includes(channel) &&
    options.phoneTarget !== undefined &&
    options.phoneTarget !== 'PRIMARY'
  ) {
    // Addressed by the number's STATED place in a phone change (`user_phones.change_state`), never by what its row looks like:
    // the identity module writes `PENDING` and `RETIRED` only through a change that needs a step-up and both codes, and a
    // partial unique index keeps one of each per user. This branch deliberately does not go through the verified-first rule
    // below, because the number it wants is by definition not the proven one; what stands in for that rule is that
    // `phoneTarget` comes only from `phoneTargetFor`, a code-side map of two template keys, and that the state is not
    // something a session can forge. Anything else that wants an unproven number goes through `allowUnverified`.
    const state = options.phoneTarget === 'PENDING' ? 'PENDING' : 'RETIRED';
    const rows = await reader
      .select({ phone: userPhones.phoneE164 })
      .from(userPhones)
      .where(and(eq(userPhones.userId, userId), eq(userPhones.changeState, state)))
      .limit(1);
    const row = rows[0];
    return row ? { address: [row.phone], masked: maskPhone(row.phone) } : undefined;
  }

  if (PHONE_CHANNELS.includes(channel)) {
    const rows = await reader
      .select({ phone: userPhones.phoneE164, verifiedAt: userPhones.verifiedAt })
      .from(userPhones)
      .where(
        options.allowUnverified
          ? eq(userPhones.userId, userId)
          : and(
              eq(userPhones.userId, userId),
              eq(userPhones.isPrimary, true),
              isNotNull(userPhones.verifiedAt),
            ),
      )
      .orderBy(asc(sql`${userPhones.verifiedAt} IS NULL`), asc(sql`NOT ${userPhones.isPrimary}`))
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    return { address: [row.phone], masked: maskPhone(row.phone) };
  }

  const rows = await reader
    .select({ token: devices.pushToken })
    .from(devices)
    .where(
      and(
        eq(devices.userId, userId),
        isNotNull(devices.pushToken),
        inArray(devices.status, ['ACTIVE', 'TRUSTED']),
      ),
    );
  const tokens = rows.map((row) => row.token).filter((token): token is string => token !== null);
  // A device registry M11 does not own (M1 owns `devices.push_token`); zero devices is an ordinary
  // state for a web-only user, not an error.
  return tokens.length ? { address: tokens, masked: `devices:${String(tokens.length)}` } : undefined;
}

/** The user's locale, for picking a template. Falls back when the user row is gone. */
export async function resolveLocale(reader: Reader, userId: string, fallback: string): Promise<string> {
  const rows = await reader.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.locale ?? fallback;
}

/** Whether the user exists at all; a notification to a deleted user is dropped, not retried. */
export async function userExists(reader: Reader, userId: string): Promise<boolean> {
  const rows = await reader
    .select({ one: sql<number>`1` })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows.length > 0;
}
