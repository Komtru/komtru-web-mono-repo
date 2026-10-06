// The Dojah adapter — present, selectable, and refusing every call.
//
// Owner's decision Q7: no Dojah account exists, and real verification is out of scope for T-050. So
// this file is the seam and the documentation of what a real integration needs, and nothing more.
// Specifically, there is **no request construction and no response mapping here**, and their absence
// is the point: a mapper written against a response shape nobody has ever received reads like
// working code, passes tests written from the same guess, and is rewritten the day credentials
// arrive — after some of it has already shipped.
//
// What a real integration adds, and where:
//
//   1. A `dojah.requests.ts` beside this file (pure, no network — the shape T-040 used for
//      `cloudinary.signing.ts`): URL and header construction from `DojahCredentials`. Dojah
//      authenticates with `AppId` and `Authorization: <secret key>` headers, per its published docs.
//   2. A `dojah.mapping.ts` (pure): the provider's JSON onto `IdentityCheckResult` /
//      `LivenessCheckResult`, including which of its statuses mean LOW_CONFIDENCE rather than
//      FAILED. This is the decision that cannot be made without seeing real responses, and the
//      reason the rest is deferred rather than sketched.
//   3. The bodies below, each one `providerRequest(...)` from `platform/providers/http.ts` — which
//      already carries the timeout, the bounded retry, the circuit breaker and the redaction, so
//      nothing here should hand-roll a fetch.
//
// The endpoints its documentation names, for whoever picks this up:
//   GET  /api/v1/kyc/nin            ?nin=
//   GET  /api/v1/kyc/bvn/full       ?bvn=
//   POST /api/v1/kyc/photoid/verify { selfie_image, photoid_image }
//
// Note the third one: Dojah's liveness endpoint takes IMAGES, and this module holds only an M20
// file reference (D5). Whoever wires it must decide whether to stream the bytes through the backend
// — which M20's design deliberately avoids — or hand Dojah a signed URL. That is a design question,
// not an implementation detail, and it is the first thing to settle.
import type { DojahCredentials } from '../../../../config/env.js';
import { KycProviderNotConfiguredError } from '../../domain/errors.js';
import type { IdentityCheckResult, KycProviderAdapter, LivenessCheckResult } from '../../domain/provider.js';

const NOT_INTEGRATED = [
  'a live Dojah integration (no call has ever been made from this repository)',
] as const;

export function createDojahClient(_credentials: DojahCredentials): KycProviderAdapter {
  // A rejected promise rather than a synchronous throw: a throw out of an adapter is an exception on
  // the worker's own call stack, not a failed job.
  const refuse = <T>(): Promise<T> =>
    Promise.reject(new KycProviderNotConfiguredError('DOJAH', NOT_INTEGRATED));

  return {
    provider: 'DOJAH',
    verifyNin: () => refuse<IdentityCheckResult>(),
    verifyBvn: () => refuse<IdentityCheckResult>(),
    checkLiveness: () => refuse<LivenessCheckResult>(),
  };
}
