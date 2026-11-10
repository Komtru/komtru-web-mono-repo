// M1 section 10.6's admin surface. `reason` is `optional()` in every schema ON PURPOSE: the platform
// answers a schema failure with 422, and section 10.6 says a missing reason is a 400. The controller
// owns that check (`requireReason`) so the status is the spec's.
import { pageRequestSchema, pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { VERIFICATION_LEVELS, userStatus } from '../../infrastructure/postgres/schema/enums.js';

const reason = z.string().max(1000).optional();

export const userIdParams = z.object({ id: z.uuid() });
export const roleParams = z.object({ id: z.uuid(), roleCode: z.string().min(1).max(64) });
export const approvalParams = z.object({ approvalId: z.uuid() });

/** Every read carries the reason as a query member, so even a read leaves one in the audit log. */
export const readQuery = pageRequestSchema.extend({ reason });

export const searchQuery = readQuery.extend({
  q: z.string().min(1).max(64).optional(),
  status: z.enum(userStatus.enumValues).optional(),
  verificationLevel: z.enum(VERIFICATION_LEVELS).optional(),
});

export const pageOnlyQuery = readQuery;
export const reasonQuery = z.object({ reason });
export const reasonBody = z.strictObject({ reason });

export const statusBody = z.strictObject({
  status: z.enum(userStatus.enumValues),
  reason,
  evidenceRef: z.string().min(1).max(255).optional(),
});

export const grantRoleBody = z.strictObject({
  roleCode: z.string().min(1).max(64),
  reason,
  expiresAt: z.iso.datetime().optional(),
});

export const reserveBody = z.strictObject({
  username: z.string().min(1).max(32),
  category: z.enum(['SYSTEM', 'MONEY', 'TRUST', 'PARTNER', 'BRAND', 'ROLE', 'OFFENSIVE']),
  note: z.string().max(500).optional(),
  reason,
});

export const forceChangeBody = z.strictObject({
  newUsername: z.string().min(1).max(32),
  reason,
  evidenceRef: z.string().min(1).max(255).optional(),
});

export const approveBody = z.strictObject({
  reason,
  /** A ticket or call id proving the identity challenge happened. Required to approve an MFA reset. */
  identityChallengeRef: z.string().trim().min(3).max(120).optional(),
});

export const approvalsQuery = readQuery.extend({
  status: z.enum(['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'EXPIRED']).default('PENDING'),
});

const userSummary = z.object({
  id: z.uuid(),
  publicId: z.string(),
  username: z.string().nullable(),
  status: z.enum(userStatus.enumValues),
  verificationLevel: z.enum(VERIFICATION_LEVELS),
  createdAt: z.date(),
});

export const userListResponse = pagedSchema(userSummary);

export const userDetailResponse = userSummary.extend({
  statusReason: z.string().nullable(),
  statusChangedAt: z.date(),
  mfaEnrolled: z.boolean(),
  capabilities: z.array(z.object({ capability: z.string(), status: z.string() })),
});

export const piiResponse = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().optional(),
});

export const statusResponse = z.object({
  from: z.enum(userStatus.enumValues),
  to: z.enum(userStatus.enumValues),
});

export const revokedResponse = z.object({ revoked: z.number().int().min(0) });

export const auditLogResponse = pagedSchema(
  z.object({
    id: z.number(),
    occurredAt: z.date(),
    action: z.string(),
    outcome: z.string(),
    actorType: z.string(),
    actorUserId: z.uuid().nullable(),
    metadata: z.unknown(),
  }),
);

export const linkedAccountsResponse = pagedSchema(
  z.object({
    userId: z.uuid(),
    publicId: z.string(),
    username: z.string().nullable(),
    status: z.string(),
    via: z.enum(['DEVICE', 'IP']),
    shared: z.number().int(),
  }),
);

export const grantRoleResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('GRANTED'), assignmentId: z.uuid() }),
  z.object({ status: z.literal('PENDING_APPROVAL'), approvalId: z.uuid(), expiresAt: z.date() }),
]);

export const revokeRoleResponse = z.object({
  revokedAt: z.date(),
  staffSessionsRevoked: z.number().int().min(0),
});

export const reserveResponse = z.object({ username: z.string(), skeletons: z.number().int() });

export const approvalRequestedResponse = z.object({ approvalId: z.uuid(), expiresAt: z.date() });

export const decideResponse = z.object({
  approvalId: z.uuid(),
  action: z.string(),
  state: z.enum(['EXECUTED', 'APPROVED', 'REJECTED']),
});

export const approvalListResponse = pagedSchema(
  z.object({
    id: z.uuid(),
    action: z.string(),
    state: z.enum(['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'EXPIRED']),
    subjectUserId: z.uuid(),
    requestedBy: z.uuid(),
    approvedBy: z.uuid().nullable(),
    reason: z.string(),
    requestedAt: z.date(),
    approvedAt: z.date().nullable(),
    executedAt: z.date().nullable(),
    expiresAt: z.date(),
    rejectedAt: z.date().nullable(),
  }),
);

export const staffMeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    publicId: z.string(),
    displayName: z.string().nullable(),
    username: z.string().nullable(),
  }),
  roles: z.array(z.object({ code: z.string(), name: z.string() })),
  permissions: z.array(z.string()),
});
