// "I have put the code up — go and look."
//
// The only job in this module that touches neither a KYC provider nor a verification level: a social
// proof claim has its own small lifecycle (see `social_proof_claims`), and what it produces is a
// badge on a merchant profile. It still runs as a job, because reading somebody's public profile is
// external I/O and must not happen on a request handler.
import { isUniqueViolation } from '../../../db/errors.js';
import type { Logger } from '../../../platform/logger.js';
import type { SocketGateway } from '../../socket/index.js';
import { SOCIAL_PROOF_SOCKET_EVENT, type SocialProofCheckJob } from '../domain/queues.js';
import type { SocialProofAdapter } from '../domain/social-proof.js';
import type { RejectionCode } from '../domain/rejection.js';
import { SOCIAL_CHALLENGE_TTL_MS } from '../domain/social-proof.js';
import type { TrustStore } from '../infrastructure/postgres/store.js';

/**
 * Narrower than `TrustJobDeps`, which carries a `KycProviderAdapter` this job has no business
 * holding — a job that cannot reach the KYC adapter cannot accidentally spend a billed call.
 */
export interface SocialProofJobDeps {
  store: TrustStore;
  social: SocialProofAdapter;
  gateway: SocketGateway;
  logger: Logger;
}

/**
 * The two "no" answers, kept apart.
 *
 * "Check the spelling" and "put the code up and try again" are different instructions, and
 * collapsing them into one is how a seller spends twenty minutes editing the bio of an account whose
 * handle they mistyped.
 */
const REASON: Record<'NOT_FOUND' | 'NO_CODE', RejectionCode> = {
  NOT_FOUND: 'SOCIAL_HANDLE_NOT_FOUND',
  NO_CODE: 'SOCIAL_CHALLENGE_NOT_FOUND',
};

export async function runSocialProofCheck(
  deps: SocialProofJobDeps,
  data: SocialProofCheckJob,
): Promise<void> {
  const claim = await deps.store.findSocialProofClaim(data.claimId);
  if (!claim) {
    deps.logger.warn({ claimId: data.claimId }, 'trust: a social proof job ran for a claim that has gone');
    return;
  }
  // Already proved. BullMQ is at-least-once, so a redelivery is ordinary rather than exceptional,
  // and looking the profile up again would be a request to a third party for an answer on file.
  if (claim.verified) {
    deps.logger.debug({ claimId: claim.id }, 'trust: the social proof claim is already verified');
    return;
  }
  if (Date.now() - claim.createdAt.getTime() > SOCIAL_CHALLENGE_TTL_MS) {
    deps.logger.info(
      { claimId: claim.id },
      'trust: the social proof challenge expired before it was checked',
    );
    return;
  }

  const result = await deps.social.lookup({
    platform: claim.platform,
    handle: claim.handle,
    challengeCode: claim.challengeCode,
  });

  /**
   * `INDETERMINATE` is thrown, not recorded.
   *
   * It means the platform did not answer — rate-limited us, or changed its page — which is not the
   * user's fault and is not a verdict. Writing it as "not verified" would move `last_checked_at`,
   * start the user's one-minute cooldown, and tell them their code was not found when nobody looked.
   * A throw is a BullMQ retry instead.
   */
  if (result.outcome === 'INDETERMINATE') {
    throw new Error(`trust: the ${claim.platform} lookup for claim ${claim.id} was indeterminate`);
  }

  // Narrowed off `result.outcome` rather than off the boolean: the compiler cannot see that
  // `verified === false` implies the outcome is one of the two REASON knows, and a cast to make it
  // believe so is a cast that stops catching a fifth outcome being added later.
  const reason = result.outcome === 'CODE_PRESENT' ? undefined : REASON[result.outcome];
  const verified = reason === undefined;
  // `last_checked_at` moves on EVERY settled lookup, pass or fail — it is what rate-limits the
  // re-check, and a failure that left it untouched is a free retry loop against a third party.
  /**
   * The index is the enforcement point, so the violation is caught rather than prevented.
   *
   * `claimSocialHandle` already refuses a handle somebody else has proved, which handles every
   * ordinary case. What is left is the race: two users publishing the same handle's code and both
   * jobs running before either committed. `social_proof_claims_platform_handle` lets exactly one
   * through, and the loser must not fail the job forever — so it is settled as not verified, which
   * moves `last_checked_at` and applies the cooldown like any other unsuccessful lookup.
   *
   * No reason is attached: the taxonomy in `domain/rejection.ts` comes from BVR1 and VF1 and has no
   * member for this, and inventing one to cover a race would be inventing the part of the taxonomy
   * the ticket says not to invent. The claim simply reads as unverified on the list endpoint.
   */
  let settled: boolean;
  try {
    settled = await deps.store.settleSocialProofClaim({ claimId: claim.id, verified });
  } catch (error) {
    if (!isUniqueViolation(error, 'social_proof_claims_platform_handle')) throw error;
    deps.logger.warn(
      { claimId: claim.id, platform: claim.platform },
      'trust: the handle was proved on another account first; this claim stays unverified',
    );
    settled = await deps.store.settleSocialProofClaim({ claimId: claim.id, verified: false });
    return;
  }
  if (!settled) {
    deps.logger.info({ claimId: claim.id }, 'trust: the social proof claim was settled elsewhere');
    return;
  }

  if (verified) {
    deps.logger.info(
      { claimId: claim.id, platform: claim.platform, foundIn: result.foundIn },
      'trust: a social proof claim was verified',
    );
  }

  /**
   * Its own socket event, never `verification:updated`.
   *
   * That one carries a `requestId` and a `verification_request_status`, and a claim has neither —
   * pushing a claim id through a field every client reads as a request id is the kind of overload
   * that is free today and a bug the first time somebody looks the request up.
   *
   * Never throws: the outcome is committed, and a failed emit must not burn a retry.
   */
  try {
    deps.gateway.emitToUser(claim.userId, SOCIAL_PROOF_SOCKET_EVENT, {
      claimId: claim.id,
      platform: claim.platform,
      handle: claim.handle,
      verified,
      ...(reason === undefined ? {} : { reason }),
    });
  } catch (error) {
    deps.logger.error(
      { err: error, claimId: claim.id },
      'trust: the social proof outcome could not be pushed; the list endpoint still has it',
    );
  }
}
