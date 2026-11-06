// The liveness check. It holds no secret: the selfie is an M20 file reference and the request row
// carries it, so the job payload is a request id and nothing else.
import { classifyLivenessFailure, decideLivenessOutcome } from '../domain/decision.js';
import type { LivenessCheckJob } from '../domain/queues.js';
import { claimRequest, evaluateLevel, pushOutcome, recordCall, timeProviderCall } from './outcome.js';
import type { TrustJobDeps } from './deps.js';

export async function runLivenessCheck(deps: TrustJobDeps, data: LivenessCheckJob): Promise<void> {
  const request = await claimRequest(deps, data.requestId);
  if (!request) return;

  /**
   * Re-read rather than trusted from submission time.
   *
   * The submission checked that an identifier was verified; between then and now it could have been
   * revoked. A liveness check matched against nothing is not a weaker check, it is a meaningless one
   * (§4) — and the correct response is a refusal, not a provider call we would have to pay for and
   * then discard.
   */
  const facts = await deps.store.identityFacts(request.userId);
  const matchedAgainst = facts.latestVerifiedIdentifier;
  if (!matchedAgainst) {
    // The one refusal in this file with exactly one cause, and the one VF1's copy must not blame on
    // lighting — see `describeRejection('LIVENESS_NO_IDENTIFIER')`.
    const reason = 'LIVENESS_NO_IDENTIFIER';
    await deps.store.applyLivenessOutcome({
      request,
      // The row still records WHICH document was expected, so the refusal is legible later. NIN is
      // the placeholder here only because the column is NOT NULL and nothing was verified at all.
      matchedAgainst: 'NIN',
      matchScore: 0,
      livenessPassed: false,
      provider: deps.adapter.provider,
      providerReference: 'not-called',
      requestStatus: 'REJECTED',
      rejectionReason: reason,
    });
    pushOutcome(deps, request, 'REJECTED', 'FAILED');
    return;
  }

  const selfieStorageRef = request.selfieStorageRef;
  if (!selfieStorageRef) throw new Error(`trust: liveness request ${request.id} has no selfie reference`);

  if (!(await deps.store.markProviderPending(request.id, deps.adapter.provider))) {
    deps.logger.info(
      { requestId: request.id },
      'trust: the request was decided before the provider was called',
    );
    return;
  }

  const timed = await timeProviderCall(async () =>
    deps.adapter.checkLiveness({ selfieStorageRef, matchedAgainst }),
  );
  const result = await recordCall(
    deps,
    { requestId: request.id, provider: deps.adapter.provider, callType: 'LIVENESS' },
    timed,
  );

  const decision = decideLivenessOutcome(result.verdict, result.livenessPassed);
  // A code, not the provider's sentence — see the note in run-identity-check.job.ts.
  const rejectionReason = decision.markVerified ? undefined : classifyLivenessFailure(result);
  const applied = await deps.store.applyLivenessOutcome({
    request,
    matchedAgainst,
    matchScore: result.matchScore,
    livenessPassed: result.livenessPassed,
    provider: deps.adapter.provider,
    providerReference: result.providerReference,
    requestStatus: decision.requestStatus,
    ...(rejectionReason === undefined ? {} : { rejectionReason }),
  });

  // Decided elsewhere while the provider answered: grant nothing, and say nothing (see the
  // identity-check job for the full reasoning).
  if (!applied) {
    deps.logger.warn(
      { requestId: request.id },
      'trust: the request was decided elsewhere while the provider was answering; outcome discarded',
    );
    return;
  }

  if (decision.markVerified) await evaluateLevel(deps, request);
  pushOutcome(deps, request, decision.requestStatus, result.verdict);
}
