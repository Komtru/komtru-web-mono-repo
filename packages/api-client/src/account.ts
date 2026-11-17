// Account security and lifecycle (F-045, T-205): who I am and the state of my account, the second factors and
// backup codes, the devices and sessions I am signed in on, closing the account, the NDPA requests, and the identity
// verification status. Mirrors `apps/backend-api/src/modules/identity/http/validations/{lifecycle,mfa,device}.validation.ts`
// and `apps/backend-api/src/modules/trust/http/validations.ts`; dates arrive as ISO strings.
//
// Three of these answer with something that must never be stored by an idempotency gate, and the backend marks them
// `retryable: false` for that reason: the TOTP seed, the backup codes and the step-up token. They are not retried here
// either, and a screen holds them in memory only.
import { pageRequestSchema, pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

const iso = z.iso.datetime();
const idParams = z.object({ id: z.uuid() });
const okSchema = z.object({ ok: z.literal(true) });

// --- who I am -----------------------------------------------------------------------------------------------

export const LIFECYCLE_STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'RESTRICTED',
  'SUSPENDED',
  'LOCKED',
  'CLOSED',
  'ANONYMISED',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const meSchema = z.object({
  id: z.uuid(),
  publicId: z.string(),
  username: z.string().nullable(),
  verificationLevel: z.string(),
  account: z.object({
    status: z.enum(LIFECYCLE_STATUSES),
    since: iso.nullable(),
    abilities: z.object({
      login: z.boolean(),
      browse: z.boolean(),
      buy: z.boolean(),
      sell: z.boolean(),
      withdraw: z.boolean(),
    }),
    /** A boolean, not a count: whether any trade is still in progress. `null` when the platform cannot say. */
    openTrades: z.boolean().nullable(),
    canClose: z.boolean(),
    /** What a person quotes to support. Never the staff-written reason. */
    supportReference: z.string(),
    noticeKey: z
      .enum(['ACCOUNT_RESTRICTED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_LOCKED', 'ACCOUNT_CLOSED'])
      .nullable(),
  }),
});
export type Me = z.infer<typeof meSchema>;

export const getMe = defineEndpoint({
  method: 'get',
  path: '/me',
  scope: 'CONSUMER',
  schema: { response: meSchema },
});

// --- close, and the NDPA requests ---------------------------------------------------------------------------

export const CLOSE_REASON_CODES = ['NOT_USING', 'PRIVACY', 'SECURITY', 'OTHER'] as const;
export type CloseReasonCode = (typeof CLOSE_REASON_CODES)[number];

/** A password for an account that has one, a step-up token for one that does not. The platform decides which. */
export const closeAccountBodySchema = z.strictObject({
  reason: z.enum(CLOSE_REASON_CODES).optional(),
  password: z.string().min(1).max(256).optional(),
  stepUpToken: z.string().min(1).max(2048).optional(),
});
export type CloseAccountBody = z.infer<typeof closeAccountBodySchema>;

export const closeAccount = defineEndpoint({
  method: 'post',
  path: '/me/close',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: closeAccountBodySchema,
    response: z.object({ status: z.literal('CLOSED'), sessionsRevoked: z.number().int().min(0) }),
  },
});

export const requestDataExport = defineEndpoint({
  method: 'post',
  path: '/me/data-export',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    response: z.object({
      outcome: z.enum(['REQUESTED', 'ALREADY_REQUESTED']),
      requestedAt: iso,
      dueBy: iso,
    }),
  },
});

/** Closes the account first, then compliance decides what is erased: the same proof as closing. */
export const requestErasure = defineEndpoint({
  method: 'post',
  path: '/me/erasure-request',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: closeAccountBodySchema,
    response: z.object({ status: z.literal('CLOSED'), scheduledFor: iso }),
  },
});

// --- second factors -----------------------------------------------------------------------------------------

export const FACTOR_TYPES = ['TOTP', 'SMS_OTP', 'EMAIL_OTP', 'PASSKEY', 'RECOVERY_CODE'] as const;
export type AccountFactorType = (typeof FACTOR_TYPES)[number];

export const accountFactorSchema = z.object({
  id: z.uuid(),
  type: z.enum(FACTOR_TYPES),
  label: z.string(),
  isDefault: z.boolean(),
  createdAt: iso,
  lastUsedAt: iso.nullable(),
  /** SMS only. */
  maskedDestination: z.string().optional(),
  /** Recovery codes only: how many of the sheet are unused. */
  remaining: z.number().int().min(0).optional(),
});
export type AccountFactor = z.infer<typeof accountFactorSchema>;

export const listFactors = defineEndpoint({
  method: 'get',
  path: '/me/mfa/factors',
  scope: 'CONSUMER',
  paginated: 'page',
  schema: { query: pageRequestSchema, response: pagedSchema(accountFactorSchema) },
});

/** TF1. The seed and the `otpauth` URI are returned once, on the enrolment that made them. */
export const enrolOwnTotp = defineEndpoint({
  method: 'post',
  path: '/me/mfa/totp/enroll',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    response: z.object({ factorId: z.uuid(), secret: z.string().min(1), otpauthUri: z.string().min(1) }),
  },
});

/** `recoveryCodes` is `null` when this is a second factor: the sheet was minted with the first. */
export const activatedFactorSchema = z.object({
  factorId: z.uuid(),
  recoveryCodes: z.array(z.string()).nullable(),
});
export type ActivatedFactor = z.infer<typeof activatedFactorSchema>;

export const activateOwnTotp = defineEndpoint({
  method: 'post',
  path: '/me/mfa/totp/activate',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.strictObject({ factorId: z.uuid(), code: z.string().trim().min(1).max(64) }),
    response: activatedFactorSchema,
  },
});

export const enrolSms = defineEndpoint({
  method: 'post',
  path: '/me/mfa/sms/enroll',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    response: z.object({
      factorId: z.uuid(),
      challengeId: z.uuid(),
      maskedDestination: z.string(),
      expiresAt: z.number().int().positive(),
      delivered: z.boolean(),
    }),
  },
});

export const activateSms = defineEndpoint({
  method: 'post',
  path: '/me/mfa/sms/activate',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.strictObject({
      factorId: z.uuid(),
      challengeId: z.uuid(),
      code: z.string().trim().min(1).max(64),
    }),
    response: activatedFactorSchema,
  },
});

/** TF2's "new codes": POST, because the platform keeps only hashes and a GET could not show them. A step-up action. */
export const regenerateRecoveryCodes = defineEndpoint({
  method: 'post',
  path: '/me/mfa/recovery-codes',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.strictObject({ stepUpToken: z.string().min(1).max(512).optional() }),
    response: z.object({ recoveryCodes: z.array(z.string()) }),
  },
});

export const removeFactor = defineEndpoint({
  method: 'delete',
  path: '/me/mfa/factors/:id',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    params: idParams,
    body: z.strictObject({ stepUpToken: z.string().min(1).max(512).optional() }),
    response: okSchema,
  },
});

// --- step-up ------------------------------------------------------------------------------------------------

/** Sends the code for an SMS factor (or builds the passkey options) before a step-up. */
export const stepUpChallenge = defineEndpoint({
  method: 'post',
  path: '/me/step-up/challenge',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.strictObject({ factorId: z.uuid() }),
    response: z.looseObject({}),
  },
});

/** Exactly one of `code` and `password`; a password only for an account that holds no factor. */
export const stepUpBodySchema = z
  .strictObject({
    factorId: z.uuid().optional(),
    code: z.string().trim().min(1).max(64).optional(),
    password: z.string().min(1).max(1024).optional(),
  })
  .refine((body) => [body.code !== undefined, body.password !== undefined].filter(Boolean).length === 1, {
    message: 'Send exactly one of code and password',
    path: ['code'],
  });
export type StepUpBody = z.infer<typeof stepUpBodySchema>;

export const stepUp = defineEndpoint({
  method: 'post',
  path: '/me/step-up',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: stepUpBodySchema,
    response: z.object({ stepUpToken: z.string().min(1), expiresAt: z.number().int().positive() }),
  },
});

// --- devices and sessions -----------------------------------------------------------------------------------

export const accountDeviceSchema = z.object({
  id: z.uuid(),
  fingerprintHint: z.string(),
  platform: z.string(),
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string(),
  trustedAt: iso.nullable(),
  firstSeenAt: iso,
  lastSeenAt: iso,
  hasPushToken: z.boolean(),
});
export type AccountDevice = z.infer<typeof accountDeviceSchema>;

export const listDevices = defineEndpoint({
  method: 'get',
  path: '/me/devices',
  scope: 'CONSUMER',
  paginated: 'page',
  schema: { query: pageRequestSchema, response: pagedSchema(accountDeviceSchema) },
});

export const retireDevice = defineEndpoint({
  method: 'delete',
  path: '/me/devices/:id',
  scope: 'CONSUMER',
  retryable: false,
  schema: { params: idParams, response: okSchema },
});

export const trustDevice = defineEndpoint({
  method: 'post',
  path: '/me/devices/:id/trust',
  scope: 'CONSUMER',
  retryable: false,
  schema: { params: idParams, response: okSchema },
});

export const accountSessionSchema = z.object({
  id: z.uuid(),
  scope: z.string(),
  amr: z.array(z.string()),
  deviceId: z.uuid().nullable(),
  deviceLabel: z.string(),
  ip: z.string().nullable(),
  issuedAt: iso,
  lastUsedAt: iso,
  idleExpiresAt: iso,
  /** The session this very request came in on. */
  current: z.boolean(),
});
export type AccountSession = z.infer<typeof accountSessionSchema>;

export const listSessions = defineEndpoint({
  method: 'get',
  path: '/me/sessions',
  scope: 'CONSUMER',
  paginated: 'page',
  schema: { query: pageRequestSchema, response: pagedSchema(accountSessionSchema) },
});

export const revokeSession = defineEndpoint({
  method: 'delete',
  path: '/me/sessions/:id',
  scope: 'CONSUMER',
  retryable: false,
  schema: { params: idParams, response: okSchema },
});

// --- identity verification (VF1) ----------------------------------------------------------------------------

export const REJECTION_SURFACES = ['VF1', 'BVR1', 'SOCIAL_PROOF'] as const;
export const REJECTION_OUTCOMES = ['FAILED', 'REJECTED', 'UNDER_REVIEW'] as const;

/**
 * The copy travels with the code (`whyHeading`, `why`), so a confusing sentence is fixed on the platform without a
 * client release, and a screen that gates somebody's income does not invent its own wording. `remedy` is the platform's
 * code for what to do next (`RESUBMIT`, `RESUBMIT_WITH_CLEARER_PHOTO`, `CONTACT_SUPPORT`, ...).
 */
export const verificationRejectionSchema = z.object({
  requestId: z.uuid(),
  /** `NIN`, `BVN`, `LIVENESS`, `CAC`, `BANK_ACCOUNT_NAME_MATCH`, `ADDRESS`, `DOCUMENT` or `SOCIAL_PROOF`. */
  type: z.string(),
  decidedAt: iso.nullable(),
  reason: z.object({
    code: z.string(),
    surface: z.enum(REJECTION_SURFACES),
    outcome: z.enum(REJECTION_OUTCOMES),
    whyHeading: z.string(),
    why: z.string(),
    remedy: z.string(),
    identityLevelAffected: z.boolean(),
  }),
});
export type VerificationRejection = z.infer<typeof verificationRejectionSchema>;

export const verificationStatusSchema = z.object({
  level: z.string(),
  levelNumber: z.number().int(),
  levelAttainedAt: iso.nullable(),
  requirements: z.object({
    identifier: z.boolean(),
    liveness: z.boolean(),
    business: z.boolean(),
    businessBankAccount: z.boolean(),
  }),
  inFlight: z.array(
    z.object({
      requestId: z.uuid(),
      type: z.string(),
      status: z.string(),
      submittedAt: iso,
      expiresAt: iso,
    }),
  ),
  rejections: z.array(verificationRejectionSchema),
});
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const getVerificationStatus = defineEndpoint({
  method: 'get',
  path: '/verification/status',
  scope: 'CONSUMER',
  schema: { response: verificationStatusSchema },
});

const identifier = z.string().trim().min(11).max(20);
const givenName = z.string().trim().min(1).max(100);
const claim = { firstName: givenName, lastName: givenName, dateOfBirth: z.iso.date().optional() };
const ninBodySchema = z.strictObject({ nin: identifier, ...claim });
const bvnBodySchema = z.strictObject({ bvn: identifier, ...claim });
const submitted = z.object({ requestId: z.uuid(), status: z.string() });

export type SubmitNinBody = z.input<typeof ninBodySchema>;
export type SubmitBvnBody = z.input<typeof bvnBodySchema>;

export const submitNin = defineEndpoint({
  method: 'post',
  path: '/verification/nin',
  scope: 'CONSUMER',
  retryable: false,
  schema: { body: ninBodySchema, response: submitted },
});

export const submitBvn = defineEndpoint({
  method: 'post',
  path: '/verification/bvn',
  scope: 'CONSUMER',
  retryable: false,
  schema: { body: bvnBodySchema, response: submitted },
});

/** `selfieFileId` is an uploaded `KYC_DOCUMENT` (`uploadFile`). */
export const submitLiveness = defineEndpoint({
  method: 'post',
  path: '/verification/liveness',
  scope: 'CONSUMER',
  retryable: false,
  schema: { body: z.strictObject({ selfieFileId: z.uuid() }), response: submitted },
});
