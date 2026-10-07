// Queue names, schedule names and job payloads.
//
// They live in `domain/` rather than `jobs/` for the reason T-040 documented: a service has to be
// able to ENQUEUE without importing a directory the provider-boundary scanner taints. A future
// import *into* this file would make this file itself the violation, which is the property that
// makes the arrangement safe rather than a loophole.
export const TRUST_QUEUES = {
  IDENTITY_CHECK: 'trust.identity-check',
  LIVENESS_CHECK: 'trust.liveness-check',
  BUSINESS_CHECK: 'trust.business-check',
  BANK_MATCH: 'trust.bank-match',
  SOCIAL_PROOF_CHECK: 'trust.social-proof-check',
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

/**
 * A CAC check. Sealed, and only partly for the reason the identity job is.
 *
 * The RC number is public record and is persisted in the clear (§6.5), so on its own it would not
 * need sealing. The submitter's first and last name travel with it for the officer check and are
 * persisted NOWHERE in this module — so the only copy of them in the system would be a Redis value
 * that outlives the job. Sealing the number and leaving the names in the clear is the same
 * half-measure `IdentityCheckJob` refuses, so the whole claim is sealed here too.
 */
export interface BusinessCheckJob {
  requestId: string;
  sealed: string;
}

/**
 * A bank name-match. Sealed, and this one is the sharpest case of the three.
 *
 * §6.5 keeps `account_number_masked` and nothing more, because M8's `payout_accounts` is the account
 * of record — so a full account number sitting in plaintext job data would be the only unencrypted
 * copy of it in the platform, in the one store (Redis) that nobody thinks of as a database. The
 * `expectedName` rides inside the seal with it rather than beside it: it is the registered business
 * name, which is public, but splitting a claim across a sealed field and a clear one is how the next
 * field gets added to the wrong side.
 */
export interface BankMatchJob {
  requestId: string;
  sealed: string;
}

/**
 * A social-proof re-check. Nothing here is a secret: the handle is public by definition and the
 * challenge code is something the user is being asked to publish.
 */
export interface SocialProofCheckJob {
  claimId: string;
}

/**
 * What a client is told over the socket when a verification reaches an answer.
 *
 * Protocol, so it lives here beside the queue names rather than in `jobs/`: a consuming module and
 * the web client need the name, and nothing that needs a name should have to import the directory
 * holding the provider adapter.
 */
export const VERIFICATION_SOCKET_EVENT = 'verification:updated';

/**
 * Social proof gets its own name rather than riding on the one above.
 *
 * `verification:updated` carries a `requestId` and a `verification_request_status`, and a social
 * proof claim has neither (see `social_proof_claims`). Pushing a claim id through a field every
 * client reads as a request id is the kind of overload that is free today and a bug the first time
 * somebody uses it to look the request up.
 */
export const SOCIAL_PROOF_SOCKET_EVENT = 'social-proof:updated';
