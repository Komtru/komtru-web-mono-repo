// The M6 §6 schema, asserted over the exported declarations rather than a live database: the values
// in these enums are a contract other modules and later tickets read, and a silent reorder or a
// dropped member is exactly the kind of drift a migration will happily carry forward.
import { describe, expect, it } from 'vitest';
import {
  KYC_PROVIDERS,
  VERIFICATION_REQUEST_STATUSES,
  VERIFICATION_TYPES,
  bvnVerifications,
  kycProviderCalls,
  livenessChecks,
  ninVerifications,
  verificationLevelChanges,
  verificationRequests,
} from '../../../src/modules/trust/index.js';
import { testModules } from '../../support/modules.js';

describe('trust schema', () => {
  it('declares every verification type M6 §6.1 names', () => {
    expect(VERIFICATION_TYPES).toEqual([
      'NIN',
      'BVN',
      'LIVENESS',
      'CAC',
      'BANK_ACCOUNT_NAME_MATCH',
      'ADDRESS',
      'DOCUMENT',
      'SOCIAL_PROOF',
    ]);
  });

  it('declares every request status M6 §6.1 names', () => {
    expect(VERIFICATION_REQUEST_STATUSES).toEqual([
      'SUBMITTED',
      'PROVIDER_PENDING',
      'PROVIDER_PASSED',
      'PROVIDER_FAILED',
      'MANUAL_REVIEW',
      'APPROVED',
      'REJECTED',
      'EXPIRED',
    ]);
  });

  it('declares FAKE alongside the real providers, so a fake-granted level is queryable', () => {
    expect(KYC_PROVIDERS).toContain('FAKE');
    expect(KYC_PROVIDERS).toEqual(
      expect.arrayContaining(['SMILE_IDENTITY', 'YOUVERIFY', 'PREMBLY', 'DOJAH', 'VERIFYME', 'MANUAL']),
    );
  });

  it('stores an identifier only as a mask, a keyed hash and a provider reference (D1)', () => {
    for (const table of [ninVerifications, bvnVerifications]) {
      const columns = Object.keys(table);
      expect(columns).toEqual(expect.arrayContaining(['provider', 'providerReference', 'verifiedAt']));
      // Nothing on either table may hold the number itself, however it is spelled.
      expect(columns.filter((name) => /^(nin|bvn)$/i.test(name))).toEqual([]);
    }
    expect(Object.keys(ninVerifications)).toEqual(expect.arrayContaining(['ninMasked', 'ninHash']));
    expect(Object.keys(bvnVerifications)).toEqual(expect.arrayContaining(['bvnMasked', 'bvnHash']));
  });

  it('keeps the request row free of anything that could carry an identifier', () => {
    const columns = Object.keys(verificationRequests);
    expect(columns).toEqual(
      expect.arrayContaining([
        'userId',
        'verificationType',
        'status',
        'provider',
        'providerReference',
        'targetLevel',
        'expiresAt',
        'rejectionReason',
      ]),
    );
  });

  it('logs every provider call, successful or not, for cost and error-rate reconciliation', () => {
    expect(Object.keys(kycProviderCalls)).toEqual(
      expect.arrayContaining([
        'requestId',
        'provider',
        'callType',
        'httpStatus',
        'latencyMs',
        'costEstimateKobo',
        'succeeded',
        'errorKind',
      ]),
    );
  });

  it('records a level change with its direction, its cause and who made it', () => {
    expect(Object.keys(verificationLevelChanges)).toEqual(
      expect.arrayContaining([
        'userId',
        'fromLevel',
        'toLevel',
        'direction',
        'triggeringRequestId',
        'reason',
        'actorType',
        'actorId',
      ]),
    );
  });

  it('records which identity document a liveness selfie was matched against', () => {
    expect(Object.keys(livenessChecks)).toEqual(
      expect.arrayContaining(['matchedAgainst', 'matchScore', 'livenessPassed', 'selfieStorageRef']),
    );
  });
});

describe('the module registry', () => {
  it('holds the trust module', () => {
    expect(testModules().map((module) => module.name)).toContain('trust');
  });
});
