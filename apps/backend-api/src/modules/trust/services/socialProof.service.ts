// The Instagram/X social-proof challenge (M6 §6.6, M1 §7.2): claim a handle, get a code, publish it,
// and ask us to look.
//
// `findKycSelfie` is not involved, no provider attests anything, and no verification level moves. The
// output is a badge on a merchant profile, which is why the claim row is its own small lifecycle
// rather than a `verification_requests` row — see the note on `social_proof_claims`.
import { ApiError } from '../../../platform/errors.js';
import type { Logger } from '../../../platform/logger.js';
import { isUniqueViolation } from '../../../db/errors.js';
import {
  generateChallengeCode,
  isValidHandle,
  normaliseHandle,
  SOCIAL_CHALLENGE_TTL_MS,
} from '../domain/social-proof.js';
import type { SocialProofCheckJob } from '../domain/queues.js';
import type { SocialProofPlatform } from '../infrastructure/postgres/schema/enums.js';
import type { TrustStore } from '../infrastructure/postgres/store.js';
import { assertActive } from './submission.js';

export interface SocialProofDeps {
  store: TrustStore;
  logger: Logger;
}

export interface ClaimHandleInput {
  userId: string;
  platform: SocialProofPlatform;
  handle: string;
}

export interface SocialProofClaimView {
  claimId: string;
  platform: SocialProofPlatform;
  handle: string;
  /** Returned on the claim, and again on a read: the user will close the tab and come back. */
  challengeCode: string;
  verified: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  expiresAt: string;
}

/**
 * How often a claim may be re-checked.
 *
 * A minute. The lookup reaches a third party we have no contract with, and the honest shape of a
 * "check again" button is one the user can press as often as they like without us hammering
 * anybody's servers. It is enforced on `last_checked_at` rather than on a rate limiter alone,
 * because a rate limit is per IP and per user and this is per claim.
 */
const RECHECK_INTERVAL_MS = 60_000;

const expiresAt = (createdAt: Date): string =>
  new Date(createdAt.getTime() + SOCIAL_CHALLENGE_TTL_MS).toISOString();

const view = (claim: {
  id: string;
  platform: SocialProofPlatform;
  handle: string;
  challengeCode: string;
  verified: boolean;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
}): SocialProofClaimView => ({
  claimId: claim.id,
  platform: claim.platform,
  handle: claim.handle,
  challengeCode: claim.challengeCode,
  verified: claim.verified,
  verifiedAt: claim.verifiedAt?.toISOString() ?? null,
  lastCheckedAt: claim.lastCheckedAt?.toISOString() ?? null,
  expiresAt: expiresAt(claim.createdAt),
});

export async function claimSocialHandle(
  deps: SocialProofDeps,
  input: ClaimHandleInput,
): Promise<SocialProofClaimView> {
  assertActive(await deps.store.findSubject(input.userId));

  const handle = normaliseHandle(input.handle);
  if (!isValidHandle(handle)) {
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'That handle does not look right',
      'A handle is letters, digits, dots and underscores — no spaces, and no full web address.',
      [{ path: 'handle', message: 'must be a handle, not a URL' }],
    );
  }

  try {
    const claim = await deps.store.createSocialProofClaim({
      userId: input.userId,
      platform: input.platform,
      handle,
      challengeCode: generateChallengeCode(),
    });
    return view(claim);
  } catch (error) {
    /**
     * Someone else has already proved this handle.
     *
     * A 409 rather than a quiet second claim, because the handle is the thing a buyer recognises: two
     * sellers both wearing a verified `@techedge_ng` badge is worse than no badge at all. It does not
     * say WHO holds it — that would turn the endpoint into a lookup from handle to account.
     */
    if (isUniqueViolation(error, 'social_proof_claims_platform_handle')) {
      throw new ApiError(
        409,
        'CONFLICT',
        'That handle is already verified on another account',
        'If it is yours, contact support and we will sort it out.',
      );
    }
    if (isUniqueViolation(error, 'social_proof_claims_user_platform')) {
      throw new ApiError(
        409,
        'CONFLICT',
        `Your ${input.platform === 'X' ? 'X' : 'Instagram'} handle is already verified`,
        'There is nothing more to do for this one.',
      );
    }
    throw error;
  }
}

export interface ConfirmClaimResult {
  claimId: string;
  job: SocialProofCheckJob;
}

/**
 * "I have put the code up — go and look."
 *
 * The lookup itself is a job, because it is external I/O and must not run on a request handler. So
 * this returns a job for the controller to enqueue and the socket carries the answer, exactly as the
 * identity checks do.
 */
export async function requestSocialProofCheck(
  deps: SocialProofDeps,
  input: { userId: string; claimId: string },
): Promise<ConfirmClaimResult> {
  assertActive(await deps.store.findSubject(input.userId));

  const claim = await deps.store.findSocialProofClaim(input.claimId);
  // Someone else's claim is the same 404 as a missing one: a distinguishable response is a lookup
  // from claim id to "this exists but is not yours".
  if (!claim || claim.userId !== input.userId) {
    throw new ApiError(404, 'NOT_FOUND', 'We could not find that claim');
  }
  if (claim.verified) {
    throw new ApiError(
      409,
      'CONFLICT',
      'That handle is already verified',
      'There is nothing more to do for this one.',
    );
  }
  if (Date.now() - claim.createdAt.getTime() > SOCIAL_CHALLENGE_TTL_MS) {
    throw new ApiError(
      409,
      'CHALLENGE_EXPIRED',
      'That code has expired',
      'Start again and we will give you a fresh one — a code that stays valid for weeks does not prove much.',
    );
  }
  if (claim.lastCheckedAt && Date.now() - claim.lastCheckedAt.getTime() < RECHECK_INTERVAL_MS) {
    throw new ApiError(
      429,
      'TOO_MANY_REQUESTS',
      'We just checked',
      'Give it a minute and try again — it can take a moment for a profile change to appear.',
    );
  }

  return { claimId: claim.id, job: { claimId: claim.id } };
}

/**
 * The caller's own claims.
 *
 * Bounded by `social_proof_claims_user_platform` to the two platforms that exist, plus whatever
 * abandoned unverified attempts they made, so it is capped by the rate limit rather than by a page.
 * It is still declared `paginated: 'page'` on the route — the invariant does not take "it is small"
 * for an answer, and it is right not to.
 */
export async function listSocialProof(
  deps: SocialProofDeps,
  userId: string,
): Promise<SocialProofClaimView[]> {
  const claims = await deps.store.listSocialProofClaims(userId);
  return claims.map(view);
}
