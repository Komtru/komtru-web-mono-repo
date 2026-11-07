// T-039's request and response shapes: GET /me, the close and NDPA routes, and account recovery.
import { pageRequestSchema, pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { CLOSE_REASON_CODES } from '../../services/lifecycle.service.js';
import { LIFECYCLE_STATUSES } from '../../domain/lifecycle.js';
import { RECOVERY_METHODS } from '../../domain/events.js';

const passwordField = z.string().min(1).max(256);

/**
 * `POST /me/close` (M1 §10.5, screen CA2) and `POST /me/erasure-request`: the same proof. A password
 * for an account that has one, a step-up token for one that does not. Which one is required is the
 * service's call, so neither is required here.
 */
export const closeAccountBody = z.strictObject({
  /** Which box the user ticked. Their own words are not collected: they would be kept, and read, for years. */
  reason: z.enum(CLOSE_REASON_CODES).default('OTHER'),
  password: passwordField.optional(),
  stepUpToken: z.string().min(1).max(2048).optional(),
});

export const closeAccountResponse = z.object({
  status: z.literal('CLOSED'),
  /** Where the account stands for good: closed accounts are anonymised only after compliance's review. */
  sessionsRevoked: z.number().int().min(0),
});

export const erasureResponse = z.object({
  status: z.literal('CLOSED'),
  scheduledFor: z.iso.datetime(),
});

export const dataExportResponse = z.object({
  outcome: z.enum(['REQUESTED', 'ALREADY_REQUESTED']),
  requestedAt: z.iso.datetime(),
  dueBy: z.iso.datetime(),
});

/** What screens AS1, AS2, CA1 and CA2 read. Never the staff-written reason (plan, owner decision 2). */
export const meResponse = z.object({
  id: z.uuid(),
  publicId: z.string(),
  username: z.string().nullable(),
  verificationLevel: z.string(),
  account: z.object({
    status: z.enum(LIFECYCLE_STATUSES),
    since: z.iso.datetime().nullable(),
    abilities: z.object({
      login: z.boolean(),
      browse: z.boolean(),
      buy: z.boolean(),
      sell: z.boolean(),
      withdraw: z.boolean(),
    }),
    openTrades: z.boolean().nullable(),
    canClose: z.boolean(),
    supportReference: z.string(),
    noticeKey: z
      .enum(['ACCOUNT_RESTRICTED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_LOCKED', 'ACCOUNT_CLOSED'])
      .nullable(),
  }),
});

// --- recovery ---------------------------------------------------------------------------------

export const recoveryIntakeBody = z.strictObject({
  /** An email, a phone number or a handle: whatever the person remembers. */
  identifier: z.string().trim().min(3).max(320),
  method: z.enum(RECOVERY_METHODS),
});

/** One shape whatever happened (§S3). */
export const recoveryReceiptResponse = z.object({
  /** Opaque and fresh on every call; it names nothing (see `RecoveryReceipt`). */
  receiptId: z.uuid(),
  status: z.literal('RECEIVED'),
});

const reason = z.string().max(1000).optional();

export const recoveryQuery = pageRequestSchema.extend({
  reason,
  status: z.enum(['PENDING', 'CHALLENGED', 'COMPLETED', 'REJECTED', 'EXPIRED']).optional(),
});

export const recoveryIdParams = z.object({ id: z.uuid() });

export const recoveryDecisionBody = z.strictObject({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason,
});

const recoveryRequestView = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  method: z.string(),
  status: z.string(),
  riskScore: z.number().nullable(),
  requiresHuman: z.boolean(),
  evidenceCount: z.number().int(),
  createdAt: z.date(),
  expiresAt: z.date(),
  reviewedBy: z.uuid().nullable(),
  decisionReason: z.string().nullable(),
});

export const recoveryListResponse = pagedSchema(recoveryRequestView);

export const recoveryDecisionResponse = z.object({
  status: z.enum(['COMPLETED', 'REJECTED']),
  unlocked: z.boolean(),
});
