// M6 §6.5: level 3's two facts — the business is real and registered to this person, and the
// settlement account is in the business's name.
//
// Note what is NOT here, in both tables: the thing that was sent to the provider. A CAC RC number is
// public record and is stored plainly (§6.5 says so outright); a bank account number is not, and
// §6.5 keeps only `account_number_masked` because M8's `payout_accounts` is the account of record
// and M6 has no reason to hold a second copy of it (§4's level-3 note).
import { sql } from 'drizzle-orm';
import { boolean, index, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { trust } from './columns.js';
import { bankMatchResult, kycProvider } from './enums.js';
import { bytea } from './identity-checks.js';
import { verificationRequests } from './requests.js';

export const businessVerifications = trust.table(
  'business_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'cascade' }),
    /** The verified proprietor. §4: a business is operated by a verified human, so level 2 first. */
    userId: uuid('user_id').notNull(),
    /** Public record. Stored plainly, normalised — see `normaliseRcNumber`. */
    cacRcNumber: text('cac_rc_number').notNull(),
    registeredBusinessName: text('registered_business_name').notNull(),
    /**
     * `BUSINESS_NAME`, `LIMITED_LIABILITY`, `INCORPORATED_TRUSTEE` and whatever else CAC returns.
     * Free text on purpose (§6.5): CAC's own classification has more variants than are worth
     * enumerating in a column, and a provider returning a twelfth one should not fail an insert.
     */
    businessType: text('business_type'),
    /** The provider's reported status: `active`, `inactive`, `not found`. */
    cacStatus: text('cac_status'),
    /** Is the submitter a registered officer? Null when the provider does not say. */
    officersMatch: boolean('officers_match'),
    provider: kycProvider('provider').notNull(),
    providerReference: text('provider_reference').notNull(),
    /** Null until the check passes. Every level-3 read keys on this being set. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('business_verifications_user_idx').on(table.userId),
    index('business_verifications_rc_idx').on(table.cacRcNumber),
    /**
     * Deliberately NOT a unique index on the RC number, which is where this table differs from
     * `nin_verifications`.
     *
     * §7's adjustment for CAC is explicit: one RC number legitimately backs several staff accounts
     * under M5's `merchant_staff` model, and legitimate re-registration happens. A unique index here
     * would refuse the second co-director of a real company. The duplicate question — "is this RC
     * already the primary verified business of a different, unrelated merchant?" — is a review case
     * instead, raised by `findBusinessOwner` and decided by a human (T-052).
     *
     * What IS enforced is one verified business per user, so a second CAC cannot quietly replace the
     * one a level-3 grant was made on.
     */
    uniqueIndex('business_verifications_user_active_unique')
      .on(table.userId)
      .where(sql`${table.verifiedAt} IS NOT NULL`),
  ],
);

export const bankAccountNameMatches = trust.table(
  'bank_account_name_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => verificationRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    /** Last four digits. The full number is M8's record, encrypted there (§4, T-073). */
    accountNumberMasked: text('account_number_masked').notNull(),
    /**
     * Keyed HMAC of the FULL account number (`trust:bank-account`). The last four digits are not an
     * identity: two accounts at one bank can share them, so reads key on this, not on the mask.
     */
    accountNumberHash: bytea('account_number_hash').notNull(),
    bankCode: text('bank_code').notNull(),
    /** What the bank returned. Null when the account could not be resolved at all. */
    resolvedAccountName: text('resolved_account_name'),
    /**
     * What it was matched against: the CAC-registered business name.
     *
     * Never a name the client supplied. A user-asserted expected name makes the whole check circular
     * — they would be matching the account against a string they typed — so this is read out of
     * `business_verifications.registered_business_name` at submission time.
     */
    expectedName: text('expected_name').notNull(),
    matchResult: bankMatchResult('match_result').notNull(),
    matchScore: numeric('match_score', { precision: 5, scale: 2 }),
    provider: kycProvider('provider').notNull(),
    providerReference: text('provider_reference').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bank_account_name_matches_user_idx').on(table.userId),
    /**
     * T-073's lookup: "has this user's payout account been name-matched, and what did it say".
     *
     * Keyed on the masked number and the bank code rather than on the request, because the payout
     * account is the thing T-073 holds — it has no verification request id and should not need one.
     */
    index('bank_account_name_matches_account_idx').on(table.userId, table.bankCode, table.accountNumberHash),
  ],
);

export type BusinessVerification = typeof businessVerifications.$inferSelect;
export type BankAccountNameMatch = typeof bankAccountNameMatches.$inferSelect;
