// T-055's request and response shapes, both halves. As in trust and cases, `reason` is optional in the
// schema on purpose: a schema failure is a 422 and the admin surface answers a missing reason with a 400
// (`requireReason`), which also reads `X-Admin-Reason`. The policy citation is NOT optional: a decision
// without one is a 422, and the status log's CHECK would refuse the row if anything slipped past.
import { pageRequestSchema, pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { BUSINESS_TYPES, DOCUMENT_TYPES } from '../domain/application.js';
import { MERCHANT_APPLICATION_STATUSES } from '../domain/status.js';

// --- applicant ---------------------------------------------------------------------------------

export const applicationIdParams = z.object({ id: z.uuid() });
export const documentParams = z.object({ id: z.uuid(), docType: z.enum(DOCUMENT_TYPES) });

export const draftBody = z.strictObject({
  businessName: z.string().trim().min(1).max(200).optional(),
  businessType: z.enum(BUSINESS_TYPES).optional(),
  addressLine: z.string().trim().min(1).max(300).optional(),
  stateId: z.uuid().optional(),
  cityId: z.uuid().optional(),
  categories: z.array(z.string().min(1).max(64)).max(20).optional(),
  cacRcNumber: z.string().trim().min(1).max(40).optional(),
  payoutAccountId: z.uuid().optional(),
  documents: z
    .array(z.strictObject({ docType: z.enum(DOCUMENT_TYPES), fileId: z.uuid() }))
    .max(DOCUMENT_TYPES.length)
    .optional(),
});

const changeItem = z.object({
  kind: z.enum(['DOCUMENT', 'FIELD']),
  key: z.string(),
  note: z.string().optional(),
});

export const applicantViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(MERCHANT_APPLICATION_STATUSES),
  form: z.object({
    businessName: z.string().optional(),
    businessType: z.enum(BUSINESS_TYPES).optional(),
    addressLine: z.string().optional(),
    stateId: z.uuid().optional(),
    cityId: z.uuid().optional(),
    categories: z.array(z.string()).optional(),
    cacRcNumber: z.string().optional(),
    payoutAccountId: z.uuid().optional(),
  }),
  documents: z.array(z.object({ docType: z.enum(DOCUMENT_TYPES), label: z.string(), fileId: z.uuid() })),
  changesRequested: z.array(changeItem),
  lastDecision: z.object({ outcome: z.string(), reason: z.string(), decidedAt: z.date() }).nullable(),
  canEdit: z.boolean(),
  submissionCount: z.number().int(),
  submittedAt: z.date().nullable(),
  decidedAt: z.date().nullable(),
  createdAt: z.date(),
});

/** `null` before the person has started an application. */
export const myApplicationResponse = applicantViewSchema.nullable();

// --- staff -------------------------------------------------------------------------------------

export const queueQuery = pageRequestSchema.extend({
  status: z.enum(MERCHANT_APPLICATION_STATUSES).optional(),
  category: z.string().min(1).max(64).optional(),
  /** `open` is the work still to do; `all` includes decided applications and those waiting on the applicant. */
  show: z.enum(['open', 'all']).default('open'),
});

const queueItem = z.object({
  applicationId: z.uuid(),
  caseId: z.uuid(),
  caseNumber: z.string(),
  caseState: z.string(),
  priority: z.string(),
  slaStartedAt: z.date(),
  slaDueAt: z.date(),
  ownerUserId: z.uuid().nullable(),
  applicantUserId: z.uuid(),
  applicantPublicId: z.string(),
  businessName: z.string().nullable(),
  businessType: z.string().nullable(),
  categories: z.array(z.string()),
  status: z.enum(MERCHANT_APPLICATION_STATUSES),
  submissionCount: z.number().int(),
  submittedAt: z.date().nullable(),
});

export const queueResponse = pagedSchema(queueItem);
export const countResponse = z.object({ awaitingReview: z.number().int() });

const evidenceSchema = z.object({
  identityLevel: z.number().int(),
  cacLookup: z.object({
    state: z.enum(['NOT_RUN', 'PENDING', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW']),
    registeredBusinessName: z.string().nullable().optional(),
    cacStatus: z.string().nullable().optional(),
    officersMatch: z.boolean().nullable().optional(),
    rcMatchesApplication: z.boolean().optional(),
  }),
  documents: z.object({
    required: z.array(z.string()),
    present: z.array(z.string()),
    missing: z.array(z.string()),
    complete: z.boolean(),
  }),
  bankNameMatch: z.object({
    state: z.enum(['NOT_RUN', 'EXACT', 'FUZZY_MATCH', 'MISMATCH']),
    bankName: z.string().nullable().optional(),
    accountNumberMasked: z.string().nullable().optional(),
    resolvedAccountName: z.string().nullable().optional(),
  }),
});

export const detailResponse = queueItem.extend({
  form: z.object({
    businessName: z.string().nullable(),
    businessType: z.string().nullable(),
    addressLine: z.string().nullable(),
    stateName: z.string().nullable(),
    cityName: z.string().nullable(),
    categories: z.array(z.string()),
    cacRcNumber: z.string().nullable(),
  }),
  documents: z.array(
    z.object({
      docType: z.enum(DOCUMENT_TYPES),
      label: z.string(),
      contentType: z.string().nullable(),
      viewable: z.boolean(),
    }),
  ),
  evidence: evidenceSchema,
  advisory: z.object({
    label: z.string(),
    source: z.string(),
    suggestion: z.string(),
    rationale: z.array(z.string()),
  }),
  applicant: z.object({
    userId: z.uuid(),
    publicId: z.string(),
    username: z.string().nullable(),
    verificationLevel: z.number().int(),
    verificationLevelName: z.string(),
    memberSince: z.date(),
    trades: z.object({ total: z.number().int(), completed: z.number().int() }),
  }),
  changesRequested: z.array(changeItem),
  history: z.array(
    z.object({
      fromStatus: z.enum(MERCHANT_APPLICATION_STATUSES).nullable(),
      toStatus: z.enum(MERCHANT_APPLICATION_STATUSES),
      actorType: z.string(),
      actorUserId: z.uuid().nullable(),
      reason: z.string().nullable(),
      policyCitation: z.string().nullable(),
      requested: z.array(changeItem),
      createdAt: z.date(),
    }),
  ),
});

export const assignBody = z.strictObject({});
export const assignResponse = z.object({
  applicationId: z.uuid(),
  status: z.enum(MERCHANT_APPLICATION_STATUSES),
  ownerUserId: z.uuid().nullable(),
});

const reason = z.string().max(1000).optional();
const policyCitation = z.string().trim().min(1).max(200);

export const approveBody = z.strictObject({ reason, policyCitation });
export const rejectBody = z.strictObject({ reason, policyCitation });
export const requestChangesBody = z.strictObject({
  reason,
  policyCitation,
  requested: z
    .array(
      z.strictObject({
        kind: z.enum(['DOCUMENT', 'FIELD']),
        key: z.string().min(1).max(64),
        note: z.string().trim().min(1).max(500).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const decisionResponse = z.object({
  applicationId: z.uuid(),
  status: z.enum(MERCHANT_APPLICATION_STATUSES),
  storefrontSlug: z.string().optional(),
});

export const documentViewResponse = z.object({
  docType: z.enum(DOCUMENT_TYPES),
  label: z.string(),
  /** A short-lived signed link. Treat it as a secret: anyone holding it can fetch the bytes until it expires. */
  url: z.string(),
  expiresAt: z.date().nullable(),
  contentType: z.string(),
});
