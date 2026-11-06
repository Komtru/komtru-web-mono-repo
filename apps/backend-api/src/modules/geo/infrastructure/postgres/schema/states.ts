import { text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { geo } from './columns.js';

/** Nigeria's 36 states and the FCT, seeded. Never deleted. */
export const states = geo.table(
  'states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** ISO 3166-2:NG suffix: `LA`, `FC`. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    normalisedName: text('normalised_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('states_code_unique').on(table.code),
    uniqueIndex('states_normalised_name_unique').on(table.normalisedName),
  ],
);
