// The NIN/BVN check. The only place in this program that holds a raw identifier.
//
// It is opened from the sealed job payload, passed to the adapter, and dropped. Nothing below writes
// it, logs it or puts it in an event — and `test/modules/trust/no-raw-identifier.test.ts` scans every
// write this job makes to prove it, because D1 is the kind of promise that is kept by habit until
// the one time it is not.
import { z } from 'zod';
import { identifierHash, maskIdentifier } from '../domain/identifiers.js';
import { decideIdentityOutcome } from '../domain/decision.js';
import type { IdentityCheckJob } from '../domain/queues.js';
import type { IdentityCheckResult } from '../domain/provider.js';
import type { IdentifierType } from '../infrastructure/postgres/schema/enums.js';
import type { VerificationRequest } from '../infrastructure/postgres/schema/requests.js';
import {
  claimRequest,
  evaluateLevel,
  isDuplicateIdentifier,
  pushOutcome,
  recordCall,
  timeProviderCall,
} from './outcome.js';
import type { TrustJobDeps } from './deps.js';

/** Parsed rather than cast: the sealed blob is this program's own, but an unsealed shape is not typed. */
const claimSchema = z.object({
  identifier: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().optional(),
});

const isIdentifierType = (type: string): type is IdentifierType => type === 'NIN' || type === 'BVN';

export async function runIdentityCheck(deps: TrustJobDeps, data: IdentityCheckJob): Promise<void> {
  const request = await claimRequest(deps, data.requestId);
  if (!request) return;
  if (!isIdentifierType(request.verificationType)) {
    throw new Error(`trust: ${request.verificationType} is not an identifier check`);
  }
  const type = request.verificationType;

  const claim = claimSchema.parse(JSON.parse(deps.encryption.decrypt(data.sealed)));

  await deps.store.markProviderPending(request.id, deps.adapter.provider);

  const timed = await timeProviderCall(async () =>
    type === 'NIN' ? deps.adapter.verifyNin(claim) : deps.adapter.verifyBvn(claim),
  );
  // Rethrows a provider failure after the call is logged, so BullMQ retries and the cost record
  // survives. A budget exhausted here leaves the request PROVIDER_PENDING for the expiry sweep.
  const result = await recordCall(
    deps,
    { requestId: request.id, provider: deps.adapter.provider, callType: type },
    timed,
  );

  await applyOutcome(deps, request, type, claim.identifier, result);
}

async function applyOutcome(
  deps: TrustJobDeps,
  request: VerificationRequest,
  type: IdentifierType,
  identifier: string,
  result: IdentityCheckResult,
): Promise<void> {
  const decision = decideIdentityOutcome(result.verdict);
  const hash = identifierHash(deps.hasher, type, identifier);
  const shared = {
    request,
    type,
    masked: maskIdentifier(identifier),
    hash,
    provider: deps.adapter.provider,
    providerReference: result.providerReference,
    ...(result.nameMatchScore === undefined ? {} : { nameMatchScore: result.nameMatchScore }),
  };

  try {
    await deps.store.applyIdentityOutcome({
      ...shared,
      ...(result.dobMatch === undefined ? {} : { dobMatch: result.dobMatch }),
      ...(result.phoneMatch === undefined ? {} : { phoneMatch: result.phoneMatch }),
      requestStatus: decision.requestStatus,
      markVerified: decision.markVerified,
      ...(result.failureReason === undefined ? {} : { rejectionReason: result.failureReason }),
    });
  } catch (error) {
    if (!isDuplicateIdentifier(error, type)) throw error;

    /**
     * M6 §7, and the whole reason that index is a backstop rather than the mechanism.
     *
     * The number verified; it is simply already attached to another account. Auto-rejecting the
     * second claimant would hand someone's abandoned account a hostage over their own identity, and
     * auto-approving would be the exact re-entry route a suspended fraudster takes. So: neither. The
     * row goes in unverified, the request parks in MANUAL_REVIEW, and the event carries the two user
     * ids to whoever reviews it (T-052 builds that queue).
     *
     * `isDuplicateIdentifier` reads the code off the `cause` chain. A top-level `error.code` is
     * undefined here, which would have made this branch unreachable and turned every duplicate into
     * a 500 — the bug src/db/errors.ts exists to stop three modules repeating.
     */
    const firstUserId = (await deps.store.findIdentifierOwner(type, hash)) ?? null;
    await deps.store.applyDuplicateIdentity({ ...shared, firstUserId });
    deps.logger.warn(
      { requestId: request.id, type, firstUserId },
      'trust: an identifier already verified on another account; sent for review',
    );
    pushOutcome(deps, request, 'MANUAL_REVIEW', result.verdict);
    return;
  }

  if (decision.markVerified) await evaluateLevel(deps, request);
  pushOutcome(deps, request, decision.requestStatus, result.verdict);
}
