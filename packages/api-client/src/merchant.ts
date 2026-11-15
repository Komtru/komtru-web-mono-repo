// The merchant certification endpoints (F-040): the applicant's half (T-121) and the TrustOps review
// console's (T-154). Mirrors `apps/backend-api/src/modules/merchant/http/validations.ts` field for
// field; dates arrive as ISO strings.
//
// Permissions (T-037 catalogue), which the console mirrors and the backend enforces:
//   merchant.application.view     the queue, the count and one application with its signed documents
//   merchant.application.decide   take an application, then approve, request changes or reject it
//
// The advisory has one fixed label and is a read. A decision body is the policy cited and the reviewer's
// own words: there is no member an advisory could ride in on.
import { pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { CASE_ADVISORY_LABEL } from './cases.js';
import { defineEndpoint } from './contracts.js';

const iso = z.iso.datetime();

export const MERCHANT_APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
] as const;
export type MerchantApplicationStatus = (typeof MERCHANT_APPLICATION_STATUSES)[number];

export const MERCHANT_BUSINESS_TYPES = ['INDIVIDUAL', 'REGISTERED_BUSINESS'] as const;
export const MERCHANT_DOCUMENT_TYPES = [
  'CAC_CERTIFICATE',
  'STATUS_REPORT',
  'MEMORANDUM',
  'DIRECTOR_ID',
] as const;
export type MerchantDocumentType = (typeof MERCHANT_DOCUMENT_TYPES)[number];

/** What a changes-requested decision can name: a document, or a field on the form. */
export const MERCHANT_FORM_FIELDS = [
  'businessName',
  'businessType',
  'addressLine',
  'stateId',
  'cityId',
  'categories',
  'cacRcNumber',
  'payoutAccountId',
] as const;
export type MerchantFormField = (typeof MERCHANT_FORM_FIELDS)[number];

const changeItemSchema = z.object({
  kind: z.enum(['DOCUMENT', 'FIELD']),
  key: z.string(),
  note: z.string().optional(),
});
export type MerchantChangeItem = z.infer<typeof changeItemSchema>;

// --- applicant ---------------------------------------------------------------------------------

export const merchantApplicationSchema = z.object({
  id: z.uuid(),
  status: z.enum(MERCHANT_APPLICATION_STATUSES),
  form: z.object({
    businessName: z.string().optional(),
    businessType: z.enum(MERCHANT_BUSINESS_TYPES).optional(),
    addressLine: z.string().optional(),
    stateId: z.uuid().optional(),
    cityId: z.uuid().optional(),
    categories: z.array(z.string()).optional(),
    cacRcNumber: z.string().optional(),
    payoutAccountId: z.uuid().optional(),
  }),
  documents: z.array(
    z.object({ docType: z.enum(MERCHANT_DOCUMENT_TYPES), label: z.string(), fileId: z.uuid() }),
  ),
  changesRequested: z.array(changeItemSchema),
  lastDecision: z.object({ outcome: z.string(), reason: z.string(), decidedAt: iso }).nullable(),
  canEdit: z.boolean(),
  submissionCount: z.number().int(),
  submittedAt: iso.nullable(),
  decidedAt: iso.nullable(),
  createdAt: iso,
});
export type MerchantApplication = z.infer<typeof merchantApplicationSchema>;

const applicationParams = z.object({ id: z.uuid() });

/** `null` before the person has started an application. */
export const getMyMerchantApplication = defineEndpoint({
  method: 'get',
  path: '/merchant/applications/me',
  scope: 'CONSUMER',
  schema: { response: merchantApplicationSchema.nullable() },
});

export const saveMerchantDraft = defineEndpoint({
  method: 'put',
  path: '/merchant/applications/me',
  scope: 'CONSUMER',
  retryable: true,
  schema: {
    body: z.strictObject({
      businessName: z.string().trim().min(1).max(200).optional(),
      businessType: z.enum(MERCHANT_BUSINESS_TYPES).optional(),
      addressLine: z.string().trim().min(1).max(300).optional(),
      stateId: z.uuid().optional(),
      cityId: z.uuid().optional(),
      categories: z.array(z.string().min(1).max(64)).max(20).optional(),
      cacRcNumber: z.string().trim().min(1).max(40).optional(),
      payoutAccountId: z.uuid().optional(),
      documents: z
        .array(z.strictObject({ docType: z.enum(MERCHANT_DOCUMENT_TYPES), fileId: z.uuid() }))
        .max(MERCHANT_DOCUMENT_TYPES.length)
        .optional(),
    }),
    response: merchantApplicationSchema,
  },
});

/** 422 without the CAC documents; the problem's field errors name what is missing. */
export const submitMerchantApplication = defineEndpoint({
  method: 'post',
  path: '/merchant/applications/:id/submit',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: applicationParams, body: z.strictObject({}), response: merchantApplicationSchema },
});

export const resubmitMerchantApplication = defineEndpoint({
  method: 'post',
  path: '/merchant/applications/:id/resubmit',
  scope: 'CONSUMER',
  retryable: true,
  schema: { params: applicationParams, body: z.strictObject({}), response: merchantApplicationSchema },
});

// --- staff -------------------------------------------------------------------------------------

const pageQuery = z.object({
  page: z.int().min(1).optional(),
  limit: z.int().min(1).max(100).optional(),
});

export const merchantQueueItemSchema = z.object({
  applicationId: z.uuid(),
  caseId: z.uuid(),
  caseNumber: z.string(),
  caseState: z.string(),
  priority: z.string(),
  slaStartedAt: iso,
  slaDueAt: iso,
  ownerUserId: z.uuid().nullable(),
  applicantUserId: z.uuid(),
  applicantPublicId: z.string(),
  businessName: z.string().nullable(),
  businessType: z.string().nullable(),
  categories: z.array(z.string()),
  status: z.enum(MERCHANT_APPLICATION_STATUSES),
  submissionCount: z.number().int(),
  submittedAt: iso.nullable(),
});
export type MerchantQueueItem = z.infer<typeof merchantQueueItemSchema>;

export const merchantEvidenceSchema = z.object({
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
export type MerchantEvidence = z.infer<typeof merchantEvidenceSchema>;

export const merchantApplicationDetailSchema = merchantQueueItemSchema.extend({
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
      docType: z.enum(MERCHANT_DOCUMENT_TYPES),
      label: z.string(),
      fileId: z.uuid(),
      contentType: z.string().nullable(),
      /** A short-lived signed URL, or null when the file cannot be served. */
      url: z.string().nullable(),
      expiresAt: iso.nullable(),
    }),
  ),
  evidence: merchantEvidenceSchema,
  advisory: z.object({
    label: z.literal(CASE_ADVISORY_LABEL),
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
    memberSince: iso,
    trades: z.object({ total: z.number().int(), completed: z.number().int() }),
  }),
  changesRequested: z.array(changeItemSchema),
  history: z.array(
    z.object({
      fromStatus: z.enum(MERCHANT_APPLICATION_STATUSES).nullable(),
      toStatus: z.enum(MERCHANT_APPLICATION_STATUSES),
      actorType: z.string(),
      actorUserId: z.uuid().nullable(),
      reason: z.string().nullable(),
      policyCitation: z.string().nullable(),
      requested: z.array(changeItemSchema),
      createdAt: iso,
    }),
  ),
});
export type MerchantApplicationDetail = z.infer<typeof merchantApplicationDetailSchema>;

export const listMerchantApplications = defineEndpoint({
  method: 'get',
  path: '/admin/merchant/applications',
  scope: 'STAFF',
  paginated: 'page',
  schema: {
    query: pageQuery.extend({
      status: z.enum(MERCHANT_APPLICATION_STATUSES).optional(),
      category: z.string().min(1).max(64).optional(),
      show: z.enum(['open', 'all']).optional(),
    }),
    response: pagedSchema(merchantQueueItemSchema),
  },
});

export const countMerchantApplications = defineEndpoint({
  method: 'get',
  path: '/admin/merchant/applications/count',
  scope: 'STAFF',
  schema: { response: z.object({ awaitingReview: z.number().int() }) },
});

export const getMerchantApplication = defineEndpoint({
  method: 'get',
  path: '/admin/merchant/applications/:id',
  scope: 'STAFF',
  schema: { params: applicationParams, response: merchantApplicationDetailSchema },
});

export const assignMerchantApplication = defineEndpoint({
  method: 'post',
  path: '/admin/merchant/applications/:id/assign',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: applicationParams,
    body: z.strictObject({}),
    response: z.object({
      applicationId: z.uuid(),
      status: z.enum(MERCHANT_APPLICATION_STATUSES),
      ownerUserId: z.uuid().nullable(),
    }),
  },
});

const reason = z.string().max(1000).optional();
const policyCitation = z.string().trim().min(1).max(200);
const decisionResponse = z.object({
  applicationId: z.uuid(),
  status: z.enum(MERCHANT_APPLICATION_STATUSES),
  storefrontSlug: z.string().optional(),
});

export const approveMerchantApplication = defineEndpoint({
  method: 'post',
  path: '/admin/merchant/applications/:id/approve',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: applicationParams,
    body: z.strictObject({ reason, policyCitation }),
    response: decisionResponse,
  },
});

export const requestMerchantChanges = defineEndpoint({
  method: 'post',
  path: '/admin/merchant/applications/:id/request-changes',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: applicationParams,
    body: z.strictObject({
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
    }),
    response: decisionResponse,
  },
});

export const rejectMerchantApplication = defineEndpoint({
  method: 'post',
  path: '/admin/merchant/applications/:id/reject',
  scope: 'STAFF',
  retryable: true,
  schema: {
    params: applicationParams,
    body: z.strictObject({ reason, policyCitation }),
    response: decisionResponse,
  },
});
