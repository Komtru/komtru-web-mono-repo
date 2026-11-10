// M1 section 10.6: `/admin/*`. Every route is STAFF-scoped with an explicit permission, and the
// platform refuses a session of the wrong scope (403) or without the permission (403) before a
// handler runs. Reasons, audit rows and the second-gate checks are the controller's and services'.
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import {
  approvalsHandler,
  auditLogHandler,
  decideHandler,
  grantRoleHandler,
  linkedAccountsHandler,
  piiHandler,
  requestForceChangeHandler,
  requestMfaResetHandler,
  reserveHandler,
  revokeAllHandler,
  revokeRoleHandler,
  searchUsersHandler,
  staffMeHandler,
  statusHandler,
  userDetailHandler,
  type AdminControllerDeps,
} from '../controllers/admin.controller.js';
import {
  approvalListResponse,
  approvalParams,
  approvalRequestedResponse,
  approvalsQuery,
  approveBody,
  auditLogResponse,
  decideResponse,
  forceChangeBody,
  grantRoleBody,
  grantRoleResponse,
  linkedAccountsResponse,
  pageOnlyQuery,
  piiResponse,
  reasonBody,
  reasonQuery,
  reserveBody,
  reserveResponse,
  revokeRoleResponse,
  revokedResponse,
  roleParams,
  searchQuery,
  statusBody,
  staffMeResponse,
  statusResponse,
  userDetailResponse,
  userIdParams,
  userListResponse,
} from '../validations/admin.validation.js';

/** Staff are known people on known sessions, so the budget is per caller and generous. */
const STAFF_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const STAFF_WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export function adminRoutes(deps: AdminControllerDeps): RouteDefinition[] {
  return [
    // No permission, on purpose: any live STAFF session may read its own roles and permissions, and
    // that is how the console learns what to show. Access is still decided per route.
    defineRoute({
      method: 'get',
      path: '/admin/me',
      scope: 'STAFF',
      summary: 'The signed-in staff member, their roles and permissions',
      rateLimit: STAFF_BUDGET,
      schema: { response: staffMeResponse },
      handler: ({ actor }) => staffMeHandler(deps, { actor }),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/users',
      scope: 'STAFF',
      permission: 'user.search',
      summary: 'Search users by handle or public id, with status and level filters',
      paginated: 'page',
      rateLimit: STAFF_BUDGET,
      schema: { query: searchQuery, response: userListResponse },
      handler: (ctx) => searchUsersHandler(deps, ctx, ctx.query),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/users/:id',
      scope: 'STAFF',
      permission: 'user.view',
      summary: 'One user, without personal data',
      rateLimit: STAFF_BUDGET,
      schema: { params: userIdParams, query: reasonQuery, response: userDetailResponse },
      handler: (ctx) => userDetailHandler(deps, ctx, ctx.params.id, ctx.query.reason),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/users/:id/pii',
      scope: 'STAFF',
      permission: 'user.view_pii',
      summary: 'Reveal a user’s personal data; one audit row per field',
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: userIdParams, query: reasonQuery, response: piiResponse },
      handler: (ctx) => piiHandler(deps, ctx, ctx.params.id, ctx.query.reason),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/users/:id/status',
      scope: 'STAFF',
      // No route-level permission: the one permission needed depends on the status in the body
      // (restrict, suspend or reinstate), so the service checks the right one after reading it.
      summary: 'Restrict, suspend or reinstate a user',
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: userIdParams, body: statusBody, response: statusResponse },
      handler: (ctx) => statusHandler(deps, ctx, ctx.params.id, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/users/:id/sessions/revoke-all',
      scope: 'STAFF',
      permission: 'session.revoke',
      summary: 'Sign a user out everywhere',
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: userIdParams, body: reasonBody, response: revokedResponse },
      handler: (ctx) => revokeAllHandler(deps, ctx, ctx.params.id, ctx.body.reason),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/users/:id/audit-log',
      scope: 'STAFF',
      permission: 'audit.view',
      summary: 'The audit log for one user',
      paginated: 'page',
      rateLimit: STAFF_BUDGET,
      schema: { params: userIdParams, query: pageOnlyQuery, response: auditLogResponse },
      handler: (ctx) => auditLogHandler(deps, ctx, ctx.params.id, ctx.query),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/users/:id/linked-accounts',
      scope: 'STAFF',
      // Owner decision pending: linkage is a fraud signal, so it is gated like the fraud queue
      // (SUPER_ADMIN, OPERATIONS_ADMIN, COMPLIANCE_OFFICER, FRAUD_ANALYST), not by `session.view`.
      permission: 'risk.view',
      summary: 'Other accounts sharing a device or an IP with this one',
      paginated: 'page',
      rateLimit: STAFF_BUDGET,
      schema: { params: userIdParams, query: pageOnlyQuery, response: linkedAccountsResponse },
      handler: (ctx) => linkedAccountsHandler(deps, ctx, ctx.params.id, ctx.query),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/users/:id/roles',
      scope: 'STAFF',
      permission: 'role.grant',
      summary: 'Grant a staff role, optionally time-boxed; a dual-approval role opens an approval',
      status: 201,
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: userIdParams, body: grantRoleBody, response: grantRoleResponse },
      handler: (ctx) => grantRoleHandler(deps, ctx, ctx.params.id, ctx.body),
    }),

    defineRoute({
      method: 'delete',
      path: '/admin/users/:id/roles/:roleCode',
      scope: 'STAFF',
      permission: 'role.revoke',
      summary: 'Revoke a staff role',
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: roleParams, body: reasonBody, response: revokeRoleResponse },
      handler: (ctx) => revokeRoleHandler(deps, ctx, ctx.params.id, ctx.params.roleCode, ctx.body.reason),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/usernames/reserve',
      scope: 'STAFF',
      permission: 'username.reserve',
      summary: 'Add a handle to the reserved namespace',
      status: 201,
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { body: reserveBody, response: reserveResponse },
      handler: (ctx) => reserveHandler(deps, ctx, ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/users/:id/mfa/reset/request',
      scope: 'STAFF',
      permission: 'mfa.reset',
      summary: 'Request an MFA reset; a different holder must approve',
      status: 202,
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: userIdParams, body: reasonBody, response: approvalRequestedResponse },
      handler: (ctx) => requestMfaResetHandler(deps, ctx, ctx.params.id, ctx.body.reason),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/users/:id/username/force-change/request',
      scope: 'STAFF',
      permission: 'username.force_change',
      summary: 'Request a forced handle change; a different holder must approve',
      status: 202,
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: userIdParams, body: forceChangeBody, response: approvalRequestedResponse },
      handler: (ctx) => requestForceChangeHandler(deps, ctx, ctx.params.id, ctx.body),
    }),

    // Approving and rejecting carry no single permission: the permission is that of the ACTION the
    // approval row names, which the service reads from the row and checks against the caller's roles.
    defineRoute({
      method: 'post',
      path: '/admin/approvals/:approvalId/approve',
      scope: 'STAFF',
      summary: 'Approve a pending two-step action, which then runs',
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: approvalParams, body: approveBody, response: decideResponse },
      handler: (ctx) => decideHandler(deps, ctx, ctx.params.approvalId, 'APPROVE', ctx.body),
    }),

    defineRoute({
      method: 'post',
      path: '/admin/approvals/:approvalId/reject',
      scope: 'STAFF',
      summary: 'Reject a pending two-step action',
      retryable: true,
      rateLimit: STAFF_WRITE_BUDGET,
      schema: { params: approvalParams, body: approveBody, response: decideResponse },
      handler: (ctx) => decideHandler(deps, ctx, ctx.params.approvalId, 'REJECT', ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/approvals',
      scope: 'STAFF',
      // No route permission: the service shows each caller only the approvals for actions whose
      // permission they hold, which is the right scope for a list of requests.
      summary: 'Approvals by state, newest first',
      paginated: 'page',
      rateLimit: STAFF_BUDGET,
      schema: { query: approvalsQuery, response: approvalListResponse },
      handler: (ctx) => approvalsHandler(deps, ctx, ctx.query),
    }),
  ];
}
