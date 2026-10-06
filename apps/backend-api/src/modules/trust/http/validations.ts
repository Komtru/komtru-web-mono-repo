// M6 §11's request bodies.
//
// `z.strictObject` throughout, and it is load-bearing rather than tidy: the submission service seals
// the whole claim into a job payload, so a field that rides along unnoticed is a field that ends up
// encrypted in Redis and then handed to a provider. An unknown key is a 422, not a shrug.
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

export const statusResponse = z.object({
  level: z.string(),
  levelNumber: z.number().int(),
  levelAttainedAt: z.iso.datetime().nullable(),
  requirements: z.object({ identifier: z.boolean(), liveness: z.boolean() }),
  inFlight: z.array(
    z.object({
      requestId: z.uuid(),
      type: z.string(),
      status: z.string(),
      submittedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
  ),
});
