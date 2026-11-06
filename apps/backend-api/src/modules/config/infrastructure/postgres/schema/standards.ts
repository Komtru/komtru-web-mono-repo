// T-049: Trade Standards by category. `trade_standards` is append-only (appended to migration 0034):
// a change is a new row with the next version number, so a trade that snapshotted a version id keeps
// reading exactly the standard it was created under.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { config } from './columns.js';

export const tradeCategories = config.table(
  'trade_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('trade_categories_code').on(table.code)],
);

export const tradeStandards = config.table(
  'trade_standards',
  {
    /** The version id a trade stores. */
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => tradeCategories.id),
    versionNumber: integer('version_number').notNull(),
    inspectionWindowHours: integer('inspection_window_hours').notNull(),
    /** `[{ key, label, required }]`, validated by the service. */
    itemSpecFields: jsonb('item_spec_fields').notNull(),
    /** `{ minPhotos, requireVideo }`: what a seller must attach to accept. */
    proofMedia: jsonb('proof_media').notNull(),
    imeiVerification: boolean('imei_verification').notNull(),
    deliveryDeadlineDays: integer('delivery_deadline_days').notNull(),
    /** Null for the seeded first version. */
    changedByAdminId: uuid('changed_by_admin_id'),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trade_standards_category_version').on(table.categoryId, table.versionNumber),
    index('trade_standards_category_idx').on(table.categoryId, sql`${table.versionNumber} DESC`),
    check('trade_standards_version_positive', sql`${table.versionNumber} > 0`),
    check(
      'trade_standards_numbers',
      sql`${table.inspectionWindowHours} > 0 AND ${table.deliveryDeadlineDays} > 0`,
    ),
  ],
);
