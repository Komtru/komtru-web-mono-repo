// M6 §6.2: the umbrella record. Every check — NIN, BVN, liveness, and T-051's four — hangs off one
// of these, because D4 makes verification a lifecycle rather than a request/response call.
import { sql } from 'drizzle-orm';
import { check, index, integer, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { kycProvider, verificationRequestStatus, verificationType } from './enums.js';

export const verificationRequests = trust.table(
  'verification_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Soft reference to identity.users(id): cross-schema references are plain uuid (§6.2's note). */
    userId: uuid('user_id').notNull(),
    verificationType: verificationType('verification_type').notNull(),
    status: verificationRequestStatus('status').notNull().default('SUBMITTED'),
    provider: kycProvider('provider'),
    /** The provider's own call id — D1's retrieval key, so a dispute never needs us to hold the number. */
    providerReference: text('provider_reference'),
    /** Which of levels 2/3/4 this contributes to (§6.2). */
    targetLevel: smallint('target_level').notNull(),
    /**
     * How many times this user has submitted this check. M6 §9 auto-opens a support ticket after two
     * rejections in 30 days (T-100 consumes it); a count nobody maintains cannot answer that.
     */
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Soft reference to a files.file_records(id) for a liveness selfie (M20, D5). */
    selfieStorageRef: uuid('selfie_storage_ref'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    providerCalledAt: timestamp('provider_called_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** §6.2: an unresolved request must not hang forever. The sweep reads this. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rejectionReason: text('rejection_reason'),
    /** Provider-specific, non-sensitive fields only. Never a raw NIN or BVN (D1). */
    metadata: text('metadata'),
  },
  (table) => [
    index('verification_requests_user_idx').on(table.userId),
    index('verification_requests_status_idx')
      .on(table.status)
      .where(sql`${table.status} IN ('PROVIDER_PENDING', 'MANUAL_REVIEW')`),
    index('verification_requests_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} NOT IN ('APPROVED', 'REJECTED', 'EXPIRED')`),
    /**
     * One in-flight check of a kind per user, enforced by the database rather than by a read.
     *
     * A read-then-insert guard loses exactly the race it is written for: two taps on a slow
     * connection each read "nothing in flight" and each spend a provider call, which is real money
     * and, for the user, two conflicting answers about the same number.
     */
    uniqueIndex('verification_requests_one_in_flight')
      .on(table.userId, table.verificationType)
      .where(sql`${table.status} IN ('SUBMITTED', 'PROVIDER_PENDING', 'MANUAL_REVIEW')`),
    // M6 §4: this module owns levels 2 to 4 and nothing below. A request claiming to contribute to
    // level 1 is identity's business and should never have reached this table.
    check('verification_requests_target_level', sql`${table.targetLevel} BETWEEN 2 AND 4`),
  ],
);

export type VerificationRequest = typeof verificationRequests.$inferSelect;
