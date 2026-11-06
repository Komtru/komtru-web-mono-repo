// The business bank-account name-match: §4's level-3 second requirement, and the one check in this
// module another module depends on by name (T-073's payout accounts).
//
// Where M6 and M8 touch, restated from §4 because getting the boundary wrong is how an account
// number ends up in two places: **M6 verifies the name match, M8 owns the account.** This module
// never stores the account number beyond the last four digits (§6.5) and never routes a payout. What
// T-073 reads back is a verdict, through `findBankNameMatch`.
//
// The `expected_name` is not a parameter, and that is the design. A client-supplied expected name
// makes the check circular — the user would be matching the account against a string they typed —
// so it is read out of their own verified `business_verifications` row. Which also means this check
// is unavailable until the CAC check has passed, in that order, which is §4's order anyway.
import { ApiError } from '../../../platform/errors.js';
import type { Encryption } from '../../../platform/crypto/encryption.js';
import type { Logger } from '../../../platform/logger.js';
import { isUniqueViolation } from '../../../db/errors.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { bankAccountHash } from '../domain/identifiers.js';
import { BUSINESS_VERIFIED_LEVEL } from '../domain/levels.js';
import type { BankMatchJob } from '../domain/queues.js';
import type { BankNameMatchRecord, TrustStore } from '../infrastructure/postgres/store.js';
import type { SubmitResult } from './verification.service.js';
import { assertActive, inFlightConflict } from './submission.js';

export interface BankMatchDeps {
  store: TrustStore;
  encryption: Encryption;
  requestTtlMinutes: number;
  logger: Logger;
}

export interface SubmitBankMatchInput {
  userId: string;
  /** A NUBAN: ten digits. The bank is the authority on whether it exists. */
  accountNumber: string;
  /** The bank's code as the payment provider lists it (T-071's cached bank list). */
  bankCode: string;
}

/** NUBAN. Ten digits, fixed by the CBN, and the one format check worth making client-side. */
const NUBAN_DIGITS = 10;
const VISIBLE_SUFFIX = 4;

export const normaliseAccountNumber = (raw: string): string => raw.replace(/\D/g, '');

/** Last four. §6.5 stores this and nothing more; the full number is M8's record. */
export const maskAccountNumber = (normalised: string): string =>
  normalised.length <= VISIBLE_SUFFIX
    ? '*'.repeat(normalised.length)
    : '*'.repeat(normalised.length - VISIBLE_SUFFIX) + normalised.slice(-VISIBLE_SUFFIX);

export async function submitBankMatchCheck(
  deps: BankMatchDeps,
  input: SubmitBankMatchInput,
): Promise<SubmitResult<BankMatchJob>> {
  assertActive(await deps.store.findSubject(input.userId));

  const accountNumber = normaliseAccountNumber(input.accountNumber);
  if (accountNumber.length !== NUBAN_DIGITS) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'That account number does not look right',
      'A Nigerian bank account number is ten digits.',
      [{ path: 'accountNumber', message: 'must be ten digits' }],
    );
  }

  /**
   * The CAC check first, and the refusal says so.
   *
   * This is not merely an ordering preference: without a verified business there is no registered
   * name to match the account against, so the check has no question to ask. Running it anyway
   * against the user's self-declared profile name would produce a row that looks like a business
   * bank match and is not one — and `earnedBusinessLevel` would then grant level 3 on it.
   */
  const business = await deps.store.findVerifiedBusiness(input.userId);
  if (!business) {
    throw new ApiError(
      409,
      'BUSINESS_VERIFICATION_REQUIRED',
      'Verify your business first',
      'We match the account against your CAC-registered business name, so the CAC check comes first.',
    );
  }

  const attemptCount = (await deps.store.countAttempts(input.userId, 'BANK_ACCOUNT_NAME_MATCH')) + 1;

  let request;
  try {
    request = await deps.store.createRequest({
      userId: input.userId,
      verificationType: 'BANK_ACCOUNT_NAME_MATCH',
      targetLevel: BUSINESS_VERIFIED_LEVEL,
      ttlMinutes: deps.requestTtlMinutes,
      attemptCount,
    });
  } catch (error) {
    if (isUniqueViolation(error, 'verification_requests_one_in_flight')) {
      throw await inFlightConflict(deps.store, input.userId, 'BANK_ACCOUNT_NAME_MATCH');
    }
    throw error;
  }

  return {
    requestId: request.id,
    status: request.status,
    job: {
      requestId: request.id,
      /**
       * The only place in the platform a full account number is held outside M8, and it is held
       * encrypted, for the length of one job.
       */
      sealed: deps.encryption.encrypt(
        JSON.stringify({
          accountNumber,
          bankCode: input.bankCode,
          expectedName: business.registeredBusinessName,
        }),
      ),
    },
  };
}

/**
 * T-073's read: "is there a name-match on record for this payout account, and what did it say?"
 *
 * Exported from the module barrel, deliberately as a question about an account rather than about a
 * request — T-073 holds a `payout_accounts` row, which has a bank code and a masked number and no
 * verification request id, and should not have to acquire one.
 */
export const readBankNameMatch = (
  store: Pick<TrustStore, 'findBankNameMatch'>,
  hasher: HmacHasher,
  input: { userId: string; bankCode: string; accountNumber: string },
): Promise<BankNameMatchRecord | undefined> =>
  store.findBankNameMatch({
    userId: input.userId,
    bankCode: input.bankCode,
    // Keyed on the full number's hash: four digits are shared by unrelated accounts at one bank.
    accountNumberHash: bankAccountHash(hasher, normaliseAccountNumber(input.accountNumber)),
  });
