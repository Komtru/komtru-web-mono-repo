// The zod schemas for M20 §9. Every one is strict: a field the client sent and this module does not
// understand is a 400, never a silent strip — a caller that believes it supplied a capture time or a
// hub id must be told it did not, rather than discovering months later that its evidence has neither.
import { z } from 'zod';
import {
  FILE_CATEGORIES,
  FILE_VISIBILITIES,
  STORAGE_POOLS,
} from '../infrastructure/postgres/schema/enums.js';

/**
 * Every category a caller may ask for over the generic endpoint.
 *
 * CUSTODY_EVIDENCE is deliberately absent. Design §7.3: the hub a custody photo was taken at is
 * resolved server-side from the agent's own assignments and is never trusted from the client — and
 * M20 has no Park knowledge with which to resolve it. T-092 calls `createUploadTicket` through the
 * module's barrel with the hub it already established, which is the only way that fact can be true.
 */
const SELF_SERVICE_CATEGORIES = FILE_CATEGORIES.filter((category) => category !== 'CUSTODY_EVIDENCE');

export const fileCategorySchema = z.enum(SELF_SERVICE_CATEGORIES as [string, ...string[]]);
export const fileVisibilitySchema = z.enum(FILE_VISIBILITIES);
export const storagePoolSchema = z.enum(STORAGE_POOLS);

/**
 * `visibility` is REQUIRED, with no default.
 *
 * D2 says the class is set explicitly at upload time and never inferred. A default here — even a
 * conservative one — would be an inference, and the failure mode of getting it wrong in the
 * permissive direction is a KYC document served to the internet. A 400 that says "state the
 * visibility" is the correct outcome for a caller that forgot.
 */
export const createUploadUrlBody = z.strictObject({
  category: fileCategorySchema,
  visibility: fileVisibilitySchema,
  contentType: z.string().min(3).max(120),
});

export const fileIdParams = z.strictObject({ id: z.uuid() });

export const grantIdParams = z.strictObject({ id: z.uuid(), grantId: z.uuid() });

export const tombstoneBody = z.strictObject({ reason: z.string().min(3).max(500) });

/**
 * Exactly one grantee type.
 *
 * `refine` rather than two optional fields: granting a user AND a role in one call is ambiguous about
 * which one a later revoke is meant to remove, and the database's CHECK says the same thing.
 */
export const grantAccessBody = z
  .strictObject({
    granteeUserId: z.uuid().optional(),
    granteeRole: z.string().min(1).max(60).optional(),
    reason: z.string().min(3).max(500),
  })
  .refine(
    (body) => Boolean(body.granteeUserId) !== Boolean(body.granteeRole),
    'Name exactly one of granteeUserId or granteeRole',
  );

export const registerStorageAccountBody = z.strictObject({
  pool: storagePoolSchema,
  label: z
    .string()
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Use lower-case letters, digits and hyphens'),
  cloudName: z.string().min(1).max(120),
  /**
   * Constrained to the shape config expects. A typo here inserts a row whose credentials can never
   * resolve, and rotation then silently skips the account the operator just provisioned.
   */
  credentialEnvPrefix: z
    .string()
    .max(60)
    .regex(/^CLOUDINARY_[A-Z0-9_]+$/, 'Expected a CLOUDINARY_* prefix'),
  rotationOrder: z.number().int().min(1).max(999).optional(),
});

export const pageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
