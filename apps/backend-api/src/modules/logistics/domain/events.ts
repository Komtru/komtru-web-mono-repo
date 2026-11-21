// What the logistics module publishes, through the transactional outbox, in the transaction that made
// it true (m2 §4 `events.ts`). No payload carries an email address or a phone number: an invitation is
// named by its id and channel, and the address stays sealed in its row.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';
import { COMPANY_STATUSES } from './company.js';
import { INVITATION_CHANNELS } from './contact.js';
import { MEMBER_ROLES } from './membership.js';

const role = z.enum(MEMBER_ROLES);

export const logisticsCompanyCreated = defineEvent(
  'logistics.company.created',
  1,
  z.object({ companyId: z.uuid(), name: z.string().min(1), createdByUserId: z.uuid() }),
);

export const logisticsCompanyUpdated = defineEvent(
  'logistics.company.updated',
  1,
  z.object({ companyId: z.uuid(), name: z.string().min(1), status: z.enum(COMPANY_STATUSES) }),
);

/**
 * A membership row now exists for a real account, at `INVITED`: either the invited address already
 * belonged to a verified account (`LINKED`), or a pending invitation just materialised because its
 * invitee verified that address (`INVITATION`). Notify tells the invitee (m2 §13.5).
 */
export const logisticsMemberInvited = defineEvent(
  'logistics.member.invited',
  1,
  z.object({
    memberId: z.uuid(),
    companyId: z.uuid(),
    companyName: z.string().min(1),
    userId: z.uuid(),
    role,
    via: z.enum(['LINKED', 'INVITATION']),
  }),
);

/** Login is acceptance (m2 §2): the first logistics sign-in moved the row to ACTIVE. */
export const logisticsMemberActivated = defineEvent(
  'logistics.member.activated',
  1,
  z.object({ memberId: z.uuid(), companyId: z.uuid(), userId: z.uuid() }),
);

export const logisticsMemberRoleChanged = defineEvent(
  'logistics.member.role_changed',
  1,
  z.object({ memberId: z.uuid(), companyId: z.uuid(), userId: z.uuid(), from: role, to: role }),
);

export const logisticsMemberRemoved = defineEvent(
  'logistics.member.removed',
  1,
  z.object({ memberId: z.uuid(), companyId: z.uuid(), userId: z.uuid() }),
);

export const logisticsInvitationCreated = defineEvent(
  'logistics.invitation.created',
  1,
  z.object({
    invitationId: z.uuid(),
    companyId: z.uuid(),
    role,
    channel: z.enum(INVITATION_CHANNELS),
  }),
);

export const logisticsInvitationCancelled = defineEvent(
  'logistics.invitation.cancelled',
  1,
  z.object({ invitationId: z.uuid(), companyId: z.uuid() }),
);
