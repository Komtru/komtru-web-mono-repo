// M6 §6.6's last table: Instagram and X handle ownership, claimed and then proved out of band.
//
// M1 §7.2 is the decision behind it, and it is worth restating because the table looks like an OAuth
// table and is the opposite of one: **this is never login**. Instagram's Basic Display API died for
// personal accounts in December 2024 and X bills per profile read, so neither is usable as an
// authenticator — but a seller's Instagram presence is real social proof to a Nigerian buyer. So the
// user puts a one-time code in their bio or a post, and we look for it. Zero API spend, no
// login-availability dependency on another company's pricing decisions.
//
// It is also the one check in this module with NO `request_id`, which is §6.6's own shape and not an
// oversight on the way through: nothing here is attested by a KYC provider, nothing here moves a
// verification level (§4 has no room for it), and a `verification_requests` row would have to claim a
// `target_level` between 2 and 4 that this check does not contribute to. The claim row is its own
// lifecycle — `verified`, `verified_at`, `last_checked_at` — and that is the whole state machine.
import { sql } from 'drizzle-orm';
import { boolean, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { socialProofPlatform } from './enums.js';

export const socialProofClaims = trust.table(
  'social_proof_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    platform: socialProofPlatform('platform').notNull(),
    /** Normalised: no leading `@`, lower-cased. Both platforms treat handles case-insensitively. */
    handle: text('handle').notNull(),
    /** The one-time code the user must display. Not a secret — it is meant to be published. */
    challengeCode: text('challenge_code').notNull(),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** When we last looked. Rate-limiting a re-check reads this rather than counting requests. */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * §6.6's rule: one VERIFIED claim per user per platform.
     *
     * Partial, so a user may abandon an unverified claim and start another — which they will, since
     * the first thing anyone does after mistyping their handle is type it again.
     */
    uniqueIndex('social_proof_claims_user_platform')
      .on(table.userId, table.platform)
      .where(sql`${table.verified} = true`),
    /**
     * Not in §6.6, and it is the one that matters for fraud: two sellers cannot both display a
     * verified `@techedge_ng` badge. The handle is the thing a buyer recognises, so claiming one
     * somebody else has already proved must fail rather than produce a second badge.
     */
    uniqueIndex('social_proof_claims_platform_handle')
      .on(table.platform, table.handle)
      .where(sql`${table.verified} = true`),
    index('social_proof_claims_user_idx').on(table.userId),
  ],
);

export type SocialProofClaim = typeof socialProofClaims.$inferSelect;
