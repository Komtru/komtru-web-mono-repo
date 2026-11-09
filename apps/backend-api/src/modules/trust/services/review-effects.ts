// What a person's decision does to the records, shared by the queue (`review.service.ts`) and the
// duplicate flags (`duplicate.service.ts`). Everything here runs inside the caller's transaction, so a
// decision, its effect on the request and the level that follows commit or roll back together.
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../../../db/errors.js';
import { ApiError } from '../../../platform/errors.js';
import type { Tx } from '../../../platform/events/publish.js';
import { earnedBusinessLevel, earnedIdentityLevel } from '../domain/levels.js';
import { BUSINESS_VERIFIED_LEVEL, IDENTITY_VERIFIED_LEVEL } from '../domain/levels.js';
import type { RejectionCode } from '../domain/rejection.js';
import { bindStore } from '../infrastructure/postgres/bind-store.js';
import { publishRejected } from '../infrastructure/postgres/review.js';
import { businessVerifications } from '../infrastructure/postgres/schema/business.js';
import { addressChecks } from '../infrastructure/postgres/schema/documents.js';
import { bvnVerifications, ninVerifications } from '../infrastructure/postgres/schema/identity-checks.js';
import {
  verificationRequests,
  type VerificationRequest,
} from '../infrastructure/postgres/schema/requests.js';

export const notInReview = () =>
  new ApiError(409, 'CONFLICT', 'That request is not waiting for review', 'It has already been decided.');

/** Locks the request. Only a MANUAL_REVIEW request can be decided by a person. */
export async function lockReviewRequest(tx: Tx, requestId: string): Promise<VerificationRequest> {
  const [row] = await tx
    .select()
    .from(verificationRequests)
    .where(eq(verificationRequests.id, requestId))
    .for('update');
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'No such verification request');
  if (row.status !== 'MANUAL_REVIEW') throw notInReview();
  return row;
}

const alreadyClaimed = () =>
  new ApiError(
    409,
    'CONFLICT',
    'That identifier is already verified on another account',
    'Resolve the duplicate flag for this request instead.',
  );

/**
 * Marks the request APPROVED and the evidence behind it verified. `provider` is `MANUAL`: the grant
 * rests on a person's word, and the column that says which levels were attested by whom must say so.
 */
export async function approveRequest(
  tx: Tx,
  request: VerificationRequest,
  actorUserId: string,
): Promise<void> {
  try {
    if (request.verificationType === 'NIN') {
      await tx
        .update(ninVerifications)
        .set({ verifiedAt: sql`now()` })
        .where(eq(ninVerifications.requestId, request.id));
    } else if (request.verificationType === 'BVN') {
      await tx
        .update(bvnVerifications)
        .set({ verifiedAt: sql`now()` })
        .where(eq(bvnVerifications.requestId, request.id));
    } else if (request.verificationType === 'CAC') {
      await tx
        .update(businessVerifications)
        .set({ verifiedAt: sql`now()` })
        .where(eq(businessVerifications.requestId, request.id));
    } else if (request.verificationType === 'ADDRESS') {
      await tx.update(addressChecks).set({ passed: true }).where(eq(addressChecks.requestId, request.id));
    }
  } catch (error) {
    if (
      isUniqueViolation(error, 'nin_verifications_hash_active_unique') ||
      isUniqueViolation(error, 'bvn_verifications_hash_active_unique') ||
      isUniqueViolation(error, 'business_verifications_user_active_unique')
    ) {
      throw alreadyClaimed();
    }
    throw error;
  }

  await tx
    .update(verificationRequests)
    .set({ status: 'APPROVED', provider: 'MANUAL', rejectionReason: null, decidedAt: sql`now()` })
    .where(eq(verificationRequests.id, request.id));
  await evaluateLevels(tx, request.userId, request.id, actorUserId);
}

export async function rejectRequest(
  tx: Tx,
  request: VerificationRequest,
  code: RejectionCode,
): Promise<void> {
  await tx
    .update(verificationRequests)
    .set({ status: 'REJECTED', rejectionReason: code, decidedAt: sql`now()` })
    .where(eq(verificationRequests.id, request.id));
  if (request.verificationType === 'ADDRESS') {
    await tx.update(addressChecks).set({ passed: false }).where(eq(addressChecks.requestId, request.id));
  }
  await publishRejected(tx, {
    payload: {
      requestId: request.id,
      userId: request.userId,
      type: request.verificationType,
      reason: code,
      attemptCount: request.attemptCount,
    },
    aggregateType: 'verification_request',
    aggregateId: request.id,
  });
}

/**
 * The same two level rules the jobs apply (§4), re-read from the database. Written again here rather
 * than imported from `jobs/outcome.ts` because a service that reaches into `jobs/` is one import away
 * from a request handler that can reach the provider adapter (T-028).
 */
export async function evaluateLevels(
  tx: Tx,
  userId: string,
  requestId: string,
  actorUserId: string,
): Promise<void> {
  const store = bindStore(tx);
  const grant = {
    userId,
    actorType: 'KYC_ANALYST' as const,
    actorId: actorUserId,
    triggeringRequestId: requestId,
    provider: 'MANUAL' as const,
  };
  const identity = await store.identityFacts(userId);
  if (earnedIdentityLevel(identity)) {
    await store.grantLevel({
      ...grant,
      toLevel: IDENTITY_VERIFIED_LEVEL,
      reason: 'A verified identity number and a passed liveness check, confirmed by a reviewer',
    });
  }
  const business = await store.businessFacts(userId);
  if (earnedBusinessLevel(business)) {
    await store.grantLevel({
      ...grant,
      toLevel: BUSINESS_VERIFIED_LEVEL,
      reason: 'A verified CAC registration and a business bank account in its name, confirmed by a reviewer',
    });
  }
}

/**
 * Takes an identifier away from the account that held it first (§7: the original account was
 * abandoned, or NIMC reassigned the number), and drops that account's level if it no longer earns it.
 * Reached only through a dual-approved clearance.
 */
export async function releaseFirstOwner(
  tx: Tx,
  input: {
    type: 'NIN' | 'BVN' | 'CAC';
    firstUserId: string;
    conflictingRequestId: string;
    actorUserId: string;
    reason: string;
  },
): Promise<void> {
  const store = bindStore(tx);
  // The hash comes from the conflicting request's own row, not from the flag: erasure scrubs the
  // flag's copy (T-039), and an open flag must stay decidable afterwards.
  if (input.type === 'NIN') {
    const [claimed] = await tx
      .select({ hash: ninVerifications.ninHash })
      .from(ninVerifications)
      .where(eq(ninVerifications.requestId, input.conflictingRequestId));
    if (claimed) {
      await tx
        .update(ninVerifications)
        .set({ verifiedAt: null })
        .where(
          and(
            eq(ninVerifications.userId, input.firstUserId),
            eq(ninVerifications.ninHash, claimed.hash),
            isNotNull(ninVerifications.verifiedAt),
          ),
        );
    }
  } else if (input.type === 'BVN') {
    const [claimed] = await tx
      .select({ hash: bvnVerifications.bvnHash })
      .from(bvnVerifications)
      .where(eq(bvnVerifications.requestId, input.conflictingRequestId));
    if (claimed) {
      await tx
        .update(bvnVerifications)
        .set({ verifiedAt: null })
        .where(
          and(
            eq(bvnVerifications.userId, input.firstUserId),
            eq(bvnVerifications.bvnHash, claimed.hash),
            isNotNull(bvnVerifications.verifiedAt),
          ),
        );
    }
  } else {
    const [claimed] = await tx
      .select({ rc: businessVerifications.cacRcNumber })
      .from(businessVerifications)
      .where(eq(businessVerifications.requestId, input.conflictingRequestId));
    if (claimed) {
      await tx
        .update(businessVerifications)
        .set({ verifiedAt: null })
        .where(
          and(
            eq(businessVerifications.userId, input.firstUserId),
            eq(businessVerifications.cacRcNumber, claimed.rc),
            isNotNull(businessVerifications.verifiedAt),
          ),
        );
    }
  }

  const revoke = { userId: input.firstUserId, actorType: 'KYC_ANALYST' as const, actorId: input.actorUserId };
  // What is dropped depends on what the identifier was holding up, and is decided from the first
  // account's facts AS THEY ARE NOW (after the release above), never from the flag's age:
  //   CAC      -> level 3 rests on the registration, so the account falls back to level 2 (its NIN/BVN
  //               and liveness are untouched), and only if it no longer earns level 3 some other way.
  //   NIN/BVN  -> level 2 rests on a verified number plus liveness, so the account falls to level 1,
  //               and only if it no longer earns level 2 (e.g. it still holds the other number).
  // `revokeLevel` locks the user row and does nothing when the account is already at or below the
  // target, so an account that has meanwhile been revoked or downgraded is left alone.
  if (input.type === 'CAC') {
    const business = await store.businessFacts(input.firstUserId);
    if (!earnedBusinessLevel(business)) {
      await store.revokeLevel({ ...revoke, toLevel: IDENTITY_VERIFIED_LEVEL, reason: input.reason });
    }
    return;
  }
  const identity = await store.identityFacts(input.firstUserId);
  if (!earnedIdentityLevel(identity)) {
    await store.revokeLevel({ ...revoke, toLevel: IDENTITY_VERIFIED_LEVEL - 1, reason: input.reason });
  }
}
