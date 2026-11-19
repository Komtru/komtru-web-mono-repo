// M6 §11's request bodies.
//
// `z.strictObject` throughout, and it is load-bearing rather than tidy: the submission service seals
// the whole claim into a job payload, so a field that rides along unnoticed is a field that ends up
// encrypted in Redis and then handed to a provider. An unknown key is a 422, not a shrug.
import { pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';

/**
 * Loose on length because the service normalises separators out before validating — `123-456-789-01`
 * is eleven digits once it is a number. The real check is `isValidIdentifier`, which runs after.
 */
const identifier = z.string().trim().min(11).max(20);
const givenName = z.string().trim().min(1).max(100);

const claimFields = {
  firstName: givenName,
  lastName: givenName,
  /**
   * Optional: a provider that cannot match a date of birth returns nothing for it, and demanding one
   * the user has not got to hand is a completion-rate tax on the step that gates selling.
   */
  dateOfBirth: z.iso.date().optional(),
};

export const ninBody = z.strictObject({ nin: identifier, ...claimFields });
export const bvnBody = z.strictObject({ bvn: identifier, ...claimFields });

/** An M20 file id, uploaded through `POST /files/upload-url` as a `KYC_DOCUMENT`. */
export const livenessBody = z.strictObject({ selfieFileId: z.uuid() });

export const submissionResponse = z.object({
  requestId: z.uuid(),
  status: z.string(),
});

/**
 * `rejections` and the two business requirements are here because the response schema is applied
 * with `safeParse`, and `z.object` STRIPS what it does not declare.
 *
 * `readVerificationStatus` has returned all four fields since T-051 was written, and the schema
 * declared neither — so the endpoint quietly dropped exactly the data BVR1 and VF1 exist to render,
 * with no error anywhere to say so. A response schema that is narrower than its service is not a
 * validation, it is a silent filter.
 */
export const statusResponse = z.object({
  level: z.string(),
  levelNumber: z.number().int(),
  levelAttainedAt: z.iso.datetime().nullable(),
  requirements: z.object({
    identifier: z.boolean(),
    liveness: z.boolean(),
    // §4's level-3 pair. Flat beside level 2's, because M2 and J2 both render one checklist and a
    // client that has to know which level a row belongs to is a client reimplementing §4.
    business: z.boolean(),
    businessBankAccount: z.boolean(),
  }),
  inFlight: z.array(
    z.object({
      requestId: z.uuid(),
      type: z.string(),
      status: z.string(),
      submittedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
  ),
  /**
   * The structured rejection per check — the whole reason this ticket's acceptance criteria name
   * BVR1 and VF1.
   *
   * The copy travels rather than only the code, so a confusing sentence is fixed server-side without
   * waiting on a client release, and so a client cannot invent its own wording for a screen that
   * gates somebody's income.
   */
  rejections: z.array(
    z.object({
      requestId: z.uuid(),
      type: z.string(),
      decidedAt: z.iso.datetime().nullable(),
      reason: z.object({
        code: z.string(),
        surface: z.enum(['VF1', 'BVR1', 'SOCIAL_PROOF']),
        outcome: z.enum(['FAILED', 'REJECTED', 'UNDER_REVIEW']),
        whyHeading: z.string(),
        why: z.string(),
        remedy: z.string(),
        identityLevelAffected: z.boolean(),
      }),
    }),
  ),
});

// --- T-051: the four checks M6 §11 adds to the user surface -------------------------------------

/**
 * Loose on length, like the identifier bodies: `normaliseRcNumber` strips the case and the
 * separators — but not the entity prefix — before `isValidRcNumber` runs, and CAC's own formats
 * have changed more than once; a strict pattern here refuses real businesses whose number predates
 * whatever we guessed.
 */
export const businessBody = z.strictObject({
  rcNumber: z.string().trim().min(2).max(30),
});

/** A NUBAN. Ten digits once the separators are out, which the service checks after normalising. */
export const bankAccountBody = z.strictObject({
  accountNumber: z.string().trim().min(10).max(20),
  bankCode: z.string().trim().min(1).max(10),
});

export const addressBody = z.strictObject({
  addressLine1: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  /**
   * `PROVIDER_LOOKUP` is deliberately not offered.
   *
   * It exists in the column's enum so a later provider-backed lookup is not a migration, but §6.6
   * gives `address_checks` no provider columns at all — so there is nothing behind it today, and a
   * client able to ask for it would be asking for a check that cannot run.
   */
  method: z.enum(['UTILITY_BILL', 'BANK_STATEMENT']),
  /** An M20 file id, uploaded through `POST /files/upload-url` as a `KYC_DOCUMENT`. */
  documentFileId: z.uuid(),
});

export const socialProofBody = z.strictObject({
  platform: z.enum(['INSTAGRAM', 'X']),
  /** Normalised before validation: a leading `@` and the case are both stripped. */
  handle: z.string().trim().min(1).max(40),
});

export const claimIdParam = z.strictObject({ id: z.uuid() });

export const livenessRequestIdParam = z.strictObject({ requestId: z.uuid() });

/**
 * `abandoned` is false when this call moved nothing — a second `onClose`, or a retry that landed
 * after the first one succeeded. Both are successes to the browser, which only wants to know it
 * may offer the camera again, so the distinction is reported rather than thrown.
 */
export const livenessAbandonResponse = z.strictObject({ abandoned: z.boolean() });

const socialProofClaimResponse = z.object({
  claimId: z.uuid(),
  platform: z.enum(['INSTAGRAM', 'X']),
  handle: z.string(),
  /** Returned on the claim AND on a read: the user will close the tab and come back for it. */
  challengeCode: z.string(),
  verified: z.boolean(),
  verifiedAt: z.iso.datetime().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
});

export const socialProofResponse = socialProofClaimResponse;
export const socialProofListResponse = pagedSchema(socialProofClaimResponse);
export const socialProofCheckResponse = z.object({ claimId: z.uuid() });

/** The webhook acknowledgement. Deliberately says nothing about what happened to the delivery. */
export const webhookAckSchema = z.strictObject({ received: z.literal(true) });

/**
 * What the browser gets to run the liveness SDK.
 *
 * Note what is NOT here: anything about the verdict. The SDK's own callbacks report that its modal
 * finished, not that the person passed, so this response deliberately gives the client nothing it
 * could mistake for an outcome. The outcome arrives over the socket, after a signed webhook.
 */
export const livenessSessionResponse = z.strictObject({
  publicMerchantKey: z.string(),
  sandbox: z.boolean(),
  reference: z.string(),
  requestId: z.string(),
});
