// Proof of address (M6 §1: "lightweight proof-of-address for higher tiers", §6.6's `address_checks`).
//
// **This check calls no provider, and that is read off the schema rather than decided here.**
// `address_checks` is the only outcome table in §6.6 with no `provider` and no `provider_reference`
// column — every other one has both — which is the spec saying a proof of address is a document a
// person weighs, not a verdict a vendor returns. So there is no sixth `KycProviderAdapter` method,
// no job, and no mapper written against a response nobody has received (the same posture T-050 took
// on the Dojah adapter, and for the same reason).
//
// What it produces is a request parked in MANUAL_REVIEW with an `address_checks` row whose `passed`
// is null, plus a `verification_documents` row pointing at the M20 file. T-052's reviewer decides.
//
// Two consequences stated plainly rather than discovered later:
//
//  1. **Nothing grants level 4.** §4 reserves `ENHANCED` for a human compliance process and says
//     outright that over-specifying it now would be guessing. An address check contributes evidence
//     to that process; it does not add up to a level on its own, and nothing here grants one.
//  2. **The request holds an in-flight slot indefinitely.** MANUAL_REVIEW is deliberately not swept
//     (§6.2 / `expireStale`), and until T-052 ships the review queue there is nothing to clear it.
//     The slot is per verification TYPE, so it blocks only further ADDRESS submissions — but it does
//     block those, and the 409 says the check is with our team rather than promising a result.
import { ApiError } from '../../../platform/errors.js';
import type { Logger } from '../../../platform/logger.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { ENHANCED_LEVEL } from '../domain/levels.js';
import type { AddressMethod, VerificationDocumentType } from '../infrastructure/postgres/schema/enums.js';
import type { TrustStore } from '../infrastructure/postgres/store.js';
import { assertActive, assertContactVerified, inFlightConflict } from './submission.js';

export interface AddressDeps {
  store: TrustStore;
  requestTtlMinutes: number;
  logger: Logger;
}

export interface SubmitAddressInput {
  userId: string;
  addressLine1: string;
  city: string;
  state: string;
  method: Exclude<AddressMethod, 'PROVIDER_LOOKUP'>;
  /** An M20 file id, uploaded as a `KYC_DOCUMENT`. */
  documentFileId: string;
}

export interface AddressSubmission {
  requestId: string;
  status: string;
}

/** Which document type a method implies. One mapping, so the two enums cannot drift apart. */
const DOCUMENT_TYPE: Record<SubmitAddressInput['method'], VerificationDocumentType> = {
  UTILITY_BILL: 'UTILITY_BILL',
  BANK_STATEMENT: 'BANK_STATEMENT',
};

export async function submitAddressCheck(
  deps: AddressDeps,
  input: SubmitAddressInput,
): Promise<AddressSubmission> {
  assertContactVerified(assertActive(await deps.store.findSubject(input.userId)));

  const document = await deps.store.findKycSelfie(input.documentFileId);
  /**
   * Absent, tombstoned, someone else's, or not a KYC document: one 404, byte-identical.
   *
   * The posture T-040 established on retrieval and the liveness submission reuses — distinguishing
   * them turns the endpoint into an oracle for whether a file id exists and who uploaded it.
   */
  if (!document || document.uploaderUserId !== input.userId || document.category !== 'KYC_DOCUMENT') {
    throw new ApiError(404, 'NOT_FOUND', 'We could not find that document');
  }

  const attemptCount = (await deps.store.countAttempts(input.userId, 'ADDRESS')) + 1;

  try {
    const request = await deps.store.createAddressCheck({
      userId: input.userId,
      addressLine1: input.addressLine1,
      city: input.city,
      state: input.state,
      method: input.method,
      documentRef: document.id,
      documentType: DOCUMENT_TYPE[input.method],
      ttlMinutes: deps.requestTtlMinutes,
      attemptCount,
      targetLevel: ENHANCED_LEVEL,
    });
    return { requestId: request.id, status: request.status };
  } catch (error) {
    if (isUniqueViolation(error, 'verification_requests_one_in_flight')) {
      throw await inFlightConflict(deps.store, input.userId, 'ADDRESS');
    }
    throw error;
  }
}
