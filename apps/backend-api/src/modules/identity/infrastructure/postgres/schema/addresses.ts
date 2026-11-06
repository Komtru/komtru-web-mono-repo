// T-042. A buyer's saved delivery addresses.
//
// `state_id` and `city_id` are SOFT references into the geo catalog (T-046): no foreign key crosses
// the schema boundary, the same way `geo.city_requests.requested_by_user_id` points at a user without
// one. The service proves the city belongs to the state and is active when an address is written; a
// city staff deactivate later leaves the address readable, flagged unusable for a new trade.
//
// An address is archived, never deleted: a trade snapshots the address it ships to, and support has to
// be able to read what a buyer had on file. The delete trigger and the revoked DELETE grant (migration
// 0038) hold that line for every writer, this module's code included.
//
// Phone, street and landmark are PII (M1 §12). They live here and nowhere else: not in events, not in
// audit metadata, not in logs.
import { sql } from 'drizzle-orm';
import { boolean, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { identity } from './columns.js';
import { users } from './users.js';

export const userAddresses = identity.table(
  'user_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** "Home", "Shop": the owner's own name for it. */
    label: text('label').notNull(),
    recipientName: text('recipient_name').notNull(),
    /** E.164, from `normalisePhone()` in platform/identifiers.ts. */
    recipientPhone: text('recipient_phone').notNull(),
    streetLine: text('street_line').notNull(),
    landmark: text('landmark'),
    /** Soft reference to `geo.states.id`. */
    stateId: uuid('state_id').notNull(),
    /** Soft reference to `geo.cities.id`, which belongs to `state_id` (checked by the service). */
    cityId: uuid('city_id').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One default per user, enforced here because a read-then-write races.
    uniqueIndex('user_addresses_one_default')
      .on(table.userId)
      .where(sql`${table.isDefault}`),
    // The list: a user's live addresses, default first then newest. nullsFirst() because a plain
    // `ORDER BY x DESC` is DESC NULLS FIRST and an index built NULLS LAST cannot serve it.
    index('user_addresses_live_idx')
      .on(
        table.userId,
        table.isDefault.desc().nullsFirst(),
        table.createdAt.desc().nullsFirst(),
        table.id.desc().nullsFirst(),
      )
      .where(sql`${table.archivedAt} IS NULL`),
    check('user_addresses_phone_e164', sql`${table.recipientPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'user_addresses_default_is_live',
      sql`NOT (${table.isDefault} AND ${table.archivedAt} IS NOT NULL)`,
    ),
    check(
      'user_addresses_text_not_blank',
      sql`length(btrim(${table.label})) > 0 AND length(btrim(${table.recipientName})) > 0 AND length(btrim(${table.streetLine})) > 0`,
    ),
  ],
);
