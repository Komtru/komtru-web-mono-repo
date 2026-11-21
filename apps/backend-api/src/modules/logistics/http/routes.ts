// m2 §5: two audiences, two route groups, each scoped by construction.
//
// Admin routes are STAFF with `logistics.manage` on every one, so the platform's route table refuses a
// consumer, a logistics session or a staff member without the permission before a handler runs.
// Portal routes are LOGISTICS on every one; ADMIN-vs-OPERATOR is this module's own check in the
// controller, because a POC role is not a staff permission (m2 §2).
import { defineRoute, type RouteDefinition } from '../../../platform/http/route.js';
import * as http from './controllers.js';
import {
  companiesQuery,
  companiesResponse,
  companySchema,
  idParams,
  invitationSchema,
  invitationsQuery,
  invitationsResponse,
  inviteBody,
  inviteOutcomeSchema,
  memberSchema,
  membersQuery,
  membersResponse,
  onboardBody,
  onboardResponse,
  portalMeResponse,
  updateCompanyBody,
  updateMemberBody,
} from './validations.js';

const READ_BUDGET = { points: 120, durationSeconds: 60, by: ['user' as const, 'ip' as const] };
const WRITE_BUDGET = { points: 30, durationSeconds: 60, by: ['user' as const, 'ip' as const] };

export const LOGISTICS_MANAGE = 'logistics.manage';

export function logisticsRoutes(deps: http.LogisticsHttpDeps): RouteDefinition[] {
  return [
    // ── Admin (operations-app) ───────────────────────────────────────────────────────────────────
    defineRoute({
      method: 'post',
      path: '/admin/logistics/companies',
      scope: 'STAFF',
      permission: LOGISTICS_MANAGE,
      summary: 'Onboard a logistics company with its first POC, linked or pending their signup',
      // A retried onboarding must not create the company twice.
      retryable: true,
      status: 201,
      rateLimit: WRITE_BUDGET,
      schema: { body: onboardBody, response: onboardResponse },
      handler: (ctx) => http.onboardHandler(deps, ctx.actor, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/logistics/companies',
      scope: 'STAFF',
      permission: LOGISTICS_MANAGE,
      summary: 'Logistics companies, Park first, by status',
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: companiesQuery, response: companiesResponse },
      handler: (ctx) => http.listCompaniesHandler(deps, ctx.query),
    }),

    defineRoute({
      method: 'patch',
      path: '/admin/logistics/companies/:id',
      scope: 'STAFF',
      permission: LOGISTICS_MANAGE,
      summary: 'Rename a logistics company, or enable or disable it for new packages',
      // Setting a name or a status twice leaves the same row.
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: updateCompanyBody, response: companySchema },
      handler: (ctx) => http.updateCompanyHandler(deps, ctx.actor, ctx.req, ctx.params.id, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/admin/logistics/companies/:id/members',
      scope: 'STAFF',
      permission: LOGISTICS_MANAGE,
      summary: "A logistics company's POCs and their status, for support",
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { params: idParams, query: membersQuery, response: membersResponse },
      handler: (ctx) => http.adminMembersHandler(deps, ctx.params.id, ctx.query),
    }),

    // ── Portal (logistics-ops); the company is always the caller's ───────────────────────────────
    defineRoute({
      method: 'get',
      path: '/logistics/me',
      scope: 'LOGISTICS',
      summary: 'Your logistics company and your role in it',
      rateLimit: READ_BUDGET,
      schema: { response: portalMeResponse },
      handler: (ctx) => http.portalMeHandler(deps, ctx.actor),
    }),

    defineRoute({
      method: 'post',
      path: '/logistics/members',
      scope: 'LOGISTICS',
      summary: 'Invite a POC to your company: added at once, or pending their signup',
      retryable: true,
      status: 201,
      rateLimit: WRITE_BUDGET,
      schema: { body: inviteBody, response: inviteOutcomeSchema },
      handler: (ctx) => http.portalInviteHandler(deps, ctx.actor, ctx.req, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/logistics/members',
      scope: 'LOGISTICS',
      summary: "Your company's POCs, by status",
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: membersQuery, response: membersResponse },
      handler: (ctx) => http.portalMembersHandler(deps, ctx.actor, ctx.query),
    }),

    defineRoute({
      method: 'patch',
      path: '/logistics/members/:id',
      scope: 'LOGISTICS',
      summary: "Change a POC's role, or remove them from your company",
      // A role set twice is the same role; a second removal is a 409 that changes nothing.
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, body: updateMemberBody, response: memberSchema },
      handler: (ctx) => http.portalUpdateMemberHandler(deps, ctx.actor, ctx.req, ctx.params.id, ctx.body),
    }),

    defineRoute({
      method: 'get',
      path: '/logistics/invitations',
      scope: 'LOGISTICS',
      summary: "Your company's invitations to people who have not signed up yet",
      paginated: 'page',
      rateLimit: READ_BUDGET,
      schema: { query: invitationsQuery, response: invitationsResponse },
      handler: (ctx) => http.portalInvitationsHandler(deps, ctx.actor, ctx.query),
    }),

    defineRoute({
      method: 'delete',
      path: '/logistics/invitations/:id',
      scope: 'LOGISTICS',
      summary: 'Withdraw a pending invitation',
      // A second cancel is a 404 that changes nothing.
      retryable: false,
      rateLimit: WRITE_BUDGET,
      schema: { params: idParams, response: invitationSchema },
      handler: (ctx) => http.portalCancelInvitationHandler(deps, ctx.actor, ctx.req, ctx.params.id),
    }),
  ];
}
