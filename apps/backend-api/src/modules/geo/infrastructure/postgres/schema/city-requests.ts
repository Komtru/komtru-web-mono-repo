import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { cities } from './cities.js';
import { geo } from './columns.js';
import { states } from './states.js';

/** "My city isn't listed": a state and the name the user typed, for staff to add, merge or reject. */
export const cityRequests = geo.table(
  'city_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft reference to identity.users(id): cross-schema references are plain uuid (design 4.2). */
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id),
    /** Exactly as typed (trimmed). */
    cityName: text('city_name').notNull(),
    normalisedName: text('normalised_name').notNull(),
    status: text('status').notNull().default('PENDING'),
    /** The catalog city the request became (`ADDED`) or was folded into (`MERGED`). */
    resolvedCityId: uuid('resolved_city_id').references(() => cities.id),
    /** Soft reference to identity.users(id). */
    decidedByAdminId: uuid('decided_by_admin_id'),
    decisionReason: text('decision_reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('city_requests_status', sql`${table.status} IN ('PENDING', 'ADDED', 'MERGED', 'REJECTED')`),
    // A decision is whole or absent: who, when, and for ADDED/MERGED which city, for REJECTED why.
    check(
      'city_requests_decision_shape',
      sql`(${table.status} = 'PENDING' AND ${table.decidedAt} IS NULL AND ${table.decidedByAdminId} IS NULL AND ${table.resolvedCityId} IS NULL)
        OR (${table.status} IN ('ADDED', 'MERGED') AND ${table.decidedAt} IS NOT NULL AND ${table.decidedByAdminId} IS NOT NULL AND ${table.resolvedCityId} IS NOT NULL)
        OR (${table.status} = 'REJECTED' AND ${table.decidedAt} IS NOT NULL AND ${table.decidedByAdminId} IS NOT NULL AND ${table.decisionReason} IS NOT NULL)`,
    ),
    // A double tap is one request.
    uniqueIndex('city_requests_pending_per_user')
      .on(table.requestedByUserId, table.stateId, table.normalisedName)
      .where(sql`${table.status} = 'PENDING'`),
    index('city_requests_queue_idx').on(table.status, table.createdAt, table.id),
    index('city_requests_group_idx').on(table.stateId, table.normalisedName),
  ],
);
