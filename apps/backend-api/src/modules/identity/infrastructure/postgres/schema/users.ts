// M1 §5.2–5.3. One users row per person for life: buyer, merchant, logistics and staff are
// capabilities on this row, never separate accounts (M1 §0 rule 1, design C2).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, identity } from './columns.js';
import { userStatus, verificationLevel } from './enums.js';

export const users = identity.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Human-facing stable reference, e.g. `KMT-U-7F3K9Q` (platform/identifiers.ts). Safe to expose. */
    publicId: text('public_id').notNull().unique(),

    /** Nullable: a social sign-up completes before the user picks a handle. */
    username: citext('username').unique(),
    /** Confusable-folded form — the real anti-impersonation guard (M1 §6.3). */
    usernameSkeleton: text('username_skeleton').unique(),
    /** Which version of the skeleton algorithm produced it, so tightening it grandfathers rows. */
    skeletonVersion: smallint('skeleton_version').notNull().default(1),
    usernameSetAt: timestamp('username_set_at', { withTimezone: true }),
    usernameChangeCount: integer('username_change_count').notNull().default(0),

    status: userStatus('status').notNull().default('PENDING_VERIFICATION'),
    statusReason: text('status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),

    verificationLevel: verificationLevel('verification_level').notNull().default('UNVERIFIED'),
    verificationSyncedAt: timestamp('verification_synced_at', { withTimezone: true }),

    /**
     * Denormalised pointers to the primary contact rows. Constrained to the same user by the
     * composite foreign keys in migration 0007 — drizzle cannot express `ON DELETE SET NULL (column)`,
     * so they are not declared here.
     */
    primaryEmailId: uuid('primary_email_id'),
    primaryPhoneId: uuid('primary_phone_id'),

    /** Bumped to invalidate every outstanding access token at once (M1 D5). */
    sessionsEpoch: integer('sessions_epoch').notNull().default(1),

    // Permissive by default because tagging a counterparty is core to the product.
    discoverableByUsername: boolean('discoverable_by_username').notNull().default(true),
    discoverableByEmail: boolean('discoverable_by_email').notNull().default(true),
    discoverableByPhone: boolean('discoverable_by_phone').notNull().default(true),

    mfaRequired: boolean('mfa_required').notNull().default(false),
    mfaEnrolledAt: timestamp('mfa_enrolled_at', { withTimezone: true }),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    registeredVia: text('registered_via'),
    registrationIp: inet('registration_ip'),
    locale: text('locale').notNull().default('en-NG'),
    timezone: text('timezone').notNull().default('Africa/Lagos'),

    // NDPA lawful-basis capture (M1 §15).
    termsVersion: text('terms_version'),
    privacyVersion: text('privacy_version'),
    consentRecordedAt: timestamp('consent_recorded_at', { withTimezone: true }),
    consentIp: inet('consent_ip'),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    marketingOptInAt: timestamp('marketing_opt_in_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
  },
  (table) => [
    // The `::text` cast is load-bearing: citext folds case in `~` too, so without it this accepts
    // 'JaneDoe'. ASCII-only for launch, which removes the whole homoglyph class (M1 §6.3).
    check(
      'users_username_format',
      sql`${table.username} IS NULL OR ${table.username}::text ~ '^[a-z][a-z0-9._]{2,29}$'`,
    ),
    check(
      'users_username_pair',
      sql`(${table.username} IS NULL AND ${table.usernameSkeleton} IS NULL)
          OR (${table.username} IS NOT NULL AND ${table.usernameSkeleton} IS NOT NULL)`,
    ),
    index('users_status_idx').on(table.status),
    index('users_created_at_idx').on(table.createdAt.desc()),
    index('users_ver_level_idx').on(table.verificationLevel),
  ],
);

/**
 * Display data, 1:1 with users. `firstName` / `lastName` are self-declared, never legal names: the
 * legal name lives in M6 and is the one a bank match uses. `avatarFileId` is a soft reference to
 * M20's PROFILE_PHOTO file, never a provider URL that can be revoked without our knowing (M1 D7).
 */
export const userProfiles = identity.table(
  'user_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    avatarFileId: uuid('avatar_file_id'),
    bio: text('bio'),
    dateOfBirth: date('date_of_birth'),
    gender: text('gender'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('profile_bio_len', sql`${table.bio} IS NULL OR length(${table.bio}) <= 500`)],
);
