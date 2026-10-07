// The CAC job and the bank name-match job: what each verdict produces, and the one thing the ticket
// states outright — that level 3 needs level 2 PLUS a CAC PLUS a business bank match, all three.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  BankMatchCheckResult,
  BusinessCheckResult,
} from '../../../src/modules/trust/domain/provider.js';
import { runBankMatchCheck } from '../../../src/modules/trust/jobs/run-bank-match.job.js';
import { runBusinessCheck } from '../../../src/modules/trust/jobs/run-business-check.job.js';
import type { TrustJobDeps } from '../../../src/modules/trust/jobs/deps.js';
import {
  recordingGateway,
  requestRow,
  scriptedAdapter,
  silentLogger,
  stubStore,
  testEncryption,
  testHasher,
} from './support.js';
import type { StubStoreOptions } from './support.js';

const encryption = testEncryption();
const RC = '1487327';
const BUSINESS_NAME = 'FAKE ENTERPRISES 1487327 LIMITED';

const passedBusiness: BusinessCheckResult = {
  verdict: 'PASSED',
  providerReference: 'fake_cac_1',
  registeredBusinessName: BUSINESS_NAME,
  businessType: 'LIMITED_LIABILITY',
  cacStatus: 'active',
  officersMatch: true,
};

interface BusinessRun extends StubStoreOptions {
  result?: BusinessCheckResult | Error;
}

const runBusiness = async (options: BusinessRun = {}) => {
  const request = options.request ?? requestRow({ verificationType: 'CAC', targetLevel: 3 });
  const store = stubStore({ ...options, request });
  const adapter = scriptedAdapter({ business: options.result ?? passedBusiness });
  const gateway = recordingGateway();
  const deps: TrustJobDeps = {
    store,
    adapter,
    hasher: testHasher(),
    encryption,
    gateway,
    logger: silentLogger(),
  };
  const sealed = encryption.encrypt(JSON.stringify({ rcNumber: RC, firstName: 'Ada', lastName: 'Obi' }));
  const error = await runBusinessCheck(deps, { requestId: request.id, sealed }).catch(
    (caught: unknown) => caught,
  );
  return { store, adapter, request, error, emitted: gateway.emitted };
};

describe('runBusinessCheck', () => {
  it('writes the CAC outcome and marks it verified on an active, officer-matched registration', async () => {
    const { store } = await runBusiness();
    expect(store.businessOutcomes[0]).toMatchObject({
      cacRcNumber: RC,
      registeredBusinessName: BUSINESS_NAME,
      cacStatus: 'active',
      officersMatch: true,
      requestStatus: 'APPROVED',
      markVerified: true,
    });
  });

  it('normalises the RC number before it is stored, so §7’s duplicate check can compare strings', async () => {
    const request = requestRow({ verificationType: 'CAC', targetLevel: 3 });
    const store = stubStore({ request });
    const deps: TrustJobDeps = {
      store,
      adapter: scriptedAdapter({ business: passedBusiness }),
      hasher: testHasher(),
      encryption,
      gateway: recordingGateway(),
      logger: silentLogger(),
    };
    const sealed = encryption.encrypt(
      JSON.stringify({ rcNumber: 'RC 1487327', firstName: 'Ada', lastName: 'Obi' }),
    );
    await runBusinessCheck(deps, { requestId: request.id, sealed });
    expect(store.businessOutcomes[0]?.cacRcNumber).toBe('1487327');
  });

  /** §6.5 stores the RC number plainly and the submitter's name nowhere. */
  it('stores no part of the submitter’s name', async () => {
    const { store } = await runBusiness();
    expect(JSON.stringify(store.businessOutcomes[0])).not.toMatch(/Ada|Obi/);
  });

  it('rejects an inactive registration with the code BVR1 renders, not an approval', async () => {
    const { store } = await runBusiness({
      result: { ...passedBusiness, cacStatus: 'inactive', failureCode: 'CAC_INACTIVE' },
    });
    expect(store.businessOutcomes[0]).toMatchObject({
      requestStatus: 'REJECTED',
      markVerified: false,
      rejectionReason: 'CAC_INACTIVE',
    });
    expect(store.grants).toHaveLength(0);
  });

  it('rejects a registration the submitter is not an officer of', async () => {
    const { store } = await runBusiness({
      result: { ...passedBusiness, officersMatch: false, failureCode: 'CAC_OFFICER_MISMATCH' },
    });
    expect(store.businessOutcomes[0]).toMatchObject({
      requestStatus: 'REJECTED',
      rejectionReason: 'CAC_OFFICER_MISMATCH',
    });
  });

  it('sends an unknown officer answer to a human rather than refusing every quiet provider', async () => {
    const { store } = await runBusiness({
      result: { verdict: 'PASSED', providerReference: 'r', registeredBusinessName: BUSINESS_NAME },
    });
    expect(store.businessOutcomes[0]).toMatchObject({
      requestStatus: 'MANUAL_REVIEW',
      markVerified: false,
      rejectionReason: 'NEEDS_HUMAN_REVIEW',
    });
  });

  it('rejects a missing registration with CAC_NOT_FOUND', async () => {
    const { store } = await runBusiness({
      result: { verdict: 'FAILED', providerReference: 'r', failureCode: 'CAC_NOT_FOUND' },
    });
    expect(store.businessOutcomes[0]).toMatchObject({
      requestStatus: 'REJECTED',
      rejectionReason: 'CAC_NOT_FOUND',
    });
  });

  /**
   * §7's CAC branch. Not a hard DB constraint — one RC legitimately backs several staff accounts
   * under M5's `merchant_staff` model — so a second, unrelated merchant on a verified RC is a review
   * case. Rejecting would hand a fraudster a veto over a real company's registration.
   */
  it('parks a registration another account already holds, rather than approving or rejecting it', async () => {
    const firstUserId = randomUUID();
    const { store } = await runBusiness({
      businessOwner: { userId: firstUserId, registeredBusinessName: BUSINESS_NAME },
    });
    expect(store.businessOutcomes).toHaveLength(0);
    expect(store.duplicateBusinesses[0]).toMatchObject({
      cacRcNumber: RC,
      firstUserId,
      requestStatus: 'MANUAL_REVIEW',
      markVerified: false,
    });
    expect(store.grants).toHaveLength(0);
  });

  it('carries the RC number as a hash on the duplicate branch, never in the clear', async () => {
    const { store } = await runBusiness({
      businessOwner: { userId: randomUUID(), registeredBusinessName: BUSINESS_NAME },
    });
    const hex = store.duplicateBusinesses[0]?.rcNumberHashHex ?? '';
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).not.toContain(RC);
  });

  it('treats the submitter’s OWN verified registration as theirs, not as a duplicate', async () => {
    const request = requestRow({ verificationType: 'CAC', targetLevel: 3 });
    const { store } = await runBusiness({
      request,
      businessOwner: { userId: request.userId, registeredBusinessName: BUSINESS_NAME },
    });
    expect(store.duplicateBusinesses).toHaveLength(0);
    expect(store.businessOutcomes[0]?.markVerified).toBe(true);
  });

  it('does not check for a duplicate at all when the registration did not pass', async () => {
    const { store } = await runBusiness({
      result: { verdict: 'FAILED', providerReference: 'r', failureCode: 'CAC_NOT_FOUND' },
      businessOwner: { userId: randomUUID(), registeredBusinessName: BUSINESS_NAME },
    });
    expect(store.duplicateBusinesses).toHaveLength(0);
    expect(store.businessOutcomes[0]?.requestStatus).toBe('REJECTED');
  });

  it('logs the provider call on a failure and rethrows, so BullMQ retries and the cost survives', async () => {
    const { store, error } = await runBusiness({ result: new Error('provider down') });
    expect(store.providerCalls[0]).toMatchObject({ callType: 'CAC', succeeded: false });
    expect(error).toBeInstanceOf(Error);
  });

  it('does not call the provider for a request already decided', async () => {
    const { adapter } = await runBusiness({
      request: requestRow({ verificationType: 'CAC', status: 'EXPIRED' }),
    });
    expect(adapter.calls).toBe(0);
  });

  /** §4's level-3 rule: a verified CAC alone is not level 3. */
  it('grants nothing on a verified CAC while the bank match is still outstanding', async () => {
    const { store } = await runBusiness({
      businessFacts: { currentLevel: 2, cacVerified: true, businessBankMatched: false },
    });
    expect(store.grants).toHaveLength(0);
  });
});

const passedMatch: BankMatchCheckResult = {
  verdict: 'PASSED',
  providerReference: 'fake_bank_1',
  resolvedAccountName: BUSINESS_NAME,
  matchResult: 'EXACT',
  matchScore: 99,
};

interface BankRun extends StubStoreOptions {
  result?: BankMatchCheckResult | Error;
}

const runBank = async (options: BankRun = {}) => {
  const request =
    options.request ?? requestRow({ verificationType: 'BANK_ACCOUNT_NAME_MATCH', targetLevel: 3 });
  const store = stubStore({ ...options, request });
  const adapter = scriptedAdapter({ bankMatch: options.result ?? passedMatch });
  const gateway = recordingGateway();
  const deps: TrustJobDeps = {
    store,
    adapter,
    hasher: testHasher(),
    encryption,
    gateway,
    logger: silentLogger(),
  };
  const sealed = encryption.encrypt(
    JSON.stringify({ accountNumber: '0123456787', bankCode: '058', expectedName: BUSINESS_NAME }),
  );
  const error = await runBankMatchCheck(deps, { requestId: request.id, sealed }).catch(
    (caught: unknown) => caught,
  );
  return { store, adapter, request, error, emitted: gateway.emitted };
};

describe('runBankMatchCheck', () => {
  it('stores four digits of the account number and never the number itself', async () => {
    const { store } = await runBank();
    expect(store.bankMatchOutcomes[0]).toMatchObject({
      accountNumberMasked: '******6787',
      bankCode: '058',
      expectedName: BUSINESS_NAME,
      matchResult: 'EXACT',
      requestStatus: 'APPROVED',
    });
    expect(JSON.stringify(store.bankMatchOutcomes[0])).not.toContain('0123456787');
  });

  /** `decideBankMatchOutcome`'s judgment call: "almost certainly the same business" is not enough. */
  it('sends a FUZZY_MATCH to a human and grants nothing', async () => {
    const { store } = await runBank({
      result: {
        ...passedMatch,
        resolvedAccountName: 'FAKE ENTERPRISES 1487327 LIM',
        matchResult: 'FUZZY_MATCH',
      },
    });
    expect(store.bankMatchOutcomes[0]).toMatchObject({
      requestStatus: 'MANUAL_REVIEW',
      rejectionReason: 'NEEDS_HUMAN_REVIEW',
    });
    expect(store.grants).toHaveLength(0);
  });

  it('distinguishes an unresolvable account from one held in another name', async () => {
    const missing = await runBank({
      result: { verdict: 'FAILED', providerReference: 'r', matchResult: 'MISMATCH' },
    });
    expect(missing.store.bankMatchOutcomes[0]?.rejectionReason).toBe('BANK_ACCOUNT_NOT_FOUND');

    const other = await runBank({
      result: {
        verdict: 'FAILED',
        providerReference: 'r',
        resolvedAccountName: 'SOMEBODY ELSE',
        matchResult: 'MISMATCH',
      },
    });
    expect(other.store.bankMatchOutcomes[0]?.rejectionReason).toBe('BANK_NAME_MISMATCH');
  });

  it('grants level 3 once level 2, the CAC and an exact bank match are all on file', async () => {
    const { store, request } = await runBank({
      businessFacts: { currentLevel: 2, cacVerified: true, businessBankMatched: true },
    });
    expect(store.grants[0]).toMatchObject({
      userId: request.userId,
      toLevel: 3,
      actorType: 'PROVIDER_AUTO',
      triggeringRequestId: request.id,
    });
  });

  /**
   * The half of §4's rule that is NOT re-derivable from the other two: a user can hold a verified
   * CAC and a matched account while their identity level has since been revoked (D6).
   */
  it('refuses level 3 to a user whose identity level has been revoked', async () => {
    const { store } = await runBank({
      businessFacts: { currentLevel: 1, cacVerified: true, businessBankMatched: true },
    });
    expect(store.grants).toHaveLength(0);
  });

  it('grants nothing when the CAC is not verified, however good the name match is', async () => {
    const { store } = await runBank({
      businessFacts: { currentLevel: 2, cacVerified: false, businessBankMatched: true },
    });
    expect(store.grants).toHaveLength(0);
  });

  it('discards the outcome when the request was decided while the provider answered', async () => {
    const { store } = await runBank({ outcomeApplied: false });
    expect(store.grants).toHaveLength(0);
  });
});
