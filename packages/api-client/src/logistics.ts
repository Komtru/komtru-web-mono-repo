// The logistics endpoints (F-065, m2 §5): the partner portal's own (`logistics-ops`, LOGISTICS scope)
// and the staff ones the TrustOps console's Logistics tab will call (STAFF, `logistics.manage`).
//
// No portal endpoint takes a company id. The backend derives the company from the session, and these
// contracts do not offer a way to say otherwise.
import { pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

export const LOGISTICS_ROLES = ['ADMIN', 'OPERATOR'] as const;
export type LogisticsRole = (typeof LOGISTICS_ROLES)[number];

export const LOGISTICS_MEMBER_STATUSES = ['INVITED', 'ACTIVE', 'REMOVED'] as const;
export const LOGISTICS_INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'] as const;

export const logisticsCompanySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['ENABLED', 'DISABLED']),
  /** Park, the one default company. Its agents work in the Park app, not this portal. */
  isDefault: z.boolean(),
  createdAt: z.string(),
});
export type LogisticsCompany = z.infer<typeof logisticsCompanySchema>;

export const logisticsMemberSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  contactMasked: z.string().nullable(),
  role: z.enum(LOGISTICS_ROLES),
  /** INVITED: has a Komtru account, has not signed in to the portal yet. */
  status: z.enum(LOGISTICS_MEMBER_STATUSES),
  invitedAt: z.string(),
  acceptedAt: z.string().nullable(),
  removedAt: z.string().nullable(),
});
export type LogisticsMember = z.infer<typeof logisticsMemberSchema>;

/** An invitation to an address no Komtru account has proved yet. */
export const logisticsInvitationSchema = z.object({
  id: z.uuid(),
  role: z.enum(LOGISTICS_ROLES),
  channel: z.enum(['EMAIL', 'PHONE']),
  contactMasked: z.string(),
  status: z.enum(LOGISTICS_INVITATION_STATUSES),
  invitedAt: z.string(),
  expiresAt: z.string(),
});
export type LogisticsInvitation = z.infer<typeof logisticsInvitationSchema>;

export const logisticsInviteOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('LINKED'), member: logisticsMemberSchema }),
  z.object({ outcome: z.literal('PENDING'), invitation: logisticsInvitationSchema }),
]);
export type LogisticsInviteOutcome = z.infer<typeof logisticsInviteOutcomeSchema>;

const pageQuery = z.object({
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
const idParams = z.object({ id: z.uuid() });

// ── Portal (LOGISTICS) ───────────────────────────────────────────────────────────────────────────

export const getLogisticsMe = defineEndpoint({
  method: 'get',
  path: '/logistics/me',
  scope: 'LOGISTICS',
  schema: {
    response: z.object({
      company: logisticsCompanySchema,
      member: z.object({ id: z.uuid(), role: z.enum(LOGISTICS_ROLES) }),
    }),
  },
});
export type LogisticsMe = z.infer<(typeof getLogisticsMe)['schema']['response']>;

export const listLogisticsMembers = defineEndpoint({
  method: 'get',
  path: '/logistics/members',
  scope: 'LOGISTICS',
  paginated: 'page',
  schema: {
    query: pageQuery.extend({ status: z.enum(LOGISTICS_MEMBER_STATUSES).optional() }),
    response: pagedSchema(logisticsMemberSchema),
  },
});

export const inviteLogisticsMember = defineEndpoint({
  method: 'post',
  path: '/logistics/members',
  scope: 'LOGISTICS',
  retryable: true,
  schema: {
    body: z.union([
      z.strictObject({ email: z.string().min(3).max(254), role: z.enum(LOGISTICS_ROLES) }),
      z.strictObject({ phone: z.string().min(5).max(32), role: z.enum(LOGISTICS_ROLES) }),
    ]),
    response: logisticsInviteOutcomeSchema,
  },
});

export const updateLogisticsMember = defineEndpoint({
  method: 'patch',
  path: '/logistics/members/:id',
  scope: 'LOGISTICS',
  schema: {
    params: idParams,
    body: z.union([
      z.strictObject({ role: z.enum(LOGISTICS_ROLES) }),
      z.strictObject({ status: z.literal('REMOVED') }),
    ]),
    response: logisticsMemberSchema,
  },
});

export const listLogisticsInvitations = defineEndpoint({
  method: 'get',
  path: '/logistics/invitations',
  scope: 'LOGISTICS',
  paginated: 'page',
  schema: {
    query: pageQuery.extend({ status: z.enum(LOGISTICS_INVITATION_STATUSES).optional() }),
    response: pagedSchema(logisticsInvitationSchema),
  },
});

export const cancelLogisticsInvitation = defineEndpoint({
  method: 'delete',
  path: '/logistics/invitations/:id',
  scope: 'LOGISTICS',
  schema: { params: idParams, response: logisticsInvitationSchema },
});

// ── Staff (STAFF, logistics.manage) ──────────────────────────────────────────────────────────────

const contact = z.union([
  z.strictObject({ email: z.string().min(3).max(254) }),
  z.strictObject({ phone: z.string().min(5).max(32) }),
]);

export const onboardLogisticsCompany = defineEndpoint({
  method: 'post',
  path: '/admin/logistics/companies',
  scope: 'STAFF',
  retryable: true,
  schema: {
    body: z.strictObject({ name: z.string().min(2).max(120), initialPoc: contact }),
    response: z.discriminatedUnion('outcome', [
      z.object({
        company: logisticsCompanySchema,
        outcome: z.literal('LINKED'),
        member: logisticsMemberSchema,
      }),
      z.object({
        company: logisticsCompanySchema,
        outcome: z.literal('PENDING'),
        invitation: logisticsInvitationSchema,
      }),
    ]),
  },
});

export const listLogisticsCompanies = defineEndpoint({
  method: 'get',
  path: '/admin/logistics/companies',
  scope: 'STAFF',
  paginated: 'page',
  schema: {
    query: pageQuery.extend({ status: z.enum(['ENABLED', 'DISABLED']).optional() }),
    response: pagedSchema(logisticsCompanySchema),
  },
});

export const updateLogisticsCompany = defineEndpoint({
  method: 'patch',
  path: '/admin/logistics/companies/:id',
  scope: 'STAFF',
  schema: {
    params: idParams,
    body: z.strictObject({
      name: z.string().min(2).max(120).optional(),
      status: z.enum(['ENABLED', 'DISABLED']).optional(),
    }),
    response: logisticsCompanySchema,
  },
});

export const listLogisticsCompanyMembers = defineEndpoint({
  method: 'get',
  path: '/admin/logistics/companies/:id/members',
  scope: 'STAFF',
  paginated: 'page',
  schema: {
    params: idParams,
    query: pageQuery.extend({ status: z.enum(LOGISTICS_MEMBER_STATUSES).optional() }),
    response: pagedSchema(logisticsMemberSchema),
  },
});
