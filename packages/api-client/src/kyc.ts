// The identity and KYB review endpoints the TrustOps console calls (F-051, T-144). Mirrors
// `apps/backend-api/src/modules/trust/http/admin.validations.ts` field for field; dates arrive as ISO strings.
//
// Permissions (T-037 catalogue), which the console mirrors and the backend enforces:
//   verification.view      the queue and one item, with its advisory
//   verification.review    take and decide an item
//   duplicate_flag.view    the flags
//   duplicate_flag.resolve resolve one (clearing also needs a dual-approved `VERIFICATION_OVERRIDE`)
//   verification.override  ask for a clearance; a different holder approves it
//
// The advisory has one fixed label and is a read. A decision body is the outcome and the analyst's own
// words: there is no member an advisory could ride in on.
import { pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { CASE_ADVISORY_LABEL } from './cases.js';
import { defineEndpoint } from './contracts.js';

const iso = z.iso.datetime();

export const KYC_CASE_TYPES = ['IDENTITY', 'KYB'] as const;
export const DUPLICATE_FLAG_STATUSES = [
  'OPEN',
  'CONFIRMED_DUPLICATE',
  'CLEARED_FALSE_POSITIVE',
  'ESCALATED',
] as const;
export type DuplicateFlagStatus = (typeof DUPLICATE_FLAG_STATUSES)[number];

export const kycQueueItemSchema = z.object({
  caseId: z.uuid(),
  caseNumber: z.string(),
  caseType: z.string(),
  state: z.string(),
  priority: z.string(),
  slaDueAt: iso,
  ownerUserId: z.uuid().nullable(),
  requestId: z.uuid(),
  userId: z.uuid(),
  verificationType: z.string(),
  submittedAt: iso,
  duplicateFlagId: z.uuid().nullable(),
  duplicateFlagStatus: z.string().nullable(),
});
export type KycQueueItem = z.infer<typeof kycQueueItemSchema>;

export const kycQueueDetailSchema = kycQueueItemSchema.extend({
  advisory: z.object({
    label: z.literal(CASE_ADVISORY_LABEL),
    source: z.string(),
    suggestion: z.string(),
    rationale: z.array(z.string()),
  }),
});
export type KycQueueDetail = z.infer<typeof kycQueueDetailSchema>;

export const duplicateFlagSchema = z.object({
  id: z.uuid(),
  identifierType: z.string(),
  firstUserId: z.uuid(),
  conflictingUserId: z.uuid(),
  requestId: z.uuid(),
  status: z.enum(DUPLICATE_FLAG_STATUSES),
  detectedAt: iso,
  reviewedBy: z.uuid().nullable(),
  reviewedAt: iso.nullable(),
  resolutionNotes: z.string().nullable(),
});
export type DuplicateFlag = z.infer<typeof duplicateFlagSchema>;

const pageQuery = z.object({
  page: z.int().min(1).optional(),
  limit: z.int().min(1).max(100).optional(),
});

const requestParams = z.object({ requestId: z.uuid() });
const reason = z.string().max(1000).optional();

export const listKycQueue = defineEndpoint({
  method: 'get',
  path: '/admin/kyc/queue',
  scope: 'STAFF',
  paginated: 'page',
  schema: {
    query: pageQuery.extend({
      type: z.enum(KYC_CASE_TYPES).optional(),
      show: z.enum(['open', 'all']).optional(),
    }),
    response: pagedSchema(kycQueueItemSchema),
  },
});

export const getKycItem = defineEndpoint({
  method: 'get',
  path: '/admin/kyc/queue/:requestId',
  scope: 'STAFF',
  schema: { params: requestParams, response: kycQueueDetailSchema },
});

export const assignKycItem = defineEndpoint({
  method: 'post',
  path: '/admin/kyc/queue/:requestId/assign',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: requestParams,
    body: z.strictObject({}),
    response: z.object({ id: z.uuid(), state: z.string(), ownerUserId: z.uuid().nullable() }),
  },
});

export const decideKycItem = defineEndpoint({
  method: 'post',
  path: '/admin/kyc/queue/:requestId/decide',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: requestParams,
    body: z.strictObject({
      outcome: z.enum(['APPROVE', 'REJECT']),
      reason,
      policyCitation: z.string().trim().min(1).max(200).optional(),
    }),
    response: z.object({ requestId: z.uuid(), status: z.string() }),
  },
});

export const listDuplicateFlags = defineEndpoint({
  method: 'get',
  path: '/admin/kyc/duplicate-flags',
  scope: 'STAFF',
  paginated: 'page',
  schema: {
    query: pageQuery.extend({ status: z.enum(DUPLICATE_FLAG_STATUSES).optional() }),
    response: pagedSchema(duplicateFlagSchema),
  },
});

export const resolveDuplicateFlag = defineEndpoint({
  method: 'post',
  path: '/admin/kyc/duplicate-flags/:id/resolve',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: z.object({ id: z.uuid() }),
    body: z.strictObject({
      resolution: z.enum(['CONFIRMED_DUPLICATE', 'CLEARED_FALSE_POSITIVE', 'ESCALATED']),
      reason,
      /** Required to clear a duplicate: an approved `VERIFICATION_OVERRIDE` for this flag. */
      approvalId: z.uuid().optional(),
      policyCitation: z.string().trim().min(1).max(200).optional(),
    }),
    response: duplicateFlagSchema,
  },
});

/** Step one of a clearance. A different holder approves it (`approveApproval`); then the flag is resolved with it. */
export const requestVerificationOverride = defineEndpoint({
  method: 'post',
  path: '/admin/kyc/overrides',
  scope: 'STAFF',
  retryable: true,
  schema: {
    body: z.strictObject({ kind: z.literal('CLEAR_DUPLICATE'), flagId: z.uuid(), reason }),
    response: z.object({ approvalId: z.uuid(), expiresAt: iso }),
  },
});

/**
 * The platform's one dual-approval path (T-037). Its permission is that of the action the approval
 * names, read by the backend from the row: there is no permission of its own to mirror.
 */
export const approveApproval = defineEndpoint({
  method: 'post',
  path: '/admin/approvals/:approvalId/approve',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: z.object({ approvalId: z.uuid() }),
    body: z.strictObject({ reason }),
    response: z.object({
      approvalId: z.uuid(),
      action: z.string(),
      state: z.enum(['EXECUTED', 'APPROVED', 'REJECTED']),
    }),
  },
});
