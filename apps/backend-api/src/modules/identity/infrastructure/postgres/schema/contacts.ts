// M1 §5.4. A verified email or phone proves control of a channel, so at most one account may hold a
// verified claim on each — enforced by partial unique indexes, never by a service reading first.
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, identity } from './columns.js';
import { users } from './users.js';

export const userEmails = identity.table(
  'user_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** What the user typed, lowercased. This is what we display and what we send to. */
    email: citext('email').notNull(),
    /**
     * Provider-normalised (gmail dot and plus folding) for duplicate detection only, produced by
     * `normaliseEmail()` in platform/identifiers.ts. The database cannot recompute it, so a caller
     * that writes an unnormalised value defeats the index below: that is the one rule T-032 owes.
     */
    emailNormal: citext('email_normal').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationSource: text('verification_source'),
    bounceCount: integer('bounce_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // On the NORMALISED form: otherwise j.ane@gmail.com and jane@gmail.com verify onto two accounts
    // and both users genuinely control the inbox, which is the problem.
    uniqueIndex('user_emails_verified_unique')
      .on(table.emailNormal)
      .where(sql`${table.verifiedAt} IS NOT NULL`),
    uniqueIndex('user_emails_one_primary')
      .on(table.userId)
      .where(sql`${table.isPrimary}`),
    index('user_emails_user_idx').on(table.userId),
    index('user_emails_email_idx').on(table.email),
    // Composite key so users.primary_email_id can be constrained to the same user (migration 0007).
    uniqueIndex('user_emails_id_user').on(table.id, table.userId),
  ],
);

export const userPhones = identity.table(
  'user_phones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** E.164 only, as produced by `normalisePhone()` in platform/identifiers.ts. */
    phoneE164: text('phone_e164').notNull(),
    countryCode: text('country_code').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** Forces re-verification of a stale number: SIM recycling in Nigeria is real (M1 D4). */
    reverifyAfter: timestamp('reverify_after', { withTimezone: true }),
    carrier: text('carrier'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('phone_e164_format', sql`${table.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    uniqueIndex('user_phones_verified_unique')
      .on(table.phoneE164)
      .where(sql`${table.verifiedAt} IS NOT NULL`),
    uniqueIndex('user_phones_one_primary')
      .on(table.userId)
      .where(sql`${table.isPrimary}`),
    index('user_phones_user_idx').on(table.userId),
    uniqueIndex('user_phones_id_user').on(table.id, table.userId),
  ],
);
