// Queue names, schedule names and job payloads.
//
// They live in `domain/` rather than `jobs/` for the reason T-040 documented: a service has to be
// able to ENQUEUE without importing a directory the provider-boundary scanner taints. A future
// import *into* this file would make this file itself the violation, which is the property that
// makes the arrangement safe rather than a loophole.
export const TRUST_QUEUES = {
  IDENTITY_CHECK: 'trust.identity-check',
  LIVENESS_CHECK: 'trust.liveness-check',
} as const;

export const TRUST_SCHEDULES = {
  EXPIRE_STALE: 'trust.expire-stale',
} as const;

/**
 * An identity check, with the claim sealed.
 *
 * BullMQ job data is a Redis value: it is written to disk, it survives the job, and on a shared
 * instance it is readable by anything holding the connection. A plaintext NIN there would satisfy
 * "never stored in a table" while breaking D1 in every way that matters. `sealed` is
 * `encryption.encrypt(JSON.stringify(claim))` — the WHOLE claim, not only the number, because a
 * name and a date of birth in the clear are the same class of exposure and sealing one field of
 * three is the kind of half-measure that reads as compliance.
 */
export interface IdentityCheckJob {
  requestId: string;
  sealed: string;
}

/**
 * A liveness check carries no secret: the selfie is an M20 file reference and the request row holds
 * it already. The job id is enough.
 */
export interface LivenessCheckJob {
  requestId: string;
}
