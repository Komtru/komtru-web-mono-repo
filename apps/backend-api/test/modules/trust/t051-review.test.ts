// T-051 review fixes: the officer name source, the bank-account key, the PENDING bank verdict, the
// social-proof index races, the business backstop, and the submission guards.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bankAccountHash } from '../../../src/modules/trust/domain/identifiers.js';
import type {
  BankMatchCheckResult,
  BusinessCheckResult,
} from '../../../src/modules/trust/domain/provider.js';
import { describeRejection } from '../../../src/modules/trust/domain/rejection.js';
import { businessBody } from '../../../src/modules/trust/http/validations.js';
import { runBankMatchCheck } from '../../../src/modules/trust/jobs/run-bank-match.job.js';
import { runBusinessCheck } from '../../../src/modules/trust/jobs/run-business-check.job.js';
import { runIdentityCheck } from '../../../src/modules/trust/jobs/run-identity-check.job.js';
import { runSocialProofCheck } from '../../../src/modules/trust/jobs/run-social-proof-check.job.js';
import type { TrustJobDeps } from '../../../src/modules/trust/jobs/deps.js';
import {
  readBankNameMatch,
  submitBankMatchCheck,
} from '../../../src/modules/trust/services/bankMatch.service.js';
import { submitBusinessCheck } from '../../../src/modules/trust/services/business.service.js';
import { requestSocialProofCheck } from '../../../src/modules/trust/services/socialProof.service.js';
import {
  recordingGateway,
  requestRow,
  scriptedAdapter,
  scriptedSocialAdapter,
  silentLogger,
  socialClaimRow,
  stubStore,
  testEncryption,
  testHasher,
  uniqueViolation,
} from './support.js';
import type { StubStoreOptions } from './support.js';

const encryption = testEncryption();
const level2 = {
  userId: randomUUID(),
  status: 'ACTIVE',
  verificationLevel: 'IDENTITY_VERIFIED',
  firstName: null,
  lastName: null,
} as const;
const svc = (store: ReturnType<typeof stubStore>) => ({
  store,
  encryption,
  requestTtlMinutes: 60,
  logger: silentLogger(),
});

const jobDeps = (store: ReturnType<typeof stubStore>, adapter: ReturnType<typeof scriptedAdapter>) => {
  const gateway = recordingGateway();
  const deps: TrustJobDeps = {
    store,
    adapter,
    hasher: testHasher(),
    encryption,
    gateway,
    logger: silentLogger(),
  };
  return { deps, gateway };
};

describe('the CAC officer name', () => {
  it('comes from the verified identity record, never from the request', async () => {
    const store = stubStore({
      subject: level2,
      identityName: { firstName: 'Grace', lastName: 'Eze' },
    });
    // A typed director's name smuggled in alongside the body.
    const typed = { userId: level2.userId, rcNumber: 'RC1487327', firstName: 'Real', lastName: 'Director' };
    const submitted = await submitBusinessCheck(svc(store), typed);
    const claim = JSON.parse(encryption.decrypt(submitted.job.sealed)) as Record<string, string>;
    expect(claim).toMatchObject({ firstName: 'Grace', lastName: 'Eze' });
    expect(JSON.stringify(claim)).not.toContain('Director');
  });

  it('refuses the request body that carries a name', () => {
    expect(businessBody.safeParse({ rcNumber: '1487327' }).success).toBe(true);
    expect(businessBody.safeParse({ rcNumber: '1487327', firstName: 'A', lastName: 'B' }).success).toBe(
      false,
    );
  });

  it('refuses a user whose identity record holds no verified name', async () => {
    const store = stubStore({ subject: level2, identityName: undefined });
    await expect(
      submitBusinessCheck(svc(store), { userId: level2.userId, rcNumber: '1487327' }),
    ).rejects.toMatchObject({ status: 409, code: 'IDENTITY_VERIFICATION_REQUIRED' });
  });

  it('is persisted by the identity job only from the claim that passed', async () => {
    const request = requestRow();
    const store = stubStore({ request });
    const adapter = scriptedAdapter({
      identity: { verdict: 'PASSED', providerReference: 'ref', nameMatchScore: 95 },
    });
    const { deps } = jobDeps(store, adapter);
    const sealed = encryption.encrypt(
      JSON.stringify({ identifier: '12345678904', firstName: 'Ada', lastName: 'Obi' }),
    );
    await runIdentityCheck(deps, { requestId: request.id, sealed });
    expect(store.identityOutcomes[0]).toMatchObject({ verifiedFirstName: 'Ada', verifiedLastName: 'Obi' });
  });
});

describe('submission guards', () => {
  it('refuses a level-3 CAC check below level 2', async () => {
    const store = stubStore();
    await expect(
      submitBusinessCheck(svc(store), { userId: randomUUID(), rcNumber: '1487327' }),
    ).rejects.toMatchObject({ status: 409, code: 'IDENTITY_VERIFICATION_REQUIRED' });
    expect(store.requests).toHaveLength(0);
  });

  it('refuses a bank match without a verified business', async () => {
    const store = stubStore({ subject: level2, verifiedBusiness: undefined });
    await expect(
      submitBankMatchCheck(svc(store), {
        userId: level2.userId,
        accountNumber: '0123456787',
        bankCode: '058',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'BUSINESS_VERIFICATION_REQUIRED' });
    expect(store.requests).toHaveLength(0);
  });

  it('refuses a CAC check for a business that is already verified, before any request exists', async () => {
    const store = stubStore({
      subject: level2,
      verifiedBusiness: { cacRcNumber: '1487327', registeredBusinessName: 'FAKE LIMITED' },
    });
    await expect(
      submitBusinessCheck(svc(store), { userId: level2.userId, rcNumber: '1487327' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(store.requests).toHaveLength(0);
  });
});

describe('the bank account key', () => {
  const passed: BankMatchCheckResult = {
    verdict: 'PASSED',
    providerReference: 'b1',
    resolvedAccountName: 'FAKE LIMITED',
    matchResult: 'EXACT',
    matchScore: 99,
  };
  const runBank = async (result: BankMatchCheckResult, accountNumber: string) => {
    const request = requestRow({ verificationType: 'BANK_ACCOUNT_NAME_MATCH', targetLevel: 3 });
    const store = stubStore({ request });
    const { deps } = jobDeps(store, scriptedAdapter({ bankMatch: result }));
    const sealed = encryption.encrypt(
      JSON.stringify({ accountNumber, bankCode: '058', expectedName: 'FAKE LIMITED' }),
    );
    await runBankMatchCheck(deps, { requestId: request.id, sealed });
    return store;
  };

  it('stores a keyed hash of the full number, which differs for accounts sharing their last four', async () => {
    const a = await runBank(passed, '0123456787');
    const b = await runBank(passed, '9999996787');
    const ha = a.bankMatchOutcomes[0]?.accountNumberHash;
    const hb = b.bankMatchOutcomes[0]?.accountNumberHash;
    expect(a.bankMatchOutcomes[0]?.accountNumberMasked).toBe(b.bankMatchOutcomes[0]?.accountNumberMasked);
    expect(ha).toEqual(bankAccountHash(testHasher(), '0123456787'));
    expect(ha?.equals(hb ?? Buffer.alloc(0))).toBe(false);
    expect(JSON.stringify(a.bankMatchOutcomes[0])).not.toContain('0123456787');
  });

  it('reads back on the full-number hash, not the mask', async () => {
    let seen: Buffer | undefined;
    const store = {
      findBankNameMatch: (q: { accountNumberHash: Buffer }) => {
        seen = q.accountNumberHash;
        return Promise.resolve(undefined);
      },
    };
    await readBankNameMatch(store, testHasher(), {
      userId: randomUUID(),
      bankCode: '058',
      accountNumber: '0123-456-787',
    });
    expect(seen).toEqual(bankAccountHash(testHasher(), '0123456787'));
  });

  it('writes no name-match row while the provider verdict is PENDING', async () => {
    const store = await runBank(
      { verdict: 'PENDING', providerReference: 'p', matchResult: 'MISMATCH' },
      '0123456787',
    );
    expect(store.bankMatchOutcomes).toHaveLength(0);
    expect(store.grants).toHaveLength(0);
  });
});

describe('the CAC backstop', () => {
  it('settles a lost one-verified-business race instead of rethrowing into a billed retry', async () => {
    const request = requestRow({ verificationType: 'CAC', targetLevel: 3 });
    const store = stubStore({
      request,
      applyBusinessOutcomeThrows: uniqueViolation('business_verifications_user_active_unique'),
    });
    const result: BusinessCheckResult = {
      verdict: 'PASSED',
      providerReference: 'c1',
      registeredBusinessName: 'FAKE LIMITED',
      cacStatus: 'active',
      officersMatch: true,
    };
    const adapter = scriptedAdapter({ business: result });
    const { deps } = jobDeps(store, adapter);
    const sealed = encryption.encrypt(
      JSON.stringify({ rcNumber: '1487327', firstName: 'Ada', lastName: 'Obi' }),
    );
    await expect(runBusinessCheck(deps, { requestId: request.id, sealed })).resolves.toBeUndefined();
    expect(adapter.calls).toBe(1);
    expect(store.settledAlreadyVerified).toEqual([{ requestId: request.id }]);
  });
});

describe('social proof index races', () => {
  const run = async (options: StubStoreOptions) => {
    const claim = socialClaimRow();
    const store = stubStore({ ...options, socialClaim: claim });
    const gateway = recordingGateway();
    const error = await runSocialProofCheck(
      {
        store,
        social: scriptedSocialAdapter({ outcome: 'CODE_PRESENT', foundIn: 'bio' }),
        gateway,
        logger: silentLogger(),
      },
      { claimId: claim.id },
    ).catch((caught: unknown) => caught);
    return { store, claim, emitted: gateway.emitted, error };
  };

  it('refuses to confirm a second claim on a platform the user already verified', async () => {
    const claim = socialClaimRow();
    const store = stubStore({ socialClaim: claim, hasVerifiedSocialClaim: true });
    await expect(
      requestSocialProofCheck({ store, logger: silentLogger() }, { userId: claim.userId, claimId: claim.id }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  for (const index of ['social_proof_claims_user_platform', 'social_proof_claims_platform_handle']) {
    it(`settles ${index} as unverified and tells the user, rather than retrying forever`, async () => {
      const { store, claim, emitted, error } = await run({ settleSocialThrows: uniqueViolation(index) });
      expect(error).toBeUndefined();
      expect(store.socialDecisions).toEqual([{ claimId: claim.id, verified: false }]);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        userId: claim.userId,
        payload: { claimId: claim.id, verified: false, reason: 'SOCIAL_HANDLE_TAKEN' },
      });
    });
  }

  it('rethrows a violation of any other index', async () => {
    const { error } = await run({ settleSocialThrows: uniqueViolation('something_else') });
    expect(error).toBeInstanceOf(Error);
  });

  it('has a rejection for the lost race on the social-proof surface', () => {
    expect(describeRejection('SOCIAL_HANDLE_TAKEN')).toMatchObject({
      code: 'SOCIAL_HANDLE_TAKEN',
      surface: 'SOCIAL_PROOF',
    });
  });
});
