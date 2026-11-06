import { sql } from 'drizzle-orm';
import { boolean, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { geo } from './columns.js';
import { states } from './states.js';

/**
 * A city belongs to one state. It is deactivated, never deleted: addresses, hubs and trades hold its
 * id, and a deactivated city must stay readable on them.
 */
export const cities = geo.table(
  'cities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id),
    /** As staff wrote it, and as a dropdown shows it. */
    name: text('name').notNull(),
    /** `normaliseCityName(name)`: what uniqueness and the typeahead compare. */
    normalisedName: text('normalised_name').notNull(),
    /** Normalised search keys: other spellings and nicknames, matched by prefix, never shown. */
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean('active').notNull().default(true),
    /** Set only by the seed. Stable across a rename, so the seed never re-adds a city it already added. */
    seedKey: text('seed_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The same city cannot be added twice, whatever its capitalisation, accents or hyphens.
    uniqueIndex('cities_state_normalised_name_unique').on(table.stateId, table.normalisedName),
    uniqueIndex('cities_seed_key_unique').on(table.seedKey),
    // Typeahead is a prefix match across states.
    index('cities_normalised_name_prefix_idx').using('btree', table.normalisedName.op('text_pattern_ops')),
    check('cities_normalised_name_not_blank', sql`length(${table.normalisedName}) > 0`),
  ],
);
