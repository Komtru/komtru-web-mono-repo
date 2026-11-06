// Break-glass: creating the FIRST SUPER_ADMINs (T-037).
//
// A SUPER_ADMIN is a dual-approval role, so the API cannot create the first one: granting needs a
// holder of `role.grant`, and nobody holds it yet. This is the one sanctioned way in, and it is
// shaped to be hard to misuse:
//
//   - it refuses outright if ANY live SUPER_ADMIN assignment exists, so it cannot be used as a
//     back door once the platform is bootstrapped;
//   - it takes the same lock as every other SUPER_ADMIN write, so it cannot race one;
//   - the people being elevated must already exist, be ACTIVE and hold a second factor (the grant
//     itself enforces the last two), and it takes the granter and approver as two OTHER existing
//     users, because the database requires four distinct people on a dual-approval row and the
//     ritual is meant to be witnessed by two humans who are not the grantees;
//   - it writes one audit row per elevation and names the witnesses in it.
//
// It is run by an operator with the owner database URL (`pnpm db:bootstrap-super-admins`), not over
// HTTP. That is the point.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { MAX_SUPER_ADMINS } from '../domain/rbac/sod.js';
import { adminRoleAssignments, roles } from '../infrastructure/postgres/schema/rbac.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import { SUPER_ADMIN_LOCK_KEY, insertAssignment } from './rbac.service.js';

export class BootstrapRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapRefused';
  }
}

export interface BootstrapInput {
  /** One or two people to become SUPER_ADMIN. */
  userIds: readonly string[];
  /** Two other existing users who witness it: the row's `granted_by` and `approved_by`. */
  grantedBy: string;
  approvedBy: string;
  reason: string;
}

export async function bootstrapSuperAdmins(
  db: Db,
  input: BootstrapInput,
): Promise<{ assignmentIds: string[] }> {
  const unique = new Set([...input.userIds, input.grantedBy, input.approvedBy]);
  if (input.userIds.length < 1 || input.userIds.length > MAX_SUPER_ADMINS) {
    throw new BootstrapRefused(`Name one or two users to elevate (at most ${MAX_SUPER_ADMINS}).`);
  }
  if (unique.size !== input.userIds.length + 2) {
    throw new BootstrapRefused('The users, the granter and the approver must all be different people.');
  }
  if (input.reason.trim().length === 0) throw new BootstrapRefused('A reason is required.');

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SUPER_ADMIN_LOCK_KEY})`);

    const existing = await tx
      .select({ id: adminRoleAssignments.id })
      .from(adminRoleAssignments)
      .where(and(eq(adminRoleAssignments.roleCode, 'SUPER_ADMIN'), isNull(adminRoleAssignments.revokedAt)))
      .limit(1);
    if (existing.length > 0) {
      throw new BootstrapRefused(
        'A SUPER_ADMIN assignment already exists; break-glass is for an empty platform.',
      );
    }
    if (
      (await tx.select({ code: roles.code }).from(roles).where(eq(roles.code, 'SUPER_ADMIN'))).length === 0
    ) {
      throw new BootstrapRefused('The SUPER_ADMIN role is not seeded; run `pnpm db:migrate` first.');
    }

    for (const id of unique) {
      const row = (await tx.select({ status: users.status }).from(users).where(eq(users.id, id)))[0];
      if (!row) throw new BootstrapRefused(`No such user: ${id}`);
      if (row.status !== 'ACTIVE') throw new BootstrapRefused(`User ${id} is ${row.status}, not ACTIVE.`);
    }

    const assignmentIds: string[] = [];
    for (const userId of input.userIds) {
      assignmentIds.push(
        await insertAssignment(tx, {
          userId,
          roleCode: 'SUPER_ADMIN',
          grantedBy: input.grantedBy,
          approvedBy: input.approvedBy,
          reason: input.reason,
          expiresAt: undefined,
        }),
      );
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.SUPER_ADMIN_BOOTSTRAPPED,
        outcome: 'SUCCESS',
        actorType: 'SYSTEM',
        actorUserId: null,
        subjectUserId: userId,
        metadata: { reason: input.reason, grantedBy: input.grantedBy, approvedBy: input.approvedBy },
      });
    }
    return { assignmentIds };
  });
}
