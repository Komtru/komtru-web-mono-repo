// T-038. Three STAFF routes under `/admin/staff-invitations`, all `role.grant` (SUPER_ADMIN only),
// and two CONSUMER routes under `/me/staff-invitations`: acceptance needs a signed-in account whose
// verified email is the invited address, because the OTP is delivered to that account's contact.
// Matching is against the account's verified PRIMARY email only: a secondary or unverified address
// never matches, so an invitee whose invited address is not their primary must make it primary first.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import {
  acceptHandler,
  cancelInvitationHandler,
  createInvitationHandler,
  listInvitationsHandler,
  startAcceptanceHandler,
  type StaffInvitationControllerDeps,
} from '../controllers/staff-invitation.controller.js';
import {
  acceptBody,
  acceptResponse,
  cancelStaffInvitationBody,
  cancelStaffInvitationResponse,
  createStaffInvitationBody,
  createStaffInvitationResponse,
  listStaffInvitationsQuery,
  listStaffInvitationsResponse,
  staffInvitationParams,
  startAcceptanceBody,
  startAcceptanceResponse,
} from '../validations/staff-invitation.validation.js';

const STAFF_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const STAFF_WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
/** An OTP is sent per call, so the per-user budget is tight. The OTP's own five attempts bind guessing. */
const ACCEPT_BUDGET = { points: 10, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export function staffInvitationRoutes(deps: StaffInvitationControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/admin/staff-invitations',
      scope: 'STAFF',
      permission: 'role.grant',
      summary: 'Invite someone to a staff role by email; the response carries the token once',
      status: 201,
      /** False: the response carries a live token, which the idempotency gate would store as plaintext. */
      retryable: false,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { body: createStaffInvitationBody, response: createStaffInvitationResponse },
      handler: (ctx) => createInvitationHandler(deps, ctx, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/staff-invitations',
      scope: 'STAFF',
      permission: 'role.grant',
      summary: 'Staff invitations, newest first, without tokens or addresses',
      paginated: 'page',
      rateLimit: STAFF_BUDGET,
      schema: { query: listStaffInvitationsQuery, response: listStaffInvitationsResponse },
      handler: (ctx) => listInvitationsHandler(deps, ctx, ctx.query),
    }),

    defineRoute({
      method: 'delete',
      path: '/admin/staff-invitations/:invitationId',
      scope: 'STAFF',
      permission: 'role.grant',
      summary: 'Cancel a pending staff invitation',
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: {
        params: staffInvitationParams,
        body: cancelStaffInvitationBody,
        response: cancelStaffInvitationResponse,
      },
      handler: (ctx) => cancelInvitationHandler(deps, ctx, ctx.params.invitationId, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/staff-invitations/start',
      scope: 'CONSUMER',
      summary: 'Send the code that proves the invited address, for the signed-in account that owns it',
      retryable: false,
      rateLimit: ACCEPT_BUDGET,
      schema: { body: startAcceptanceBody, response: startAcceptanceResponse },
      handler: (ctx) => startAcceptanceHandler(deps, ctx, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/me/staff-invitations/accept',
      scope: 'CONSUMER',
      summary: 'Accept a staff invitation with the code; a dual-approval role opens an approval',
      retryable: false,
      rateLimit: ACCEPT_BUDGET,
      schema: { body: acceptBody, response: acceptResponse },
      handler: (ctx) => acceptHandler(deps, ctx, ctx.body),
    }),
  ];
}
