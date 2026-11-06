// The deterministic fake KYC provider (owner's decision Q7).
//
// No Dojah or Smile ID account exists yet, so this is what attests every identity level the platform
// grants today. It is named `*.client.ts` even though it reaches nothing: it occupies the provider
// seam, and the T-028 boundary — `*.client.ts` importable only from `jobs/` — is what stops a
// request handler calling an adapter directly. Naming it anything else would leave that door open
// for the one adapter that is easiest to misuse.
//
// It signs its work as `FAKE`, which is a value in the `kyc_provider` enum, so "which levels were
// granted by nobody" stays a single query the day real credentials arrive.
import type {
  BankAccountClaim,
  BankMatchCheckResult,
  BusinessClaim,
  BusinessCheckResult,
  IdentityClaim,
  IdentityCheckResult,
  KycProviderAdapter,
  LivenessCheckInput,
  LivenessCheckResult,
} from '../../domain/provider.js';
import {
  bankMatchScriptFor,
  businessScriptFor,
  fuzzyVariantOf,
  livenessScriptFor,
  referenceFor,
  registeredNameFor,
  scoreFor,
  scriptFor,
  UNRELATED_ACCOUNT_NAME,
} from './fake-script.js';

/** Scripted for a number ending in 3: the adapter throwing, which the job's retry budget absorbs. */
class FakeProviderError extends Error {
  constructor(operation: string) {
    super(`fake kyc: scripted provider failure on ${operation} (identifier ends in 3)`);
    this.name = 'FakeProviderError';
  }
}

const identityCheck = (operation: 'nin' | 'bvn', claim: IdentityClaim): IdentityCheckResult => {
  const outcome = scriptFor(claim.identifier);
  if (outcome === 'ERROR') throw new FakeProviderError(operation);

  const reference = referenceFor(operation);
  const result: IdentityCheckResult = {
    verdict: outcome,
    providerReference: reference,
    nameMatchScore: scoreFor(outcome, `${operation}:${claim.identifier}:${claim.lastName}`),
    // A DOB the user did not supply cannot be matched; `undefined` rather than `false`, because
    // "we did not check" and "it did not match" are different facts and the column keeps both.
    ...(claim.dateOfBirth === undefined ? {} : { dobMatch: outcome === 'PASSED' }),
    ...(operation === 'bvn' ? { phoneMatch: outcome === 'PASSED' } : {}),
  };
  if (outcome === 'FAILED') {
    result.failureReason = 'No record matched the number and name supplied';
  }
  if (outcome === 'LOW_CONFIDENCE') {
    result.failureReason = 'The name on the record is close but not an exact match';
  }
  return result;
};

/**
 * A scripted CAC lookup.
 *
 * Note what is NOT on the result: the submitter's name. It travels in on the claim so the officer
 * question can be answered and is persisted nowhere in this module (§6.5), so echoing it back would
 * put it on the one object the job then writes rows from.
 */
const businessCheck = (claim: BusinessClaim): BusinessCheckResult => {
  const outcome = businessScriptFor(claim.rcNumber);
  if (outcome === 'ERROR') throw new FakeProviderError('cac');

  const providerReference = referenceFor('cac');
  if (outcome === 'PENDING') return { verdict: 'PENDING', providerReference };
  if (outcome === 'NOT_FOUND') {
    return {
      verdict: 'FAILED',
      providerReference,
      cacStatus: 'not found',
      failureReason: 'No registration matched that number',
      failureCode: 'CAC_NOT_FOUND',
    };
  }
  if (outcome === 'LOW_CONFIDENCE') {
    return {
      verdict: 'LOW_CONFIDENCE',
      providerReference,
      registeredBusinessName: registeredNameFor(claim.rcNumber),
      businessType: 'BUSINESS_NAME',
      cacStatus: 'active',
      failureReason: 'The registration matched only weakly',
    };
  }

  const shared = {
    // A PASSED verdict throughout the rest: the registration WAS found. Whether it is a business
    // this person may trade as is `decideBusinessOutcome`'s call, not the registry's, and
    // collapsing the two here is the mistake that decision function exists to prevent.
    verdict: 'PASSED' as const,
    providerReference,
    registeredBusinessName: registeredNameFor(claim.rcNumber),
    businessType: 'LIMITED_LIABILITY',
  };
  if (outcome === 'INACTIVE') {
    return {
      ...shared,
      cacStatus: 'inactive',
      officersMatch: true,
      failureReason: 'The registration is not active at the CAC',
      failureCode: 'CAC_INACTIVE',
    };
  }
  if (outcome === 'OFFICER_MISMATCH') {
    return {
      ...shared,
      cacStatus: 'active',
      officersMatch: false,
      failureReason: 'The submitter is not a registered officer',
      failureCode: 'CAC_OFFICER_MISMATCH',
    };
  }
  // OFFICER_UNKNOWN leaves `officersMatch` off entirely rather than setting it false: §8 is honest
  // that much of the KYB suite is implied rather than confirmed, and "we did not check" is a
  // different fact from "it did not match". `decideBusinessOutcome` sends the first to a human.
  if (outcome === 'OFFICER_UNKNOWN') return { ...shared, cacStatus: 'active' };
  return { ...shared, cacStatus: 'active', officersMatch: true };
};

/**
 * A scripted bank name-match.
 *
 * The account number is read and never returned: §6.5 keeps four digits of it and M8's
 * `payout_accounts` is the account of record, so a full number on this object would be a second copy
 * of it travelling through the job.
 */
const bankMatchCheck = (claim: BankAccountClaim): BankMatchCheckResult => {
  const outcome = bankMatchScriptFor(claim.accountNumber);
  if (outcome === 'ERROR') throw new FakeProviderError('bank name-match');

  const providerReference = referenceFor('bank');
  const seed = `bank:${claim.bankCode}:${claim.accountNumber}`;
  if (outcome === 'PENDING') {
    return { verdict: 'PENDING', providerReference, matchResult: 'MISMATCH' };
  }
  if (outcome === 'ACCOUNT_NOT_FOUND') {
    // No `resolvedAccountName` at all — which is how `classifyBankMatchFailure` tells an account the
    // bank does not recognise from one that is real and held by somebody else.
    return {
      verdict: 'FAILED',
      providerReference,
      matchResult: 'MISMATCH',
      matchScore: scoreFor('FAILED', seed),
      failureReason: 'The bank did not recognise that account number',
      failureCode: 'BANK_ACCOUNT_NOT_FOUND',
    };
  }
  if (outcome === 'FUZZY') {
    return {
      verdict: 'PASSED',
      providerReference,
      resolvedAccountName: fuzzyVariantOf(claim.expectedName),
      matchResult: 'FUZZY_MATCH',
      matchScore: scoreFor('LOW_CONFIDENCE', seed),
      failureReason: 'The account name is close to the registered name but not identical',
    };
  }
  if (outcome === 'NAME_MISMATCH') {
    return {
      verdict: 'FAILED',
      providerReference,
      resolvedAccountName: UNRELATED_ACCOUNT_NAME,
      matchResult: 'MISMATCH',
      matchScore: scoreFor('FAILED', seed),
      failureReason: 'The account is held in a different name',
      failureCode: 'BANK_NAME_MISMATCH',
    };
  }
  return {
    verdict: 'PASSED',
    providerReference,
    resolvedAccountName: claim.expectedName,
    matchResult: 'EXACT',
    matchScore: scoreFor('PASSED', seed),
  };
};

export function createFakeKycClient(): KycProviderAdapter {
  return {
    provider: 'FAKE',

    // `.then(...)`, not `Promise.resolve(identityCheck(...))`. The argument of `Promise.resolve` is
    // evaluated BEFORE the promise exists, so the scripted failure would leave the adapter as a
    // SYNCHRONOUS throw — an exception on the worker's own call stack rather than a rejected job,
    // which is the same trap the files and ledger modules documented on their queue handlers.
    verifyNin: (claim) => Promise.resolve().then(() => identityCheck('nin', claim)),
    verifyBvn: (claim) => Promise.resolve().then(() => identityCheck('bvn', claim)),

    checkLiveness: (input: LivenessCheckInput) =>
      Promise.resolve().then(() => {
        const outcome = livenessScriptFor(input.selfieStorageRef);
        const result: LivenessCheckResult = {
          verdict: outcome,
          providerReference: referenceFor('liveness'),
          matchScore: scoreFor(outcome, `liveness:${input.selfieStorageRef}`),
          livenessPassed: outcome === 'PASSED',
        };
        if (outcome === 'FAILED') result.failureReason = 'The image did not pass the liveness check';
        if (outcome === 'LOW_CONFIDENCE') {
          result.failureReason = 'The face matched the document only weakly';
        }
        return result;
      }),

    verifyBusiness: (claim) => Promise.resolve().then(() => businessCheck(claim)),
    verifyBankAccountName: (claim) => Promise.resolve().then(() => bankMatchCheck(claim)),
  };
}
