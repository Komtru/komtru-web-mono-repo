// T-038. Inviting someone to a staff role. Shaped like `party_invitations` (M1 §5.10): the address is
// hashed for lookup, masked for display and sealed for sending, never stored in clear.
//
// No `users` row is created for an invitee: `bound_user_id` is set only when the invited address is
// VERIFIED by an account that registered the normal way, and the role itself is granted at
// acceptance, through `admin_role_assignments` like every other grant.
import { sql } from 'drizzle-orm';
import { index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, identity } from './columns.js';
import { invitationStatus } from './enums.js';
import { roles } from './rbac.js';
import { users } from './users.js';

export const staffInvitations = identity.table(
  'staff_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    roleCode: text('role_code')
      .notNull()
      .references(() => roles.code),
    destinationHash: bytea('destination_hash').notNull(),
    /** `j••••@example.com`, for display. */
    destinationMasked: text('destination_masked').notNull(),
    destinationEnc: bytea('destination_enc').notNull(),
    /** Why the inviter did it (M1 §10.6). Becomes the reason on the grant. */
    reason: text('reason').notNull(),
    /** The absolute end of the grant; null means the 365-day maximum from acceptance. */
    grantExpiresAt: timestamp('grant_expires_at', { withTimezone: true }),
    tokenHash: bytea('token_hash').notNull().unique(),
    status: invitationStatus('status').notNull().default('PENDING'),
    /** Set when the invited address is verified by a registered account; grants nothing. */
    boundUserId: uuid('bound_user_id').references(() => users.id),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    claimedByUserId: uuid('claimed_by_user_id').references(() => users.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('staff_invitations_dest_idx')
      .on(table.destinationHash)
      .where(sql`${table.status} = 'PENDING'`),
    index('staff_invitations_invited_by_idx').on(table.invitedBy),
    // One live invitation per address and role, enforced here because select-then-insert races.
    uniqueIndex('staff_invitations_pending_unique')
      .on(table.destinationHash, table.roleCode)
      .where(sql`${table.status} = 'PENDING'`),
    // The daily expiry sweep reads PENDING rows by `expires_at`.
    index('staff_invitations_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);
