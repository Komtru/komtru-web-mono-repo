// What a user may turn off (M11 §4.4, NP1).
//
// SECURITY is not one of them. M11 D2 makes a security-critical message bypass preferences
// entirely, so a stored `SECURITY` opt-out would be a setting the pipeline ignores — a lie told to
// the user, and the kind that is only discovered when somebody's account is taken over and they say
// "I turned those off". `setPreferences` refuses it instead, and the route turns that into a 422.
import { eq, sql } from 'drizzle-orm';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from '@komtru/shared-types';
import type { Db } from '../../../db/index.js';
import { notificationPreferences } from '../infrastructure/postgres/schema/index.js';

/** The categories a user may actually change. */
export const OPTIONAL_CATEGORIES = NOTIFICATION_CATEGORIES.filter((category) => category !== 'SECURITY');

/** Channels a preference is meaningful on. IN_APP is the durable record, so it is never opted out. */
export const PREFERENCE_CHANNELS = NOTIFICATION_CHANNELS.filter((channel) => channel !== 'IN_APP');

export interface PreferenceRow {
  category: NotificationCategory;
  channel: NotificationChannel;
  optedIn: boolean;
}

export class SecurityPreferenceError extends Error {
  constructor() {
    super('notify: SECURITY notifications cannot be turned off');
    this.name = 'SecurityPreferenceError';
  }
}

/** Every changeable pair with its effective value, so a client never has to know the defaults. */
export async function getPreferences(db: Db, userId: string): Promise<PreferenceRow[]> {
  const stored = await db
    .select({
      category: notificationPreferences.category,
      channel: notificationPreferences.channel,
      optedIn: notificationPreferences.optedIn,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  const byPair = new Map(stored.map((row) => [`${row.category}|${row.channel}`, row.optedIn]));
  return OPTIONAL_CATEGORIES.flatMap((category) =>
    PREFERENCE_CHANNELS.map((channel) => ({
      category,
      channel,
      // Absent means opted in (M11 §4.4's default).
      optedIn: byPair.get(`${category}|${channel}`) ?? true,
    })),
  );
}

export async function setPreferences(db: Db, userId: string, changes: PreferenceRow[]): Promise<void> {
  if (changes.some((change) => change.category === 'SECURITY')) throw new SecurityPreferenceError();
  if (!changes.length) return;

  await db
    .insert(notificationPreferences)
    .values(changes.map((change) => ({ userId, ...change })))
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      // `excluded` is the row this INSERT would have written: one statement for a create and an
      // update, so two tabs saving at once cannot lose one another's change silently.
      set: { optedIn: sql`excluded.opted_in`, updatedAt: new Date() },
    });
}
