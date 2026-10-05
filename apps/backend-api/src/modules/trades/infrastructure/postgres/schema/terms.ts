// Every proposal and counter-proposal is a new immutable version (HTML W2, BR1). Nothing here is
// ever updated except `superseded_at`: a trade's history of what was offered is the evidence a
// dispute is decided on, so a counter-proposal adds a row rather than editing one.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { trade } from './columns.js';
import { tradeInitiatorRole } from './enums.js';
import { trades } from './trades.js';

/** Design §7.8: an address snapshot carries everything a courier and a Park hub need. */
const ADDRESS_KEYS = sql`?& array['street', 'landmark', 'recipient', 'state_id', 'city_id']`;

export const tradeTermsVersions = trade.table(
  'trade_terms_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    /** 1 for the opening proposal, then one per counter-proposal. */
    versionNumber: integer('version_number').notNull(),
    proposedByUserId: uuid('proposed_by_user_id').notNull(),
    proposedByRole: tradeInitiatorRole('proposed_by_role').notNull(),

    /** The item price in kobo, before any fee. Fees are computed from this at acceptance (§6.5). */
    itemAmountMinor: bigint('item_amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('NGN'),
    /** The category's required item-spec fields (T-049), validated by the service, stored whole. */
    itemSpec: jsonb('item_spec').notNull(),

    inspectionWindowHours: integer('inspection_window_hours').notNull(),
    deliveryGraceHours: integer('delivery_grace_hours').notNull(),

    /** Snapshots, not pointers: an address edited later must not restate an agreed trade. */
    deliveryAddress: jsonb('delivery_address').notNull(),
    shipsFromAddress: jsonb('ships_from_address').notNull(),

    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('trade_terms_amount_positive', sql`${table.itemAmountMinor} > 0`),
    check('trade_terms_currency', sql`${table.currency} = 'NGN'`),
    check(
      'trade_terms_window_positive',
      sql`${table.inspectionWindowHours} > 0 AND ${table.deliveryGraceHours} > 0`,
    ),
    check('trade_terms_delivery_address_shape', sql`${table.deliveryAddress} ${ADDRESS_KEYS}`),
    check('trade_terms_ships_from_address_shape', sql`${table.shipsFromAddress} ${ADDRESS_KEYS}`),
    // The turn-flipping guard: two counter-proposals racing cannot both become version N, so the
    // loser retries against the version it has actually seen rather than silently overwriting.
    uniqueIndex('trade_terms_versions_trade_version').on(table.tradeId, table.versionNumber),
    // Backs the composite foreign keys in migration 0020 (a trade may only pin its own version).
    uniqueIndex('trade_terms_versions_id_trade').on(table.id, table.tradeId),
    index('trade_terms_versions_trade_idx').on(table.tradeId, table.versionNumber.desc().nullsFirst()),
  ],
);
