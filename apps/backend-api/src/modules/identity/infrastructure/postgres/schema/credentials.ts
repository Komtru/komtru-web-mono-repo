// M1 §5.5–5.6. A social-only user has no row in user_credentials, and that is legal: password login
// for such a user must return the same generic error as a wrong password, never "this account uses
// Google", which is a free account-enumeration oracle.
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, citext, identity } from './columns.js';
import { socialProvider } from './enums.js';
import { users } from './users.js';

export const userCredentials = identity.table('user_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** argon2id, the full PHC string. */
  passwordHash: text('password_hash').notNull(),
  algorithm: text('algorithm').notNull().default('argon2id'),
  /** Last N hashes, to block reuse. Hashes only, never plaintext. */
  previousHashes: text('previous_hashes')
    .array()
    .notNull()
    .default(sql`'{}'`),
  mustChange: boolean('must_change').notNull().default(false),
  /** Set by the k-anonymity HIBP check (T-032). */
  breachedAt: timestamp('breached_at', { withTimezone: true }),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  /**
   * The automatic, self-clearing throttle. Distinct from `users.status = 'LOCKED'`, which is a risk
   * lock needing the recovery flow — conflating the two is a M1 §9.1 bug.
   */
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  passwordSetAt: timestamp('password_set_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const socialIdentities = identity.table(
  'social_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: socialProvider('provider').notNull(),
    /** The `sub` claim; immutable for the life of the provider account. */
    providerUserId: text('provider_user_id').notNull(),
    providerUsername: text('provider_username'),
    providerEmail: citext('provider_email'),
    providerEmailVerified: boolean('provider_email_verified').notNull().default(false),
    /**
     * Raw source metadata about the linked identity. Never assigned to user_profiles.avatar_file_id:
     * a provider URL can be revoked without our knowing, so an avatar is always a file we store (D7).
     */
    providerAvatarUrl: text('provider_avatar_url'),
    accessTokenEnc: bytea('access_token_enc'),
    refreshTokenEnc: bytea('refresh_token_enc'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    rawProfile: jsonb('raw_profile'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
  },
  (table) => [
    // Partial, so unlinking releases the subject for a genuine re-link without losing the history.
    uniqueIndex('social_identities_provider_subject')
      .on(table.provider, table.providerUserId)
      .where(sql`${table.unlinkedAt} IS NULL`),
    uniqueIndex('social_identities_one_per_provider')
      .on(table.userId, table.provider)
      .where(sql`${table.unlinkedAt} IS NULL`),
    index('social_identities_user_idx').on(table.userId),
  ],
);
