// Trust & Verification (M6) — the ONLY public surface of this module.
//
// What other modules get is the schema they read and the registry entry. What they deliberately do
// NOT get, and must not:
//
//  - **anything that takes a raw NIN or BVN.** There is exactly one way a number enters this
//    program, `POST /verification/{nin,bvn}`, and it is sealed before it leaves the request handler.
//    A second entry point is the one that forgets to seal it.
//  - **the provider adapters.** `infrastructure/providers/*.client.ts` is reachable from `jobs/` and
//    nowhere else, so no request handler can ever call a provider on the request path.
//  - **a way to set `users.verification_level` directly.** Levels move through the append-only
//    change log or not at all.
export * from './infrastructure/postgres/schema/index.js';

export { createTrustModule, EXPIRE_STALE_CRON, type TrustModuleOptions } from './module.js';
export * from './domain/events.js';
export {
  TRUST_QUEUES,
  TRUST_SCHEDULES,
  SOCIAL_PROOF_SOCKET_EVENT,
  VERIFICATION_SOCKET_EVENT,
} from './domain/queues.js';
/**
 * T-073's read, and the one function another module is meant to call into this one by name.
 *
 * Exported as a question about an ACCOUNT rather than about a verification request, because that is
 * what T-073 holds: a `payout_accounts` row has a bank code and a masked number and no request id,
 * and should not have to acquire one. M6 answers "does the name match"; M8 owns the account.
 */
export { readBankNameMatch } from './services/bankMatch.service.js';
export type { BankNameMatchRecord } from './infrastructure/postgres/store.js';
/** What VF1 and BVR1 render, so a consumer can describe a stored code without re-deriving the copy. */
export { describeRejection, isRejectionCode, type RejectionReason } from './domain/rejection.js';
/** T-052: the facts a risk rule or a support ticket consumer reads, and the rules the admin surface enforces. */
export { REPEATED_REJECTION_THRESHOLD, REPEATED_REJECTION_WINDOW_DAYS } from './domain/review.js';
