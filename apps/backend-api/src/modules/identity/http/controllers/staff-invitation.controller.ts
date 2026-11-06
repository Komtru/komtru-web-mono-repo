// T-038 as HTTP. The admin handlers do what `admin.controller.ts`'s do (a staff principal, a REASON,
// the caller's live roles); the two consumer handlers turn an acceptance outcome into a status.
import type { Request } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import {
  acceptStaffInvitation,
  cancelStaffInvitation,
  createStaffInvitation,
  listStaffInvitations,
  startStaffInvitationAcceptance,
  type StaffInvitationDeps,
} from '../../services/staff-invitation.service.js';
import type {
  acceptBody,
  cancelStaffInvitationBody,
  createStaffInvitationBody,
  listStaffInvitationsQuery,
  startAcceptanceBody,
} from '../validations/staff-invitation.validation.js';
import { requireReason, staffActor } from './admin.controller.js';
import { callerAgent, callerIp } from './request.js';

export type StaffInvitationControllerDeps = StaffInvitationDeps;

interface Ctx {
  actor: Actor;
  req: Request;
}

const SIGN_IN = 'Sign in to accept an invitation';

export async function createInvitationHandler(
  deps: StaffInvitationControllerDeps,
  { actor, req }: Ctx,
  body: z.output<typeof createStaffInvitationBody>,
) {
  return createStaffInvitation(deps, {
    actor: staffActor(actor, req),
    email: body.email,
    roleCode: body.roleCode,
    reason: requireReason(req, body.reason),
    grantExpiresAt: body.grantExpiresAt ? new Date(body.grantExpiresAt) : undefined,
  });
}

export async function listInvitationsHandler(
  deps: StaffInvitationControllerDeps,
  { actor, req }: Ctx,
  query: z.output<typeof listStaffInvitationsQuery>,
) {
  return listStaffInvitations(deps.db, {
    actor: staffActor(actor, req),
    reason: requireReason(req, query.reason),
    status: query.status,
    page: query.page,
    limit: query.limit,
  });
}

export async function cancelInvitationHandler(
  deps: StaffInvitationControllerDeps,
  { actor, req }: Ctx,
  invitationId: string,
  body: z.output<typeof cancelStaffInvitationBody>,
) {
  return cancelStaffInvitation(deps.db, {
    actor: staffActor(actor, req),
    invitationId,
    reason: requireReason(req, body.reason),
  });
}

export async function startAcceptanceHandler(
  deps: StaffInvitationControllerDeps,
  { actor, req }: Ctx,
  body: z.output<typeof startAcceptanceBody>,
) {
  const issued = await startStaffInvitationAcceptance(deps, {
    userId: requireUserId(actor, SIGN_IN),
    token: body.token,
    ip: callerIp(req),
  });
  return { challengeId: issued.challengeId, expiresAt: issued.expiresAt };
}

export async function acceptHandler(
  deps: StaffInvitationControllerDeps,
  { actor, req }: Ctx,
  body: z.output<typeof acceptBody>,
) {
  const result = await acceptStaffInvitation(deps, {
    userId: requireUserId(actor, SIGN_IN),
    token: body.token,
    challengeId: body.challengeId,
    code: body.code,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  switch (result.outcome) {
    case 'GRANTED':
      return { status: 'GRANTED' as const, roleCode: result.roleCode, assignmentId: result.assignmentId };
    case 'PENDING_APPROVAL':
      return {
        status: 'PENDING_APPROVAL' as const,
        roleCode: result.roleCode,
        approvalId: result.approvalId,
      };
    case 'REFUSED':
      throw result.error;
    case 'WRONG_CODE':
      if (result.attemptsRemaining > 0) {
        throw new ApiError(
          422,
          'OTP_INVALID',
          "That code doesn't match",
          'Check the message and try again',
          undefined,
          { attemptsRemaining: result.attemptsRemaining },
        );
      }
      throw unusable();
    default:
      // An exhausted, expired or unknown challenge look the same, as on `/auth/verify-otp`.
      throw unusable();
  }
}

const unusable = (): ApiError =>
  new ApiError(422, 'OTP_INVALID', 'That code is no longer usable', 'Request a new code and try again');
