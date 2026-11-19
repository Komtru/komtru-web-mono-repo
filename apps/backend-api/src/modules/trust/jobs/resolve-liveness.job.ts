// A stored Youverify delivery, turned into a liveness outcome.
//
// This is the other half of `run-liveness-check.job.ts`. That job calls a provider and applies what
// it returns; this one applies what a provider sent us unprompted. Everything after the lookup is
// deliberately the SAME tail — `applyLivenessOutcome`, `evaluateLevel`, `pushOutcome` — because the
// rules about what a liveness verdict means do not change with how it arrived.
//
// It also closes a hole that predates Youverify: until now nothing resumed a PROVIDER_PENDING
// request, so the only exit was the expiry sweep, which publishes `trust.verification.rejected`. A
// provider that took its time read to the user as a refusal.
import type { Db } from '../../../db/index.js';
import { decideLivenessOutcome } from '../domain/decision.js';
import type { ResolveLivenessJob } from '../domain/queues.js';
import {
  claimDelivery,
  findDelivery,
  findRequestBySessionRef,
  finishDelivery,
} from '../infrastructure/postgres/webhooks.js';
import { evaluateLevel, pushOutcome } from './outcome.js';
import type { TrustJobDeps } from './deps.js';

export interface ResolveLivenessDeps extends TrustJobDeps {
  db: Db;
}

/** What Youverify's identity/liveness event carries, read defensively — it crossed the internet. */
interface LivenessPayload {
  data?: { status?: unknown; passed?: unknown; metadata?: { reference?: unknown } };
}

const passed = (payload: LivenessPayload): boolean => {
  const { status, passed: flag } = payload.data ?? {};
  if (typeof flag === 'boolean') return flag;
  // Some events report an outcome word instead of a boolean. Anything we do not recognise is NOT a
  // pass: an unknown status must never grant a level.
  return typeof status === 'string' && ['completed', 'passed', 'approved'].includes(status);
};

export async function resolveLiveness(deps: ResolveLivenessDeps, job: ResolveLivenessJob): Promise<void> {
  const webhookId = BigInt(job.webhookId);

  // Guarded: RECEIVED|FAILED -> PROCESSING. False means another worker holds it, which a redelivered
  // BullMQ job makes ordinary rather than exceptional.
  if (!(await claimDelivery(deps.db, webhookId))) {
    deps.logger.info({ webhookId: job.webhookId }, 'trust: delivery already claimed; nothing to do');
    return;
  }

  try {
    const row = await findDelivery(deps.db, webhookId);
    if (!row) {
      deps.logger.error({ webhookId: job.webhookId }, 'trust: claimed a delivery that vanished');
      return;
    }

    const payload = row.payload as LivenessPayload;
    const reference = payload.data?.metadata?.reference;
    if (typeof reference !== 'string' || reference.length === 0) {
      // Nothing names a request, so nothing ever will. SKIPPED, not FAILED: retrying cannot help.
      await finishDelivery(deps.db, webhookId, 'SKIPPED', 'no metadata.reference on the delivery');
      return;
    }

    const request = await findRequestBySessionRef(deps.db, reference);
    if (!request) {
      // A reference we never minted. Reachable from the internet by anyone guessing, which is why
      // the reference is random — and why this is a quiet refusal rather than an error.
      await finishDelivery(deps.db, webhookId, 'SKIPPED', 'no request matches that reference');
      return;
    }

    if (request.status !== 'PROVIDER_PENDING') {
      // Decided elsewhere while the delivery sat in the queue — most often expired by the sweep.
      // Granting now would resurrect a closed request and contradict what the user was already told.
      await finishDelivery(
        deps.db,
        webhookId,
        'SKIPPED',
        `the request is ${request.status}, not PROVIDER_PENDING`,
      );
      return;
    }

    // Re-read rather than trusted from submission: an identifier verified when the session started
    // could have been revoked since, and §4 forbids a liveness check matched against nothing.
    const facts = await deps.store.identityFacts(request.userId);
    const matchedAgainst = facts.latestVerifiedIdentifier;
    if (!matchedAgainst) {
      await deps.store.applyLivenessOutcome({
        request,
        matchedAgainst: 'NIN',
        matchScore: 0,
        livenessPassed: false,
        provider: deps.adapter.provider,
        providerReference: String(row.providerEventId),
        requestStatus: 'REJECTED',
        rejectionReason: 'LIVENESS_NO_IDENTIFIER',
      });
      pushOutcome(deps, request, 'REJECTED', 'FAILED');
      await finishDelivery(deps.db, webhookId, 'PROCESSED');
      return;
    }

    const livenessPassed = passed(payload);
    const decision = decideLivenessOutcome(livenessPassed ? 'PASSED' : 'FAILED', livenessPassed);
    const applied = await deps.store.applyLivenessOutcome({
      request,
      matchedAgainst,
      // Youverify's liveness events carry a pass/fail, not a similarity score. Recording 100/0
      // rather than inventing a number keeps `match_score` readable as "what the provider said".
      matchScore: livenessPassed ? 100 : 0,
      livenessPassed,
      provider: deps.adapter.provider,
      providerReference: String(row.providerEventId),
      requestStatus: decision.requestStatus,
      ...(decision.markVerified ? {} : { rejectionReason: 'LIVENESS_FAILED' }),
    });

    if (!applied) {
      // Decided between the status check above and this write. Grant nothing, say nothing.
      await finishDelivery(deps.db, webhookId, 'SKIPPED', 'the request was decided concurrently');
      return;
    }

    if (decision.markVerified) await evaluateLevel(deps, request);
    pushOutcome(deps, request, decision.requestStatus, livenessPassed ? 'PASSED' : 'FAILED');
    await finishDelivery(deps.db, webhookId, 'PROCESSED');
  } catch (error) {
    // FAILED, not SKIPPED: this one may well succeed on a retry, and the stale sweep can return it.
    await finishDelivery(deps.db, webhookId, 'FAILED', error instanceof Error ? error.message : 'unknown');
    throw error;
  }
}
