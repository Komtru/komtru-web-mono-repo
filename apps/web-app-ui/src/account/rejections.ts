import type { VerificationRejection, VerificationStatus } from '@komtru/api-client';

/**
 * A rejection is the platform's latest word on a check only until a newer attempt of the same kind is on its way; after a
 * resubmission the old failure stops being the answer, and showing it above "we're checking" would say two things.
 */
export function activeRejections(status: VerificationStatus): VerificationRejection[] {
  return status.rejections.filter(
    (rejection) =>
      !status.inFlight.some(
        (request) =>
          request.type === rejection.type &&
          (rejection.decidedAt === null || request.submittedAt > rejection.decidedAt),
      ),
  );
}
