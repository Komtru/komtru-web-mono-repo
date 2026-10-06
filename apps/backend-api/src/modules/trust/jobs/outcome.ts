// What the jobs share: the terminal-status guard, the provider call log, the level re-evaluation,
// and the push. One copy, because the identity check and the liveness check differ only in which
// provider method they call and which table the answer lands in.
//
// It lives in `jobs/` rather than `services/` because that is what it is. An earlier version sat in
// `services/` and imported `jobs/deps.js` for `TrustJobDeps` — which the T-028 scanner flagged as
// `jobs-outside-jobs`, and rightly: a service that can reach a type carrying the provider adapter is
// one import away from a request handler that can reach the adapter itself. Nothing on the request
// path calls any of this.
import { isUniqueViolation } from '../../../db/errors.js';
import { earnedIdentityLevel, IDENTITY_VERIFIED_LEVEL } from '../domain/levels.js';
import type { CheckVerdict } from '../domain/provider.js';
import type { IdentifierType, VerificationRequestStatus } from '../infrastructure/postgres/schema/enums.js';
import type { VerificationRequest } from '../infrastructure/postgres/schema/requests.js';
import type { ProviderCallInput } from '../infrastructure/postgres/store.js';
import { VERIFICATION_SOCKET_EVENT } from '../domain/queues.js';
import type { TrustJobDeps } from './deps.js';

/** A request nobody should call a provider about again. */
const TERMINAL: readonly VerificationRequestStatus[] = ['APPROVED', 'REJECTED', 'EXPIRED'];

/**
 * The guard every job opens with.
 *
 * BullMQ is at-least-once, so a redelivered job is normal rather than exceptional — and a second
 * provider call is money spent for an answer already on file. Undefined means "nothing to do",
 * never an error: a request the sweep expired while the job sat in the queue is an ordinary race.
 */
export async function claimRequest(
  deps: TrustJobDeps,
  requestId: string,
): Promise<VerificationRequest | undefined> {
  const request = await deps.store.findRequest(requestId);
  if (!request) {
    deps.logger.warn({ requestId }, 'trust: a check job ran for a request that no longer exists');
    return undefined;
  }
  if (TERMINAL.includes(request.status)) {
    deps.logger.debug({ requestId, status: request.status }, 'trust: the request is already decided');
    return undefined;
  }
  return request;
}

export interface TimedCall<T> {
  result?: T;
  error?: unknown;
  latencyMs: number;
}

/** Runs the provider call and times it, so the cost log is written on both paths. */
export async function timeProviderCall<T>(call: () => Promise<T>): Promise<TimedCall<T>> {
  const started = Date.now();
  try {
    const result = await call();
    return { result, latencyMs: Date.now() - started };
  } catch (error) {
    return { error, latencyMs: Date.now() - started };
  }
}

/**
 * Writes `kyc_provider_calls` and, when the call threw, rethrows.
 *
 * The log happens FIRST and on every path: it is the only record that a call was made, and a
 * provider that bills per attempt bills for the ones that failed too. `cost_estimate_kobo` is left
 * null — inventing a price for the fake adapter would corrupt the reconciliation the column exists
 * for, and the real number arrives with the real contract.
 */
export async function recordCall<T>(
  deps: TrustJobDeps,
  input: Omit<ProviderCallInput, 'latencyMs' | 'succeeded' | 'errorKind'>,
  timed: TimedCall<T>,
): Promise<T> {
  await deps.store.recordProviderCall({
    ...input,
    latencyMs: timed.latencyMs,
    succeeded: timed.error === undefined,
    ...(timed.error === undefined ? {} : { errorKind: 'exception' }),
  });
  if (timed.error !== undefined) throw timed.error;
  // `result` is set whenever `error` is not: the two are written by the same branch above.
  return timed.result as T;
}

/** True when this error is the §6.3 duplicate rule firing, however deeply drizzle buried it. */
export const isDuplicateIdentifier = (error: unknown, type: IdentifierType): boolean =>
  isUniqueViolation(error, `${type.toLowerCase()}_verifications_hash_active_unique`);

/**
 * Re-reads the user's facts and grants level 2 if they now add up (§4).
 *
 * It re-reads rather than trusting the outcome just written, because the other half of the level may
 * have landed from a different job minutes ago, and because a redelivered job must reach the same
 * answer as the first one did.
 */
export async function evaluateLevel(deps: TrustJobDeps, request: VerificationRequest): Promise<void> {
  const facts = await deps.store.identityFacts(request.userId);
  if (!earnedIdentityLevel(facts)) return;

  await deps.store.grantLevel({
    userId: request.userId,
    toLevel: IDENTITY_VERIFIED_LEVEL,
    reason: 'A verified identity number and a passed liveness check',
    actorType: 'PROVIDER_AUTO',
    triggeringRequestId: request.id,
    provider: deps.adapter.provider,
  });
}

/**
 * Tells an open app the answer arrived.
 *
 * Never throws: the outcome is already committed, and a failed emit must not roll it back or burn a
 * retry. `GET /verification/status` is the floor underneath this — the push is a latency
 * improvement, not the delivery mechanism.
 */
export function pushOutcome(
  deps: TrustJobDeps,
  request: VerificationRequest,
  status: VerificationRequestStatus,
  verdict: CheckVerdict,
): void {
  // PROVIDER_PENDING is not an answer; telling the client "still waiting" wakes a screen for nothing.
  if (status === 'PROVIDER_PENDING') return;
  try {
    deps.gateway.emitToUser(request.userId, VERIFICATION_SOCKET_EVENT, {
      requestId: request.id,
      type: request.verificationType,
      status,
      verdict,
    });
  } catch (error) {
    deps.logger.error(
      { err: error, requestId: request.id },
      'trust: the outcome could not be pushed; the status endpoint still has it',
    );
  }
}
