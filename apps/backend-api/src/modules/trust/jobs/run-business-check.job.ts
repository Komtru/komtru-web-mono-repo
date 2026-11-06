// The CAC check (M6 §4's level-3 first requirement, screens SO3 and M2).
//
// Shaped like the identity job, with one structural difference worth reading: §7's duplicate branch
// is asked BEFORE the write rather than caught after it. For a NIN the uniqueness index is the
// mechanism and the catch is the backstop; for a CAC registration there is deliberately no such
// index — §6.5 is explicit that one RC number legitimately backs several staff accounts under M5's
// `merchant_staff` model, and that re-registration happens — so "is this already another, unrelated
// merchant's verified business" is a question, not a constraint violation.
import { z } from 'zod';
import { isUniqueViolation } from '../../../db/errors.js';
import { classifyBusinessFailure, decideBusinessOutcome } from '../domain/decision.js';
import { normaliseRcNumber, rcNumberHash } from '../domain/identifiers.js';
import type { BusinessCheckJob } from '../domain/queues.js';
import type { BusinessCheckResult } from '../domain/provider.js';
import type { VerificationRequest } from '../infrastructure/postgres/schema/requests.js';
import { claimRequest, evaluateBusinessLevel, pushOutcome, recordCall, timeProviderCall } from './outcome.js';
import type { TrustJobDeps } from './deps.js';

/** Parsed rather than cast: the sealed blob is this program's own, but an unsealed shape is not typed. */
const claimSchema = z.object({
  rcNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

export async function runBusinessCheck(deps: TrustJobDeps, data: BusinessCheckJob): Promise<void> {
  const request = await claimRequest(deps, data.requestId);
  if (!request) return;
  if (request.verificationType !== 'CAC') {
    throw new Error(`trust: ${request.verificationType} is not a business check`);
  }

  const claim = claimSchema.parse(JSON.parse(deps.encryption.decrypt(data.sealed)));
  // Normalised again here rather than trusted from the submission: §7's duplicate check compares
  // strings, and `RC 1487322` reaching the column beside `1487322` makes it silently stop finding
  // anything — a failure with no symptom until a suspended merchant is trading under a second
  // account. The service normalises too; this is the one that the stored value comes from.
  const rcNumber = normaliseRcNumber(claim.rcNumber);

  if (!(await deps.store.markProviderPending(request.id, deps.adapter.provider))) {
    deps.logger.info(
      { requestId: request.id },
      'trust: the request was decided before the provider was called',
    );
    return;
  }

  const timed = await timeProviderCall(async () =>
    deps.adapter.verifyBusiness({ rcNumber, firstName: claim.firstName, lastName: claim.lastName }),
  );
  const result = await recordCall(
    deps,
    { requestId: request.id, provider: deps.adapter.provider, callType: 'CAC' },
    timed,
  );

  await applyOutcome(deps, request, rcNumber, result);
}

async function settleOwnVerified(
  deps: TrustJobDeps,
  request: VerificationRequest,
  result: BusinessCheckResult,
): Promise<void> {
  if (
    !(await deps.store.settleAlreadyVerified({
      request,
      provider: deps.adapter.provider,
      providerReference: result.providerReference,
    }))
  ) {
    return;
  }
  // Re-evaluated rather than assumed: the bank match may have landed since the first CAC did.
  await evaluateBusinessLevel(deps, request);
  pushOutcome(deps, request, 'APPROVED', result.verdict);
}

async function applyOutcome(
  deps: TrustJobDeps,
  request: VerificationRequest,
  rcNumber: string,
  result: BusinessCheckResult,
): Promise<void> {
  const decision = decideBusinessOutcome(result);
  const shared = {
    request,
    cacRcNumber: rcNumber,
    // The provider's name for the business when it gave one; the number itself when it did not. The
    // column is NOT NULL, and a rejected row still has to say what was asked about.
    registeredBusinessName: result.registeredBusinessName ?? rcNumber,
    ...(result.businessType === undefined ? {} : { businessType: result.businessType }),
    ...(result.cacStatus === undefined ? {} : { cacStatus: result.cacStatus }),
    ...(result.officersMatch === undefined ? {} : { officersMatch: result.officersMatch }),
    provider: deps.adapter.provider,
    providerReference: result.providerReference,
    requestStatus: decision.requestStatus,
    markVerified: decision.markVerified,
    // A CODE, never the provider's sentence (see run-identity-check.job.ts).
    ...(decision.markVerified ? {} : { rejectionReason: classifyBusinessFailure(result) }),
  };

  /**
   * §7's CAC branch, asked only when the registration is about to be CLAIMED.
   *
   * A rejected attempt must not consult it: the question is "who holds this as their verified
   * business", and a fraudster's failed guess at a real company's RC number should produce a
   * rejection, not a review case against the real company.
   */
  if (decision.markVerified) {
    const owner = await deps.store.findBusinessOwner(rcNumber);
    /**
     * `owner.userId === request.userId` is NOT a duplicate, and is not a second row either.
     *
     * It is the submitter's own verified business, re-submitted — a double tap. The submission
     * service refuses that with a 409, so reaching here means the first verification landed in
     * between, and `business_verifications_user_active_unique` would refuse a second verified row
     * anyway: one verified business per account, so a second CAC cannot quietly replace the one a
     * level-3 grant was made on. So the first row stays the record and this request is simply
     * settled, exactly as `settleAlreadyVerified` does on the identity path.
     *
     * Treating it as a DUPLICATE instead would raise a fraud signal to Risk about an innocent
     * person and park the request in MANUAL_REVIEW, which the expiry sweep deliberately skips and
     * which nothing can clear until T-052 ships.
     */
    if (owner && owner.userId === request.userId) {
      await settleOwnVerified(deps, request, result);
      return;
    }

    if (owner) {
      const applied = await deps.store.applyDuplicateBusiness({
        ...shared,
        requestStatus: 'MANUAL_REVIEW',
        markVerified: false,
        firstUserId: owner.userId,
        rcNumberHashHex: rcNumberHash(deps.hasher, rcNumber).toString('hex'),
      });
      if (!applied) return;
      deps.logger.warn(
        { requestId: request.id, firstUserId: owner.userId },
        'trust: a CAC registration already verified on another account; sent for review',
      );
      pushOutcome(deps, request, 'MANUAL_REVIEW', result.verdict);
      return;
    }
  }

  let applied: boolean;
  try {
    applied = await deps.store.applyBusinessOutcome(shared);
  } catch (error) {
    /**
     * The backstop for the same double tap: the owner read above can miss a verification that lands
     * between it and this write. Rethrowing would make BullMQ retry and re-call (and re-bill) the
     * provider for an answer already on file, so the request is settled as already verified instead.
     */
    if (!isUniqueViolation(error, 'business_verifications_user_active_unique')) throw error;
    await settleOwnVerified(deps, request, result);
    return;
  }
  /**
   * The request left the open set while the provider was answering.
   *
   * Granting a level, or telling the user they passed, on a request the sweep already closed is the
   * one outcome `expireStale` exists to prevent — so this path does neither.
   */
  if (!applied) {
    deps.logger.warn(
      { requestId: request.id },
      'trust: the request was decided elsewhere while the provider was answering; outcome discarded',
    );
    return;
  }

  // Re-evaluated even though a CAC alone is never level 3: the bank match may already be on file
  // from an earlier attempt whose CAC was later revoked and has now been re-verified.
  if (decision.markVerified) await evaluateBusinessLevel(deps, request);
  pushOutcome(deps, request, decision.requestStatus, result.verdict);
}
