// The wire shapes of the logistics routes (m2 §5a, §5b).
//
// Not one portal schema accepts a `companyId`. Every portal object is strict, so a client that sends
// one is refused rather than quietly ignored: the company is the caller's, from the principal, and a
// field that suggests otherwise is a client bug worth surfacing.
import { pageRequestSchema, pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { COMPANY_STATUSES } from '../domain/company.js';
import { INVITATION_CHANNELS } from '../domain/contact.js';
import { MEMBER_ROLES, MEMBER_STATUSES } from '../domain/membership.js';
import { INVITATION_STATUSES } from '../infrastructure/postgres/schema/enums.js';

const role = z.enum(MEMBER_ROLES);

/** Exactly one of an email and a phone. Validated as an address by the service, not here. */
export const contactSchema = z
  .strictObject({
    email: z.string().trim().min(3).max(254).optional(),
    phone: z.string().trim().min(5).max(32).optional(),
  })
  .refine((value) => (value.email === undefined) !== (value.phone === undefined), {
    message: 'Send exactly one of email and phone',
    path: ['email'],
  });

export const idParams = z.strictObject({ id: z.uuid() });

export const companySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(COMPANY_STATUSES),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const memberSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().nullable(),
  contactMasked: z.string().nullable(),
  role,
  status: z.enum(MEMBER_STATUSES),
  invitedAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  removedAt: z.iso.datetime().nullable(),
});

export const invitationSchema = z.strictObject({
  id: z.uuid(),
  role,
  channel: z.enum(INVITATION_CHANNELS),
  contactMasked: z.string(),
  status: z.enum(INVITATION_STATUSES),
  invitedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

/** m2 §2: the two outcomes of an invite, and never a 404 for an address nobody has signed up with. */
export const inviteOutcomeSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('LINKED'), member: memberSchema }),
  z.strictObject({ outcome: z.literal('PENDING'), invitation: invitationSchema }),
]);

// ── Admin (m2 §5a) ─────────────────────────────────────────────────────────────────────────────────

export const onboardBody = z.strictObject({
  name: z.string().trim().min(2).max(120),
  initialPoc: contactSchema,
});

export const onboardResponse = z.discriminatedUnion('outcome', [
  z.strictObject({ company: companySchema, outcome: z.literal('LINKED'), member: memberSchema }),
  z.strictObject({ company: companySchema, outcome: z.literal('PENDING'), invitation: invitationSchema }),
]);

export const companiesQuery = pageRequestSchema.extend({ status: z.enum(COMPANY_STATUSES).optional() });
export const companiesResponse = pagedSchema(companySchema);

export const updateCompanyBody = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(COMPANY_STATUSES).optional(),
  })
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: 'Send a name, a status, or both',
    path: ['name'],
  });

export const membersQuery = pageRequestSchema.extend({ status: z.enum(MEMBER_STATUSES).optional() });
export const membersResponse = pagedSchema(memberSchema);

// ── Portal (m2 §5b) ────────────────────────────────────────────────────────────────────────────────

export const portalMeResponse = z.strictObject({
  company: companySchema,
  member: z.strictObject({ id: z.uuid(), role }),
});

export const inviteBody = z
  .strictObject({
    email: z.string().trim().min(3).max(254).optional(),
    phone: z.string().trim().min(5).max(32).optional(),
    role,
  })
  .refine((value) => (value.email === undefined) !== (value.phone === undefined), {
    message: 'Send exactly one of email and phone',
    path: ['email'],
  });

/** Exactly one change: a new role, or removal. */
export const updateMemberBody = z.union([
  z.strictObject({ role }),
  z.strictObject({ status: z.literal('REMOVED') }),
]);

export const invitationsQuery = pageRequestSchema.extend({ status: z.enum(INVITATION_STATUSES).optional() });
export const invitationsResponse = pagedSchema(invitationSchema);
