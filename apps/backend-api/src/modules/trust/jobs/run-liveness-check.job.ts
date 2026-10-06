// The liveness check. It holds no secret: the selfie is an M20 file reference and the request row
// carries it, so the job payload is a request id and nothing else.
import { decideLivenessOutcome } from '../domain/decision.js';
import type { LivenessCheckJob } from '../domain/queues.js';
import {
  claimRequest,
  evaluateLevel,
  pushOutcome,
  recordCall,
  timeProviderCall,
} from '../services/outcome.service.js';
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
    const reason = 'There is no verified NIN or BVN to match this photo against';
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

  await deps.store.markProviderPending(request.id, deps.adapter.provider);

  const timed = await timeProviderCall(async () =>
    deps.adapter.checkLiveness({ selfieStorageRef, matchedAgainst }),
  );
  const result = await recordCall(
    deps,
    { requestId: request.id, provider: deps.adapter.provider, callType: 'LIVENESS' },
    timed,
  );

  const decision = decideLivenessOutcome(result.verdict, result.livenessPassed);
  await deps.store.applyLivenessOutcome({
    request,
    matchedAgainst,
    matchScore: result.matchScore,
    livenessPassed: result.livenessPassed,
    provider: deps.adapter.provider,
    providerReference: result.providerReference,
    requestStatus: decision.requestStatus,
    ...(result.failureReason === undefined ? {} : { rejectionReason: result.failureReason }),
  });

  if (decision.markVerified) await evaluateLevel(deps, request);
  pushOutcome(deps, request, decision.requestStatus, result.verdict);
}
