// M1 §5.10. Tagging someone who has no account yet: the destination is stored hashed for lookup,
// masked for display and encrypted for sending — never in plaintext, because an invitation table is
// a contact list of people who never signed up.
import { sql } from 'drizzle-orm';
import { index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea, identity } from './columns.js';
import { invitationStatus, otpChannel } from './enums.js';
import { users } from './users.js';

export const partyInvitations = identity.table(
  'party_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inviterUserId: uuid('inviter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: otpChannel('channel').notNull(),
    destinationHash: bytea('destination_hash').notNull(),
    /** `j••••@gmail.com`, for display. */
    destinationMasked: text('destination_masked').notNull(),
    destinationEnc: bytea('destination_enc').notNull(),
    /** BUYER | SELLER — the side the invitee takes on the trade, not a capability. */
    intendedRole: text('intended_role').notNull(),
    contextType: text('context_type'),
    /** The trade id, if any. Cross-schema (M7), so a plain uuid. */
    contextId: uuid('context_id'),
    tokenHash: bytea('token_hash').notNull().unique(),
    status: invitationStatus('status').notNull().default('PENDING'),
    claimedByUserId: uuid('claimed_by_user_id').references(() => users.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('party_invitations_dest_idx')
      .on(table.destinationHash)
      .where(sql`${table.status} = 'PENDING'`),
    index('party_invitations_inviter_idx').on(table.inviterUserId),
  ],
);
