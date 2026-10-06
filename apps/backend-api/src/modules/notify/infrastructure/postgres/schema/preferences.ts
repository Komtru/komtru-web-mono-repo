// M11 §4.4. What a user may turn off, and the per-user cap that stops one noisy event stream.
import { boolean, integer, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { notify } from './columns.js';
import { notificationCategory, notificationChannel } from './enums.js';

/**
 * Absent means opted in (M11 §4.4's default). A `SECURITY` row is never written: the pipeline would
 * ignore it, and storing a preference that is ignored is a lie told to the user — `PUT
 * /notification-preferences` rejects it instead.
 */
export const notificationPreferences = notify.table(
  'notification_preferences',
  {
    userId: uuid('user_id').notNull(),
    category: notificationCategory('category').notNull(),
    channel: notificationChannel('channel').notNull(),
    optedIn: boolean('opted_in').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.category, table.channel] })],
);

/**
 * A fixed window per user and channel. In Postgres rather than Redis so the count moves in the same
 * transaction as the notification row it admitted: a handler that rolls back un-charges itself, and
 * a redelivery that finds the row already there does not charge twice.
 */
export const notificationRateLimits = notify.table(
  'notification_rate_limits',
  {
    userId: uuid('user_id').notNull(),
    channel: notificationChannel('channel').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    sendCount: integer('send_count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.channel, table.windowStartedAt] })],
);
