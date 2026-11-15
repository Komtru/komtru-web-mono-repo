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
import type { Db } from '../../db/index.js';
import type { HmacHasher } from '../../platform/crypto/hmac.js';
import { bindStore } from './infrastructure/postgres/bind-store.js';
import { readBankNameMatch } from './services/bankMatch.service.js';
import type { BankNameMatchRecord } from './infrastructure/postgres/store.js';
/**
 * `readBankNameMatch` against the database, for a caller that holds a `Db` and not a trust store.
 * The narrow reader T-073 needs: exporting `bindStore` instead would hand every module the whole
 * trust store, writes included.
 */
export const findBankNameMatchFor = (
  db: Db,
  hasher: HmacHasher,
  input: { userId: string; bankCode: string; accountNumber: string },
): Promise<BankNameMatchRecord | undefined> => readBankNameMatch(bindStore(db), hasher, input);
export type { BankNameMatchRecord } from './infrastructure/postgres/store.js';
/** What VF1 and BVR1 render, so a consumer can describe a stored code without re-deriving the copy. */
export { describeRejection, isRejectionCode, type RejectionReason } from './domain/rejection.js';
/** T-052: the facts a risk rule or a support ticket consumer reads, and the rules the admin surface enforces. */
export { REPEATED_REJECTION_THRESHOLD, REPEATED_REJECTION_WINDOW_DAYS } from './domain/review.js';
/**
 * T-055: what the merchant module asks of trust. `requestBusinessEvidence` runs T-051's CAC lookup for an
 * application's RC number (an ordinary refusal is an outcome, never a throw); `readBusinessEvidence` reads
 * what it found. Neither decides anything, and neither hands out the store.
 */
export {
  readBusinessEvidence,
  type BusinessEvidence,
  type BusinessEvidenceRequest,
  type BusinessEvidenceState,
} from './services/evidence.service.js';
import { requestBusinessEvidence as requestEvidence } from './services/evidence.service.js';
import type { Encryption } from '../../platform/crypto/encryption.js';
import type { Logger } from '../../platform/logger.js';
import type { QueueFactory } from '../../platform/queue/factory.js';
export const requestBusinessEvidence = (
  deps: { db: Db; encryption: Encryption; requestTtlMinutes: number; logger: Logger; queues: QueueFactory },
  input: { userId: string; rcNumber: string },
) =>
  requestEvidence(
    {
      store: bindStore(deps.db),
      encryption: deps.encryption,
      requestTtlMinutes: deps.requestTtlMinutes,
      logger: deps.logger,
      queues: deps.queues,
    },
    input,
  );
/** The one normal form of an RC number (T-051): a second copy would drift, and a mismatch would hide a duplicate. */
export { isValidRcNumber, normaliseRcNumber } from './domain/identifiers.js';
