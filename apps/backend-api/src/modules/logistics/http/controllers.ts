// The logistics routes as HTTP (m2 §5a, §5b).
//
// The portal half has one rule, and every handler goes through `portalMember` to keep it: the company
// is the principal's, re-resolved from the database this request (identity's principal service), and
// never read from the path, the query or the body. A caller whose membership was removed a second ago
// has none, and is answered `403 NO_LOGISTICS_ACCESS`.
import { isIP } from 'node:net';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import type { Actor, CompanyMembership } from '../../../platform/http/principal.js';
import { requireUserId } from '../../../platform/http/principal.js';
import { parseInviteContact, type InviteContact } from '../domain/contact.js';
import { MEMBER_ROLES, canManageMembers, type MemberRole } from '../domain/membership.js';
import { logisticsCompanyMembers } from '../infrastructure/postgres/schema/index.js';
import { listCompanies, listMembers, onboardCompany, updateCompany } from '../services/company.service.js';
import { cancelInvitation, listInvitations } from '../services/invitation.service.js';
import type { LogisticsActor } from '../services/audit.js';
import { inviteToCompany, updateMember, type LogisticsCrypto } from '../services/member.service.js';
import { findCompany } from '../services/views.js';
import type {
  companiesQuery,
  invitationsQuery,
  inviteBody,
  membersQuery,
  onboardBody,
  updateCompanyBody,
  updateMemberBody,
} from './validations.js';

export interface LogisticsHttpDeps {
  db: () => Db;
  crypto: () => LogisticsCrypto;
}

export const noLogisticsAccess = (): ApiError =>
  new ApiError(
    403,
    'NO_LOGISTICS_ACCESS',
    "This account isn't attached to a logistics company",
    'Ask your company admin to add you, then sign in again',
  );

const adminOnly = (): ApiError =>
  new ApiError(403, 'FORBIDDEN', 'Admins only', 'Only a company admin can manage the team');

const invalidContact = (): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'Check the email or phone number', undefined, [
    { path: 'email', message: 'Enter a valid email address or phone number' },
  ]);

const isMemberRole = (value: string): value is MemberRole =>
  (MEMBER_ROLES as readonly string[]).includes(value);

export interface PortalMember extends CompanyMembership {
  userId: string;
  role: MemberRole;
}

/** The caller's company and role, from the principal and nowhere else. */
export function portalMember(actor: Actor): PortalMember {
  const userId = requireUserId(actor, 'Sign in to the logistics portal');
  const membership = actor.principal?.companyMembership;
  if (!membership || !isMemberRole(membership.role)) throw noLogisticsAccess();
  return { userId, companyId: membership.companyId, role: membership.role };
}

/** Who is acting, for the audit row and the event, with the request's network facts. */
const actingAs = (
  kind: LogisticsActor['kind'],
  userId: string,
  actor: Actor,
  req: Request,
): LogisticsActor => ({
  kind,
  userId,
  sessionId: actor.principal?.sessionId,
  ip: req.ip !== undefined && isIP(req.ip) ? req.ip : null,
  userAgent: req.get('user-agent') ?? null,
});

const staffActor = (actor: Actor, req: Request, detail: string): LogisticsActor =>
  actingAs('STAFF', requireUserId(actor, detail), actor, req);

/**
 * A fast refusal for an operator, from the membership read when the request arrived. Not the
 * authority: every mutation re-reads the caller's row under the company lock (`requireActingAdmin`).
 */
const requireAdmin = (member: PortalMember): PortalMember => {
  if (!canManageMembers(member.role)) throw adminOnly();
  return member;
};

const contactOf = (input: { email?: string | undefined; phone?: string | undefined }): InviteContact => {
  const contact = parseInviteContact({
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
  });
  if (!contact) throw invalidContact();
  return contact;
};

// ── Admin (STAFF + logistics.manage, enforced by the route table) ──────────────────────────────────

export const onboardHandler = (
  deps: LogisticsHttpDeps,
  actor: Actor,
  req: Request,
  body: z.output<typeof onboardBody>,
) =>
  onboardCompany(deps.db(), deps.crypto(), {
    name: body.name,
    initialPoc: contactOf(body.initialPoc),
    actor: staffActor(actor, req, 'Sign in to onboard a logistics company'),
  });

export const listCompaniesHandler = (deps: LogisticsHttpDeps, query: z.output<typeof companiesQuery>) =>
  listCompanies(deps.db(), {
    page: query.page,
    limit: query.limit,
    ...(query.status ? { status: query.status } : {}),
  });

export const updateCompanyHandler = (
  deps: LogisticsHttpDeps,
  actor: Actor,
  req: Request,
  companyId: string,
  body: z.output<typeof updateCompanyBody>,
) =>
  updateCompany(deps.db(), {
    companyId,
    actor: staffActor(actor, req, 'Sign in to update a logistics company'),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
  });

export const adminMembersHandler = (
  deps: LogisticsHttpDeps,
  companyId: string,
  query: z.output<typeof membersQuery>,
) =>
  listMembers(deps.db(), {
    companyId,
    page: query.page,
    limit: query.limit,
    ...(query.status ? { statuses: [query.status] } : {}),
  });

// ── Portal (LOGISTICS, company from the principal) ─────────────────────────────────────────────────

export async function portalMeHandler(deps: LogisticsHttpDeps, actor: Actor) {
  const member = portalMember(actor);
  const db = deps.db();
  const company = await findCompany(db, member.companyId);
  const row = (
    await db
      .select({ id: logisticsCompanyMembers.id, role: logisticsCompanyMembers.role })
      .from(logisticsCompanyMembers)
      .where(
        and(
          eq(logisticsCompanyMembers.companyId, member.companyId),
          eq(logisticsCompanyMembers.userId, member.userId),
          eq(logisticsCompanyMembers.status, 'ACTIVE'),
        ),
      )
  )[0];
  if (!company || !row) throw noLogisticsAccess();
  return { company, member: row };
}

export const portalMembersHandler = (
  deps: LogisticsHttpDeps,
  actor: Actor,
  query: z.output<typeof membersQuery>,
) =>
  listMembers(deps.db(), {
    companyId: portalMember(actor).companyId,
    page: query.page,
    limit: query.limit,
    ...(query.status ? { statuses: [query.status] } : {}),
  });

export function portalInviteHandler(
  deps: LogisticsHttpDeps,
  actor: Actor,
  req: Request,
  body: z.output<typeof inviteBody>,
) {
  const member = requireAdmin(portalMember(actor));
  const contact = contactOf(body);
  return deps.db().transaction((tx) =>
    inviteToCompany(tx, deps.crypto(), {
      companyId: member.companyId,
      role: body.role,
      contact,
      invitedByUserId: member.userId,
      actor: actingAs('MEMBER', member.userId, actor, req),
    }),
  );
}

export function portalUpdateMemberHandler(
  deps: LogisticsHttpDeps,
  actor: Actor,
  req: Request,
  memberId: string,
  body: z.output<typeof updateMemberBody>,
) {
  const member = requireAdmin(portalMember(actor));
  return deps.db().transaction((tx) =>
    updateMember(tx, {
      companyId: member.companyId,
      memberId,
      change: 'role' in body ? { kind: 'ROLE', role: body.role } : { kind: 'REMOVE' },
      actor: actingAs('MEMBER', member.userId, actor, req),
    }),
  );
}

export const portalInvitationsHandler = (
  deps: LogisticsHttpDeps,
  actor: Actor,
  query: z.output<typeof invitationsQuery>,
) =>
  listInvitations(deps.db(), {
    companyId: portalMember(actor).companyId,
    page: query.page,
    limit: query.limit,
    ...(query.status ? { status: query.status } : {}),
  });

export function portalCancelInvitationHandler(
  deps: LogisticsHttpDeps,
  actor: Actor,
  req: Request,
  invitationId: string,
) {
  const member = requireAdmin(portalMember(actor));
  return deps.db().transaction((tx) =>
    cancelInvitation(tx, {
      companyId: member.companyId,
      invitationId,
      actor: actingAs('MEMBER', member.userId, actor, req),
    }),
  );
}
