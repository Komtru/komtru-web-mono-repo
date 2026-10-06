// M6 §6.4. Liveness is not optional at level 2 whichever identifier was used (§4): a matched NIN
// with no liveness check proves someone typed a valid number, not that they are the person behind it.
import { boolean, index, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { kycProvider, verificationType } from './enums.js';
import { verificationRequests } from './requests.js';

export const livenessChecks = trust.table(
  'liveness_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    /** Which identity document the selfie was matched to — 'NIN' or 'BVN' in this ticket. */
    matchedAgainst: verificationType('matched_against').notNull(),
    matchScore: numeric('match_score', { precision: 5, scale: 2 }).notNull(),
    livenessPassed: boolean('liveness_passed').notNull(),
    /** Soft reference to files.file_records(id) (M20, D5): this module never holds bytes. */
    selfieStorageRef: uuid('selfie_storage_ref'),
    provider: kycProvider('provider').notNull(),
    providerReference: text('provider_reference').notNull(),
    failureReason: text('failure_reason'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('liveness_checks_user_idx').on(table.userId)],
);

export type LivenessCheck = typeof livenessChecks.$inferSelect;
