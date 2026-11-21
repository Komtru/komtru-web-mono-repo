// m2 §3: companies, their members and the invitations that become members.
//
// The two invariants two concurrent requests could both pass are partial unique indexes, not
// service checks (backend CLAUDE.md): one ACTIVE company per person, and one live (INVITED or
// ACTIVE) row per person per company. A third keeps Park the only default company.
import { sql } from 'drizzle-orm';
import { boolean, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, logistics } from './columns.js';
import { companyStatus, invitationChannel, invitationStatus, memberRole, memberStatus } from './enums.js';

export const logisticsCompanies = logistics.table(
  'logistics_companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    status: companyStatus('status').notNull().default('ENABLED'),
    /** Park (design §7.1). Pinned first in the ship-step list; at most one row may hold it. */
    isDefault: boolean('is_default').notNull().default(false),
    /** Soft ref to identity.users. Null only for the seeded Park row, which no person onboarded. */
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('logistics_companies_status_idx').on(table.status),
    uniqueIndex('logistics_companies_one_default_uidx')
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
);

export const logisticsCompanyMembers = logistics.table(
  'logistics_company_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => logisticsCompanies.id, { onDelete: 'cascade' }),
    /** Soft ref to identity.users. Removing a member never touches that row. */
    userId: uuid('user_id').notNull(),
    role: memberRole('role').notNull(),
    status: memberStatus('status').notNull().default('INVITED'),
    /** Null for the first POC staff create at onboarding; the company row records that admin. */
    invitedByUserId: uuid('invited_by_user_id'),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('logistics_company_members_company_idx').on(table.companyId, table.status),
    // m2 §3 index 1: one ACTIVE company per person, under any race. `409 ALREADY_HAS_ACTIVE_COMPANY`.
    uniqueIndex('logistics_company_members_active_user_uidx')
      .on(table.userId)
      .where(sql`${table.status} = 'ACTIVE'`),
    // m2 §3 index 2: no second live row for one person at one company. `409 ALREADY_A_MEMBER`.
    uniqueIndex('logistics_company_members_company_user_live_uidx')
      .on(table.companyId, table.userId)
      .where(sql`${table.status} IN ('INVITED', 'ACTIVE')`),
  ],
);

/**
 * m2 §2 REVISED: an invitation to an address no verified account holds yet. Shaped like
 * `identity.staff_invitations`: hashed for lookup, masked for display, sealed for sending — the
 * address is never stored in the clear. It becomes a member row when the invitee verifies the
 * address through identity's ordinary signup, and never creates a `users` row itself.
 */
export const logisticsMemberInvitations = logistics.table(
  'logistics_member_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => logisticsCompanies.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    channel: invitationChannel('channel').notNull(),
    destinationHash: bytea('destination_hash').notNull(),
    destinationMasked: text('destination_masked').notNull(),
    destinationEnc: bytea('destination_enc').notNull(),
    status: invitationStatus('status').notNull().default('PENDING'),
    /** Soft ref; null when staff invite the first POC at onboarding. */
    invitedByUserId: uuid('invited_by_user_id'),
    /** The membership it became. */
    memberId: uuid('member_id').references(() => logisticsCompanyMembers.id, { onDelete: 'set null' }),
    acceptedByUserId: uuid('accepted_by_user_id'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('logistics_member_invitations_dest_idx')
      .on(table.destinationHash)
      .where(sql`${table.status} = 'PENDING'`),
    index('logistics_member_invitations_company_idx').on(table.companyId, table.status),
    // One pending invitation per address per company; select-then-insert races.
    uniqueIndex('logistics_member_invitations_pending_uidx')
      .on(table.companyId, table.destinationHash)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);
