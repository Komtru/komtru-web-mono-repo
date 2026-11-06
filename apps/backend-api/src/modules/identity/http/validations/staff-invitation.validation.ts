// T-038's HTTP schemas. As in `admin.validation.ts`, `reason` is optional here ON PURPOSE: the
// platform answers a schema failure with 422 and M1 section 10.6 says a missing reason is a 400, so
// the controller owns that check.
import { pageRequestSchema, pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { invitationStatus } from '../../infrastructure/postgres/schema/enums.js';

const reason = z.string().max(1000).optional();

export const createStaffInvitationBody = z.strictObject({
  email: z.email().max(254),
  roleCode: z.string().min(1).max(64),
  reason,
  /** The absolute end of the grant. Absent means the 365-day maximum, counted from acceptance. */
  grantExpiresAt: z.iso.datetime().optional(),
});

export const createStaffInvitationResponse = z.object({
  invitationId: z.uuid(),
  /** Shown once. Only its hash is stored. */
  token: z.string(),
  maskedDestination: z.string(),
  expiresAt: z.date(),
});

export const listStaffInvitationsQuery = pageRequestSchema.extend({
  reason,
  status: z.enum(invitationStatus.enumValues).optional(),
});

export const staffInvitationView = z.object({
  id: z.uuid(),
  roleCode: z.string(),
  maskedDestination: z.string(),
  status: z.enum(invitationStatus.enumValues),
  invitedBy: z.uuid(),
  boundUserId: z.uuid().nullable(),
  claimedByUserId: z.uuid().nullable(),
  grantExpiresAt: z.date().nullable(),
  expiresAt: z.date(),
  createdAt: z.date(),
});

export const listStaffInvitationsResponse = pagedSchema(staffInvitationView);

export const staffInvitationParams = z.object({ invitationId: z.uuid() });
export const cancelStaffInvitationBody = z.strictObject({ reason });
export const cancelStaffInvitationResponse = z.object({ cancelledAt: z.date() });

const token = z.string().min(20).max(128);

export const startAcceptanceBody = z.strictObject({ token });
export const startAcceptanceResponse = z.object({ challengeId: z.uuid(), expiresAt: z.date() });

export const acceptBody = z.strictObject({
  token,
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export const acceptResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('GRANTED'), roleCode: z.string(), assignmentId: z.uuid() }),
  z.object({ status: z.literal('PENDING_APPROVAL'), roleCode: z.string(), approvalId: z.uuid() }),
]);
