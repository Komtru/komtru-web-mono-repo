// M6 §6.7: the record that one identifier is claimed by two accounts, and what a person decided about it.
//
// `request_id` is this build's addition to the spec's columns. It links the flag to the verification
// request parked in MANUAL_REVIEW (which is what the reviewer decides) and its unique index is what
// makes a redelivered job unable to write the same flag twice.
import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { duplicateFlagStatus, verificationType } from './enums.js';
import { bytea } from './identity-checks.js';
import { verificationRequests } from './requests.js';

export const duplicateIdentityFlags = trust.table(
  'duplicate_identity_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `NIN`, `BVN` or `CAC`. */
    identifierType: verificationType('identifier_type').notNull(),
    /** The keyed HMAC (domain-separated per type); never the identifier itself (D1). */
    identifierHash: bytea('identifier_hash').notNull(),
    /** The account that verified it first. */
    firstUserId: uuid('first_user_id').notNull(),
    /** The account that tried to verify the same identifier. */
    conflictingUserId: uuid('conflicting_user_id').notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'cascade' }),
    status: duplicateFlagStatus('status').notNull().default('OPEN'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolutionNotes: text('resolution_notes'),
  },
  (table) => [
    check('duplicate_flags_distinct_users', sql`${table.firstUserId} <> ${table.conflictingUserId}`),
    uniqueIndex('duplicate_identity_flags_request_unique').on(table.requestId),
    index('duplicate_identity_flags_status_idx')
      .on(table.status)
      .where(sql`${table.status} IN ('OPEN', 'ESCALATED')`),
    index('duplicate_identity_flags_hash_idx').on(table.identifierHash),
  ],
);

export type DuplicateIdentityFlag = typeof duplicateIdentityFlags.$inferSelect;
