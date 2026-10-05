// M1 §5.7. Capabilities say what an account may do; roles and permissions say what a staff member
// may do, and every grant of one is a four-eyes event.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { identity } from './columns.js';
import { capabilityStatus, capabilityType } from './enums.js';
import { users } from './users.js';

export const userCapabilities = identity.table(
  'user_capabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    capability: capabilityType('capability').notNull(),
    status: capabilityStatus('status').notNull().default('PENDING'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),
    grantedBy: uuid('granted_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('user_capabilities_unique').on(table.userId, table.capability)],
);

export const roles = identity.table('roles', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  isStaffRole: boolean('is_staff_role').notNull().default(true),
  requiresDualApproval: boolean('requires_dual_approval').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = identity.table('permissions', {
  /** `trade.refund`. */
  code: text('code').primaryKey(),
  domain: text('domain').notNull(),
  action: text('action').notNull(),
  description: text('description'),
  isFinancial: boolean('is_financial').notNull().default(false),
  isDestructive: boolean('is_destructive').notNull().default(false),
});

export const rolePermissions = identity.table(
  'role_permissions',
  {
    roleCode: text('role_code')
      .notNull()
      .references(() => roles.code, { onDelete: 'cascade' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleCode, table.permissionCode] })],
);

export const adminRoleAssignments = identity.table(
  'admin_role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleCode: text('role_code')
      .notNull()
      .references(() => roles.code),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => users.id),
    /** Required for a role whose `requires_dual_approval` is set — see migration 0009's trigger. */
    approvedBy: uuid('approved_by').references(() => users.id),
    reason: text('reason').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    // Four eyes: the approver can never be the grantor, and nobody grants themselves a role.
    check(
      'admin_role_distinct_approver',
      sql`${table.approvedBy} IS NULL OR ${table.approvedBy} <> ${table.grantedBy}`,
    ),
    check('admin_role_no_self_grant', sql`${table.grantedBy} <> ${table.userId}`),
    uniqueIndex('admin_role_active_unique')
      .on(table.userId, table.roleCode)
      .where(sql`${table.revokedAt} IS NULL`),
    index('admin_role_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/**
 * Second approver for administrative *actions* — MFA reset, forced username change, large refunds.
 * Distinct from the role-grant approval above: holding the permission lets you request the action,
 * and a different holder must approve it (M1 §12.3 note 3).
 */
export const adminActionApprovals = identity.table(
  'admin_action_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: text('action').notNull(),
    subjectUserId: uuid('subject_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    reason: text('reason').notNull(),
    payload: jsonb('payload'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
  },
  (table) => [
    check(
      'admin_action_distinct_approver',
      sql`${table.approvedBy} IS NULL OR ${table.approvedBy} <> ${table.requestedBy}`,
    ),
    index('admin_action_approvals_pending_idx')
      .on(table.action, table.requestedAt)
      .where(sql`${table.approvedAt} IS NULL AND ${table.rejectedAt} IS NULL`),
  ],
);
