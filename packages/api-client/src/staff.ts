// The staff-facing endpoints the TrustOps console (T-140) calls: who the signed-in staff member is,
// and the staff invitation acceptance that happens before they have a staff session at all.
//
// `getStaffMe` is `GET /admin/me` (F-051): any live STAFF session may read its own id, display name,
// live roles and effective permission codes. The console hides sidebar items and controls by them; the
// backend still decides every call.
//
// Acceptance and TOTP enrolment are **CONSUMER** routes (T-038, T-031): a staff role is granted to
// an existing account, and that account proves its address and sets up a second factor as itself,
// before staff sign-in — which demands a second factor — is possible.
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

export const staffRoleSchema = z.object({ code: z.string().min(1), name: z.string().min(1) });

export const staffMeSchema = z.object({
  user: z.object({
    id: z.uuid(),
    publicId: z.string().min(1),
    displayName: z.string().nullable(),
    username: z.string().nullable(),
  }),
  roles: z.array(staffRoleSchema),
  /** Permission codes, from the T-037 catalogue. A code the console does not know is ignored. */
  permissions: z.array(z.string().min(1)),
});
export type StaffMe = z.infer<typeof staffMeSchema>;

export const getStaffMe = defineEndpoint({
  method: 'get',
  path: '/admin/me',
  scope: 'STAFF',
  schema: { response: staffMeSchema },
});

const invitationToken = z.string().min(20).max(128);

export const startStaffAcceptance = defineEndpoint({
  method: 'post',
  path: '/me/staff-invitations/start',
  scope: 'CONSUMER',
  schema: {
    body: z.strictObject({ token: invitationToken }),
    response: z.object({ challengeId: z.uuid(), expiresAt: z.string() }),
  },
});

export const acceptStaffInvitation = defineEndpoint({
  method: 'post',
  path: '/me/staff-invitations/accept',
  scope: 'CONSUMER',
  schema: {
    body: z.strictObject({
      token: invitationToken,
      challengeId: z.uuid(),
      code: z.string().regex(/^\d{6}$/),
    }),
    response: z.discriminatedUnion('status', [
      z.object({ status: z.literal('GRANTED'), roleCode: z.string(), assignmentId: z.uuid() }),
      z.object({ status: z.literal('PENDING_APPROVAL'), roleCode: z.string(), approvalId: z.uuid() }),
    ]),
  },
});

export const enrolTotp = defineEndpoint({
  method: 'post',
  path: '/me/mfa/totp/enroll',
  scope: 'CONSUMER',
  schema: {
    response: z.object({ factorId: z.uuid(), secret: z.string().min(1), otpauthUri: z.string().min(1) }),
  },
});

export const activateTotp = defineEndpoint({
  method: 'post',
  path: '/me/mfa/totp/activate',
  scope: 'CONSUMER',
  schema: {
    body: z.strictObject({ factorId: z.uuid(), code: z.string().trim().min(1).max(64) }),
    response: z.object({ factorId: z.uuid(), recoveryCodes: z.array(z.string()).nullable() }),
  },
});
