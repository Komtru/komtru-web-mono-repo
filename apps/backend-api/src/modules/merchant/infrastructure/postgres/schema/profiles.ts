import { sql } from 'drizzle-orm';
import { check, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { merchant } from './columns.js';
import { badgeType, businessType, certificationStatus } from './enums.js';

/**
 * The storefront layer on top of an identity (M5 section 3.2): one row per certified merchant, created in
 * the approval transaction. `certified_at` is when certification first took effect; ending it (suspend
 * or revoke) moves `certification_status` and stamps `certification_ended_at`, and never deletes the row.
 */
export const merchantProfiles = merchant.table(
  'merchant_profiles',
  {
    /** Soft reference to identity.users(id). */
    userId: uuid('user_id').primaryKey(),
    /** Soft reference to the application that earned it. */
    applicationId: uuid('application_id').notNull(),
    businessName: text('business_name').notNull(),
    businessType: businessType('business_type').notNull(),
    storefrontSlug: text('storefront_slug').notNull(),
    bio: text('bio'),
    certificationStatus: certificationStatus('certification_status').notNull().default('CERTIFIED'),
    certifiedAt: timestamp('certified_at', { withTimezone: true }).notNull(),
    certificationEndedAt: timestamp('certification_ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('merchant_profiles_slug_unique').on(table.storefrontSlug),
    check('merchant_profiles_slug_shape', sql`${table.storefrontSlug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'merchant_profiles_ended_together',
      sql`(${table.certificationStatus} = 'CERTIFIED') = (${table.certificationEndedAt} IS NULL)`,
    ),
  ],
);

/** The Verified Merchant badge. One live badge per user; losing certification stamps `revoked_at`. */
export const merchantBadges = merchant.table(
  'merchant_badges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    badge: badgeType('badge').notNull(),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('merchant_badges_one_live')
      .on(table.userId, table.badge)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type MerchantProfile = typeof merchantProfiles.$inferSelect;
export type MerchantBadge = typeof merchantBadges.$inferSelect;
