// The deterministic fake KYC provider (owner's decision Q7).
//
// No Dojah or Smile ID account exists yet, so this is what attests every identity level the platform
// grants today. It is named `*.client.ts` even though it reaches nothing: it occupies the provider
// seam, and the T-028 boundary — `*.client.ts` importable only from `jobs/` — is what stops a
// request handler calling an adapter directly. Naming it anything else would leave that door open
// for the one adapter that is easiest to misuse.
//
// It signs its work as `FAKE`, which is a value in the `kyc_provider` enum, so "which levels were
// granted by nobody" stays a single query the day real credentials arrive.
import type {
  IdentityClaim,
  IdentityCheckResult,
  KycProviderAdapter,
  LivenessCheckInput,
  LivenessCheckResult,
} from '../../domain/provider.js';
import { livenessScriptFor, referenceFor, scoreFor, scriptFor } from './fake-script.js';

/** Scripted for a number ending in 3: the adapter throwing, which the job's retry budget absorbs. */
class FakeProviderError extends Error {
  constructor(operation: string) {
    super(`fake kyc: scripted provider failure on ${operation} (identifier ends in 3)`);
    this.name = 'FakeProviderError';
  }
}

const identityCheck = (operation: 'nin' | 'bvn', claim: IdentityClaim): IdentityCheckResult => {
  const outcome = scriptFor(claim.identifier);
  if (outcome === 'ERROR') throw new FakeProviderError(operation);

  const reference = referenceFor(operation, claim.identifier);
  const result: IdentityCheckResult = {
    verdict: outcome,
    providerReference: reference,
    nameMatchScore: scoreFor(outcome, `${operation}:${claim.identifier}:${claim.lastName}`),
    // A DOB the user did not supply cannot be matched; `undefined` rather than `false`, because
    // "we did not check" and "it did not match" are different facts and the column keeps both.
    ...(claim.dateOfBirth === undefined ? {} : { dobMatch: outcome === 'PASSED' }),
    ...(operation === 'bvn' ? { phoneMatch: outcome === 'PASSED' } : {}),
  };
  if (outcome === 'FAILED') {
    result.failureReason = 'No record matched the number and name supplied';
  }
  if (outcome === 'LOW_CONFIDENCE') {
    result.failureReason = 'The name on the record is close but not an exact match';
  }
  return result;
};

export function createFakeKycClient(): KycProviderAdapter {
  return {
    provider: 'FAKE',

    // `.then(...)`, not `Promise.resolve(identityCheck(...))`. The argument of `Promise.resolve` is
    // evaluated BEFORE the promise exists, so the scripted failure would leave the adapter as a
    // SYNCHRONOUS throw — an exception on the worker's own call stack rather than a rejected job,
    // which is the same trap the files and ledger modules documented on their queue handlers.
    verifyNin: (claim) => Promise.resolve().then(() => identityCheck('nin', claim)),
    verifyBvn: (claim) => Promise.resolve().then(() => identityCheck('bvn', claim)),

    checkLiveness: (input: LivenessCheckInput) =>
      Promise.resolve().then(() => {
        const outcome = livenessScriptFor(input.selfieStorageRef);
        const result: LivenessCheckResult = {
          verdict: outcome,
          providerReference: referenceFor('liveness', input.selfieStorageRef),
          matchScore: scoreFor(outcome, `liveness:${input.selfieStorageRef}`),
          livenessPassed: outcome === 'PASSED',
        };
        if (outcome === 'FAILED') result.failureReason = 'The image did not pass the liveness check';
        if (outcome === 'LOW_CONFIDENCE') {
          result.failureReason = 'The face matched the document only weakly';
        }
        return result;
      }),
  };
}
