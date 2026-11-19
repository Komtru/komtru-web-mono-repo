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
export interface LivenessPayload {
  data?: { status?: unknown; passed?: unknown; metadata?: { reference?: unknown } };
}

/**
 * Three values, because "not a pass" and "a failure" are different things and only one is terminal.
 *
 * The first version of this was two-valued, and it was wrong in both directions at once:
 *
 *  - `completed` sat in the pass list. That is a LIFECYCLE word — the modal closed — and it is
 *    exactly what D2 says must never be trusted as a verdict. A spoofed check that Youverify
 *    reported as finished-and-failed would have been read as finished-therefore-passed, and
 *    granted level 2.
 *  - everything unrecognised became `FAILED`, which is terminal and visible. A hosted flow emits
 *    progress events, so the first `pending` carrying our reference would have REJECTED a user who
 *    was still holding their phone to the camera, and the real verdict arriving seconds later would
 *    find the request already decided and be discarded.
 *
 * `NO_VERDICT` is the honest third answer: leave the request PROVIDER_PENDING, which is what D3
 * says PENDING is for, and let the real verdict — or the expiry sweep — settle it.
 */
export type DeliveryVerdict = 'PASSED' | 'FAILED' | 'NO_VERDICT';

/** Words that are a verdict. Lifecycle words are deliberately absent from both lists. */
const PASS_WORDS = ['passed', 'approved', 'successful'];
const FAIL_WORDS = ['failed', 'rejected', 'declined', 'spoof_detected'];

export function readDeliveryVerdict(payload: LivenessPayload): DeliveryVerdict {
  const { status, passed } = payload.data ?? {};
  // The boolean is the provider's own answer and outranks any word that disagrees with it.
  if (typeof passed === 'boolean') return passed ? 'PASSED' : 'FAILED';
  if (typeof status === 'string') {
    const word = status.toLowerCase();
    if (PASS_WORDS.includes(word)) return 'PASSED';
    if (FAIL_WORDS.includes(word)) return 'FAILED';
  }
  return 'NO_VERDICT';
}

/**
 * Whether this delivery is even about a liveness check.
 *
 * Youverify sends alerts, client events and transaction events down the same webhook. Without this
 * a signed `tm.alert.created` carrying a known reference would be read as a verdict about a face.
 */
export function isLivenessEvent(eventType: string): boolean {
  const type = eventType.toLowerCase();
  return type.startsWith('identity.') || type.startsWith('liveness.');
}

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
      // The one write in this file that used to discard its guard's answer: if the sweep closed
      // the request a moment ago the store rolls back, and telling the user they were rejected
      // anyway would contradict what they were already shown.
      const refused = await deps.store.applyLivenessOutcome({
        request,
        matchedAgainst: 'NIN',
        matchScore: 0,
        livenessPassed: false,
        provider: deps.adapter.provider,
        providerReference: String(row.providerEventId),
        requestStatus: 'REJECTED',
        rejectionReason: 'LIVENESS_NO_IDENTIFIER',
      });
      if (refused) pushOutcome(deps, request, 'REJECTED', 'FAILED');
      await finishDelivery(deps.db, webhookId, refused ? 'PROCESSED' : 'SKIPPED');
      return;
    }

    if (!isLivenessEvent(row.eventType)) {
      await finishDelivery(deps.db, webhookId, 'SKIPPED', `${row.eventType} is not a liveness event`);
      return;
    }

    const verdict = readDeliveryVerdict(payload);
    if (verdict === 'NO_VERDICT') {
      // A progress event, or a shape we have never seen. Record it and leave the request open: the
      // real verdict is still coming, and the expiry sweep is the floor underneath that.
      await finishDelivery(deps.db, webhookId, 'SKIPPED', 'the delivery carried no verdict');
      return;
    }

    const livenessPassed = verdict === 'PASSED';
    /*
      `matchedAgainst` records which document the selfie was matched to. Until spec §10 question 3
      is answered it may be recording an intent rather than an event — see `matchScore` below. It
      is still written, because §4 requires a liveness check to HAVE something to match and this is
      the record of what that was.
    */
    const decision = decideLivenessOutcome(verdict, livenessPassed);
    const applied = await deps.store.applyLivenessOutcome({
      request,
      matchedAgainst,
      /*
        Zero, always, and the column is the wrong shape for what this provider returns.

        `match_score` is M6 §6.4's similarity between a selfie and an identity document's photo.
        Youverify's liveness module reports a pass/fail, carries no score, and — per spec §10
        question 3, which is still unanswered — may be a PRESENCE check that never compares a face
        to the NIN photo at all. Writing 100 on a pass asserted a comparison nobody performed, in
        the row an investigator would later read as proof it was performed. A real score goes here
        the day the entitlement question is answered and the provider sends one.
      */
      matchScore: 0,
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
