// m2 §3: a package is a company-handled trade's shipment, and its status history. T-087 writes them;
// T-085 lands the tables. No price, rate or quote column exists here or anywhere in this schema
// (m2 §11): the delivery fee is agreed between seller and company outside Komtru.
import { sql } from 'drizzle-orm';
import { index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { logistics } from './columns.js';
import { logisticsCompanies } from './companies.js';
import { packageStatus } from './enums.js';

export const logisticsPackages = logistics.table(
  'logistics_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft ref to trades.trades. */
    tradeId: uuid('trade_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => logisticsCompanies.id, { onDelete: 'restrict' }),
    /** Soft ref to identity.users: the seller. */
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    /** Soft ref to identity.users: the POC handling it, set on accept or later. */
    assignedOperatorId: uuid('assigned_operator_id'),
    status: packageStatus('status').notNull().default('REQUESTED'),
    trackingNumber: text('tracking_number'),
    rejectionReason: text('rejection_reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    packagedAt: timestamp('packaged_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('logistics_packages_company_status_idx').on(table.companyId, table.status),
    // m2 §6.1: a rejected package is terminal and a retry is a new row, so at most one package per
    // trade may be anything other than REJECTED.
    uniqueIndex('logistics_packages_trade_live_uidx')
      .on(table.tradeId)
      .where(sql`${table.status} <> 'REJECTED'`),
  ],
);

/** Append-only (migration 0057 installs the trigger): one row per transition, never edited. */
export const logisticsPackageStatusEvents = logistics.table(
  'logistics_package_status_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => logisticsPackages.id, { onDelete: 'restrict' }),
    /** Null on the initial REQUESTED row. */
    fromStatus: packageStatus('from_status'),
    toStatus: packageStatus('to_status').notNull(),
    /** Soft ref; null for a system-triggered transition. */
    actorUserId: uuid('actor_user_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('logistics_package_status_events_package_idx').on(table.packageId, table.createdAt)],
);
