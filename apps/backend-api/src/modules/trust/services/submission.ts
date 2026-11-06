// What every submission in this module does before it writes anything: prove the caller is a real,
// active account, and translate the one-in-flight index into a 409 the user can act on.
//
// It was inlined in `verification.service.ts` while that was the only submitter. T-051 adds three
// more, and the two pieces that must NOT be reimplemented per check are these: the eligibility
// ladder (a second copy drifts, and the drift shows up as a suspended account being allowed to
// verify something) and the in-flight message split (a user waiting on a human must not be told to
// try again shortly).
import { ApiError } from '../../../platform/errors.js';
import { contactVerificationRequired } from '../domain/errors.js';
import { levelNumber } from '../domain/levels.js';
import type { VerificationType } from '../infrastructure/postgres/schema/enums.js';
import type { TrustStore, VerificationSubject } from '../infrastructure/postgres/store.js';

/** M6 §2: a verified email and phone come first. Level 1 is identity's to grant, not ours to skip. */
const CONTACT_VERIFIED_LEVEL = 1;

export function assertActive(subject: VerificationSubject | undefined): VerificationSubject {
  // A principal the database no longer knows is not a 404 — the caller's session resolved against a
  // row that has since gone, and "sign in again" is the only honest answer.
  if (!subject) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to verify your identity');
  if (subject.status !== 'ACTIVE') {
    throw new ApiError(403, 'FORBIDDEN', 'This account cannot start a verification right now');
  }
  return subject;
}

export function assertContactVerified(subject: VerificationSubject): VerificationSubject {
  if (levelNumber(subject.verificationLevel) < CONTACT_VERIFIED_LEVEL) throw contactVerificationRequired();
  return subject;
}

/**
 * Two different 409s, because they are two different situations for the person reading them.
 *
 * A request waiting on a provider really will produce a result shortly. One in MANUAL_REVIEW will
 * not: it is waiting on a human, the expiry sweep deliberately skips it, and until T-052 ships the
 * queue there is nobody to clear it. Telling that user "you will get a result shortly" is a
 * falsehood they will act on by retrying, which is the worst possible advice.
 */
export async function inFlightConflict(
  store: TrustStore,
  userId: string,
  verificationType: VerificationType,
): Promise<ApiError> {
  const open = await store.listOpenRequests(userId);
  const blocking = open.find((request) => request.verificationType === verificationType);
  if (blocking?.status === 'MANUAL_REVIEW') {
    return new ApiError(
      409,
      'CONFLICT',
      'That check is with our team',
      'Someone is reviewing your last submission by hand. Contact support if you have been waiting a while.',
    );
  }
  return new ApiError(
    409,
    'CONFLICT',
    'That check is already running',
    'We are still working on your last submission. You will get a result shortly.',
  );
}
