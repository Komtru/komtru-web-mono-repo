// M6 §6.3: what survives a NIN or BVN check.
//
// D1 in three columns: a masked display value, a keyed HMAC for the duplicate check, and the
// provider's reference. The number itself is held in memory for the length of one provider call and
// then dropped. If a compliance request ever needs the real one, it is retrieved from the provider's
// records through `provider_reference` — it costs nothing to not store something.
import { sql } from 'drizzle-orm';
import { boolean, customType, index, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { kycProvider } from './enums.js';
import { verificationRequests } from './requests.js';

/** `bytea`, as a Buffer. drizzle's own `bytea` landed after 0.45; this is the one-liner it needs. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const ninVerifications = trust.table(
  'nin_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    /** `*******8901` — display and support use only. */
    ninMasked: text('nin_masked').notNull(),
    /** HMAC-SHA256 under the platform pepper, domain-separated from the BVN one (D1). */
    ninHash: bytea('nin_hash').notNull(),
    nameMatchScore: numeric('name_match_score', { precision: 5, scale: 2 }),
    dobMatch: boolean('dob_match'),
    provider: kycProvider('provider').notNull(),
    providerReference: text('provider_reference').notNull(),
    /** Null until the check passes. The uniqueness rule below keys on exactly that. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * D2's backstop: a NIN that has passed can back at most one account.
     *
     * Partial on `verified_at`, so a rejected or still-pending attempt against the same number — by
     * this user or another — does not collide. The flow around it is §7's: the second claimant is
     * neither auto-approved nor auto-rejected, they go to a human.
     */
    uniqueIndex('nin_verifications_hash_active_unique')
      .on(table.ninHash)
      .where(sql`${table.verifiedAt} IS NOT NULL`),
    index('nin_verifications_user_idx').on(table.userId),
  ],
);

export const bvnVerifications = trust.table(
  'bvn_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    bvnMasked: text('bvn_masked').notNull(),
    bvnHash: bytea('bvn_hash').notNull(),
    nameMatchScore: numeric('name_match_score', { precision: 5, scale: 2 }),
    /** The BVN-registered phone against M1's verified one. */
    phoneMatch: boolean('phone_match'),
    provider: kycProvider('provider').notNull(),
    providerReference: text('provider_reference').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bvn_verifications_hash_active_unique')
      .on(table.bvnHash)
      .where(sql`${table.verifiedAt} IS NOT NULL`),
    index('bvn_verifications_user_idx').on(table.userId),
  ],
);

export type NinVerification = typeof ninVerifications.$inferSelect;
export type BvnVerification = typeof bvnVerifications.$inferSelect;
