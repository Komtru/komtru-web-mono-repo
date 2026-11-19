// The name VF1 shows beside a NIN or BVN field, and where the screen is allowed to get it from.
//
// VF1 cannot ask `/me` for this: the profile name is not on that payload, and putting it there
// would hand a legal-ish name to every screen that renders an avatar. It comes down with the
// verification status instead, where the one screen that needs it already looks.
import { describe, expect, it } from 'vitest';
import { readVerificationStatus } from '../../../src/modules/trust/services/verification.service.js';

const deps = (subject: Record<string, unknown> | undefined) =>
  ({
    store: {
      findSubject: () => Promise.resolve(subject),
      identityFacts: () => Promise.resolve({ identifierVerified: false, livenessPassed: false }),
      businessFacts: () => Promise.resolve({ cacVerified: false, businessBankMatched: false }),
      listOpenRequests: () => Promise.resolve([]),
      listRecentRejections: () => Promise.resolve([]),
    },
  }) as never;

const subject = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  status: 'ACTIVE',
  verificationLevel: 'CONTACT_VERIFIED',
  firstName: 'Amaka',
  lastName: 'Balogun',
  ...over,
});

describe('readVerificationStatus and the account name', () => {
  it("reports the account's own name for the identifier form to fill itself with", async () => {
    const status = await readVerificationStatus(deps(subject()), 'u1');
    expect(status.nameClaim).toEqual({ firstName: 'Amaka', lastName: 'Balogun' });
  });

  it('reports a missing half as null rather than an empty string', async () => {
    // The screen branches on "is there a name to lock to"; '' and null must not be two answers.
    const status = await readVerificationStatus(deps(subject({ lastName: null })), 'u1');
    expect(status.nameClaim).toEqual({ firstName: 'Amaka', lastName: null });
  });

  it('reports a blank-but-present profile name as null too', async () => {
    const status = await readVerificationStatus(deps(subject({ firstName: '   ' })), 'u1');
    expect(status.nameClaim.firstName).toBeNull();
  });

  it('trims a name the sign-up form let through with spaces around it', async () => {
    const status = await readVerificationStatus(deps(subject({ firstName: ' Amaka ' })), 'u1');
    expect(status.nameClaim.firstName).toBe('Amaka');
  });
});
