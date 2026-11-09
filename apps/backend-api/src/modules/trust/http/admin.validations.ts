// M6 §11's admin half. `reason` is optional in the schemas on purpose, as in identity's and the cases
// module's admin schemas: a schema failure is a 422 and the admin surface answers a missing reason
// with a 400, so `requireReason` in admin.controller.ts owns that check (and reads `X-Admin-Reason`).
import { pageRequestSchema, pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { REJECTION_CODES } from '../domain/rejection.js';
import { DUPLICATE_FLAG_STATUSES } from '../infrastructure/postgres/schema/enums.js';

const reason = z.string().max(1000).optional();

export const requestIdParams = z.object({ requestId: z.uuid() });
export const flagIdParams = z.object({ id: z.uuid() });
export const approvalIdParams = z.object({ approvalId: z.uuid() });

export const queueQuery = pageRequestSchema.extend({
  type: z.enum(['IDENTITY', 'KYB']).optional(),
  /** `open` is the work still to do; `all` includes decided and closed cases. */
  show: z.enum(['open', 'all']).default('open'),
});

export const flagsQuery = pageRequestSchema.extend({
  status: z.enum(DUPLICATE_FLAG_STATUSES).optional(),
});

export const assignBody = z.strictObject({});

/**
 * The only members a decision takes. There is no field an advisory could fill: the reason and the
 * citation are the analyst's own words (T-107).
 */
export const decideBody = z.strictObject({
  outcome: z.enum(['APPROVE', 'REJECT']),
  reason,
  policyCitation: z.string().trim().min(1).max(200).optional(),
  rejectionCode: z.enum(REJECTION_CODES).optional(),
});

export const resolveFlagBody = z.strictObject({
  resolution: z.enum(['CONFIRMED_DUPLICATE', 'CLEARED_FALSE_POSITIVE', 'ESCALATED']),
  reason,
  /** Required to clear a duplicate: an approved `VERIFICATION_OVERRIDE` for this flag. */
  approvalId: z.uuid().optional(),
  policyCitation: z.string().trim().min(1).max(200).optional(),
});

export const overrideRequestBody = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('LEVEL'),
    userId: z.uuid(),
    direction: z.enum(['GRANT', 'REVOKE']),
    toLevel: z.number().int().min(0).max(4),
    reason,
  }),
  z.strictObject({ kind: z.literal('CLEAR_DUPLICATE'), flagId: z.uuid(), reason }),
]);

export const overrideExecuteBody = z.strictObject({
  userId: z.uuid(),
  direction: z.enum(['GRANT', 'REVOKE']),
  toLevel: z.number().int().min(0).max(4),
  reason,
});

const queueItem = z.object({
  caseId: z.uuid(),
  caseNumber: z.string(),
  caseType: z.string(),
  state: z.string(),
  priority: z.string(),
  slaDueAt: z.date(),
  ownerUserId: z.uuid().nullable(),
  requestId: z.uuid(),
  userId: z.uuid(),
  verificationType: z.string(),
  submittedAt: z.date(),
  duplicateFlagId: z.uuid().nullable(),
  duplicateFlagStatus: z.string().nullable(),
});

export const queueResponse = pagedSchema(queueItem);

export const queueDetailResponse = queueItem.extend({
  advisory: z.object({
    label: z.string(),
    source: z.string(),
    suggestion: z.string(),
    rationale: z.array(z.string()),
  }),
});

export const assignResponse = z.object({ id: z.uuid(), state: z.string(), ownerUserId: z.uuid().nullable() });

export const decideResponse = z.object({ requestId: z.uuid(), status: z.string() });

const flagView = z.object({
  id: z.uuid(),
  identifierType: z.string(),
  firstUserId: z.uuid(),
  conflictingUserId: z.uuid(),
  requestId: z.uuid(),
  status: z.string(),
  detectedAt: z.date(),
  reviewedBy: z.uuid().nullable(),
  reviewedAt: z.date().nullable(),
  resolutionNotes: z.string().nullable(),
});

export const flagsResponse = pagedSchema(flagView);
export const flagResponse = flagView;

export const overrideRequestedResponse = z.object({ approvalId: z.uuid(), expiresAt: z.date() });
export const overrideExecutedResponse = z.object({ from: z.number().int(), to: z.number().int() });
