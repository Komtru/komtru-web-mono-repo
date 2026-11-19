// The launch waitlist (komtru.com): the people to tell when their city opens.
//
// One flat schema file rather than the `infrastructure/postgres/schema/` folder every larger module
// uses — `drizzle.config.ts` keeps the flat form for exactly this case, a module with one table.
import { sql } from 'drizzle-orm';
import { check, index, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const waitlist = pgSchema('waitlist');

/**
 * One signup from the marketing site.
 *
 * Not a user. Nobody here has an account, a password or a session: this is a name, a way to reach
 * them, and which city to watch. When Komtru opens they are messaged and they sign up normally;
 * nothing in this table becomes an identity, which is why it is its own schema and references
 * nothing in `identity`.
 *
 * `contact` is stored as typed and `contactKey` is the normalised form the unique index is on, so
 * `ADA@Example.com `, `ada@example.com` and `+234 801 234 5678` versus `08012345678` are each one
 * person on the list rather than two.
 */
export const waitlistSignups = waitlist.table(
  'signups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** As typed, trimmed. It is what we greet them by. */
    name: text('name').notNull(),
    /** As typed, trimmed: the address we will actually message. */
    contact: text('contact').notNull(),
    /** Lower-cased for an email; digits only, with the Nigerian trunk prefix resolved, for a phone. */
    contactKey: text('contact_key').notNull(),
    channel: text('channel').notNull(),
    intent: text('intent').notNull(),
    /** A free-text city, not a `geo.cities` reference: the list is five options and one is "Other". */
    city: text('city').notNull(),
    /**
     * Which site the signup came in from, read from the request's `Origin`. One backend serves
     * both the marketing site and the app, so this is what separates the real launch list from
     * test signups. See `domain/source.ts` for why it is a signal rather than a fact.
     */
    source: text('source').notNull().default('UNKNOWN'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('signups_channel', sql`${table.channel} IN ('EMAIL', 'PHONE')`),
    check('signups_intent', sql`${table.intent} IN ('BUY', 'SELL', 'BOTH')`),
    check('signups_source', sql`${table.source} IN ('PROD', 'STAGING', 'PREVIEW', 'LOCAL', 'UNKNOWN')`),
    /*
     * Per source, not per contact.
     *
     * Signing up twice on the same site is one person on the list, and the route answers the
     * second one 409. Across sites it must not be: the team tests the staging form with their own
     * real phone numbers, and a single index on the contact would make every number they test
     * with permanently unable to join the real list — a failure that would show up on launch day
     * as a 409 nobody could explain.
     */
    uniqueIndex('signups_contact_key').on(table.contactKey, table.source),
    // How operations reads it: the real list, newest first, and "how many in Lagos".
    index('signups_city_idx').on(table.source, table.city, table.createdAt),
  ],
);
