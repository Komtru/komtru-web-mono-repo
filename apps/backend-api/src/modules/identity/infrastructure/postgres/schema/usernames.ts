// M1 §5.9. A handle carries trust by association, so a released one is quarantined rather than
// returned to the pool — otherwise an attacker inherits the reputation of the account that left it.
import { sql } from 'drizzle-orm';
import { boolean, index, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext, identity } from './columns.js';
import { users } from './users.js';

export const usernameHistory = identity.table(
  'username_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: citext('username').notNull(),
    usernameSkeleton: text('username_skeleton').notNull(),
    skeletonVersion: smallint('skeleton_version').notNull().default(1),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    /** Unclaimable by anyone for 90 days, reclaimable by the original owner for 30 (M1 §6.4). */
    quarantineUntil: timestamp('quarantine_until', { withTimezone: true }),
    changedBy: uuid('changed_by').references(() => users.id),
    reason: text('reason'),
  },
  (table) => [
    index('username_history_user_idx').on(table.userId),
    index('username_history_quarantine_idx')
      .on(table.usernameSkeleton)
      .where(sql`${table.quarantineUntil} IS NOT NULL`),
  ],
);

/** Keyed on the skeleton, so reserving `admin` also reserves `adm1n` and `a.d.m.i.n` (M1 §6.3). */
export const reservedUsernames = identity.table('reserved_usernames', {
  usernameSkeleton: text('username_skeleton').primaryKey(),
  /** BRAND | SYSTEM | ROLE | OFFENSIVE | PARTNER. */
  category: text('category').notNull(),
  note: text('note'),
  releasable: boolean('releasable').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
