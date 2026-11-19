// What VF1 is told about a liveness session the person gave up on.
//
// Abandoning reuses the EXPIRED status, so the row looks like every other swept request to a naive
// reader of `listRecentRejections`. It must not reach the screen as one: VF1 renders anything in
// `rejections` as a failure with a "Try again" banner, and apologising to somebody who simply
// closed a camera is both wrong and a dead end — the start control they actually need lives in the
// branch that only renders when there is nothing to report.
import { describe, expect, it } from 'vitest';
import { readVerificationStatus } from '../../../src/modules/trust/services/verification.service.js';

/** A `listRecentRejections` row — not a `verification_requests` row; the query projects four fields. */
const rejectionRow = (over: Record<string, unknown>) => ({
  requestId: 'bd6f3a2e-0c71-4a2c-9f1e-5b7d2c4a8e90',
  verificationType: 'LIVENESS',
  rejectionReason: null,
  decidedAt: new Date(),
  ...over,
});

const deps = (rejections: unknown[]) =>
  ({
    store: {
      findSubject: () =>
        Promise.resolve({ userId: 'u1', status: 'ACTIVE', verificationLevel: 'CONTACT_VERIFIED' }),
      identityFacts: () => Promise.resolve({ identifierVerified: true, livenessPassed: false }),
      businessFacts: () => Promise.resolve({ cacVerified: false, businessBankMatched: false }),
      listOpenRequests: () => Promise.resolve([]),
      listRecentRejections: () => Promise.resolve(rejections),
    },
  }) as never;

describe('readVerificationStatus and an abandoned liveness session', () => {
  it('leaves an abandoned session out of rejections', async () => {
    const status = await readVerificationStatus(
      deps([
        rejectionRow({
          verificationType: 'LIVENESS',
          rejectionReason: 'ABANDONED',
        }),
      ]),
      'u1',
    );

    expect(status.rejections).toEqual([]);
  });

  it('still reports a session the provider never answered', async () => {
    // The distinction the whole change rests on: nobody replied is a failure worth telling the
    // user about, changing your mind is not.
    const status = await readVerificationStatus(
      deps([
        rejectionRow({
          verificationType: 'LIVENESS',
          rejectionReason: 'PROVIDER_UNAVAILABLE',
        }),
      ]),
      'u1',
    );

    expect(status.rejections).toHaveLength(1);
    expect(status.rejections[0]?.reason.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('keeps a real rejection when an abandoned session sits beside it', async () => {
    const status = await readVerificationStatus(
      deps([
        rejectionRow({
          verificationType: 'LIVENESS',
          rejectionReason: 'ABANDONED',
        }),
        rejectionRow({
          verificationType: 'NIN',
          rejectionReason: 'ID_NAME_MISMATCH',
        }),
      ]),
      'u1',
    );

    expect(status.rejections.map((r) => r.type)).toEqual(['NIN']);
  });
});
