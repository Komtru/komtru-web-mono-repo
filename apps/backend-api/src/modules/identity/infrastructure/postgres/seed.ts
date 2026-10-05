// Reference data the identity schema needs in order to function: the M1 §12 RBAC catalogue and the
// M1 §6.2 reserved namespace.
//
// **Not a migration.** The catalogue changes whenever a module adds a permission, which is far more
// often than the schema changes, and a migration per change would mean a DDL deploy to grant
// SUPPORT_LEAD one more read. This runs after `pnpm db:migrate` (and standalone as `pnpm db:seed`)
// through the `seed` hook on KomtruModule, and it is idempotent: running it twice changes nothing.
//
// Everything here is derived from `domain/rbac/catalog.ts` and `domain/username/reserved.ts`. Those
// files are the source of truth; this one only reconciles the database to them.
import { and, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../../db/index.js';
import {
  CATALOGUE_COUNTS,
  PERMISSIONS,
  PERMISSION_CODES,
  ROLES,
  ROLE_CODES,
  grantFor,
} from '../../domain/rbac/catalog.js';
import { reservedSkeletonRows } from '../../domain/username/reserved.js';
import { permissions, rolePermissions, roles } from './schema/rbac.js';
import { reservedUsernames } from './schema/usernames.js';

export interface SeedResult {
  roles: number;
  permissions: number;
  rolePermissions: number;
  reserved: number;
}

const grantRows = (): { roleCode: string; permissionCode: string }[] =>
  PERMISSION_CODES.flatMap((permissionCode) =>
    ROLE_CODES.filter((roleCode) => grantFor(roleCode, permissionCode) !== 'DENY').map((roleCode) => ({
      roleCode,
      permissionCode,
    })),
  );

export async function seedIdentityCatalogue(db: Db): Promise<SeedResult> {
  const grants = grantRows();
  const reserved = reservedSkeletonRows();

  await db.transaction(async (tx) => {
    // `requires_dual_approval` is written by the INSERT, never flipped later: T-030's
    // `roles_dual_approval_backfill` trigger refuses a false -> true transition while unapproved
    // live grants of that role exist, so a role that arrives with the flag already set can never
    // reach that state. The ON CONFLICT re-asserts the same value, which the trigger ignores
    // because it only fires on an actual transition — and if the value really has drifted, KT002 is
    // the correct, loud outcome rather than a silent half-enforced rule.
    await tx
      .insert(roles)
      .values(
        ROLES.map(({ code, name, description, isStaffRole, requiresDualApproval }) => ({
          code,
          name,
          description,
          isStaffRole,
          requiresDualApproval,
        })),
      )
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          isStaffRole: sql`excluded.is_staff_role`,
          requiresDualApproval: sql`excluded.requires_dual_approval`,
        },
      });

    await tx
      .insert(permissions)
      .values(
        PERMISSIONS.map(({ code, domain, action, description, isFinancial, isDestructive }) => ({
          code,
          domain,
          action,
          description,
          isFinancial,
          isDestructive,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.code,
        set: {
          domain: sql`excluded.domain`,
          action: sql`excluded.action`,
          description: sql`excluded.description`,
          isFinancial: sql`excluded.is_financial`,
          isDestructive: sql`excluded.is_destructive`,
        },
      });

    await tx.insert(rolePermissions).values(grants).onConflictDoNothing();

    // Reconcile downwards too. A grant withdrawn from the matrix has to disappear from the database
    // or the catalogue stops being the answer to "who can do this". Scoped to codes the catalogue
    // knows, so a role T-037 adds before this file catches up is left alone rather than stripped.
    await tx.delete(rolePermissions).where(
      and(
        inArray(rolePermissions.roleCode, [...ROLE_CODES]),
        inArray(rolePermissions.permissionCode, [...PERMISSION_CODES]),
        sql`(${rolePermissions.roleCode}, ${rolePermissions.permissionCode}) NOT IN (${sql.join(
          grants.map(({ roleCode, permissionCode }) => sql`(${roleCode}, ${permissionCode})`),
          sql`, `,
        )})`,
      ),
    );

    // Never deleted: Trust & Safety adds to this table at runtime through `username.reserve`
    // (M1 §6.2), and a seeder that reconciled downwards would silently undo their work.
    await tx
      .insert(reservedUsernames)
      .values(
        reserved.map(({ usernameSkeleton, category, note }) => ({
          usernameSkeleton,
          category,
          ...(note ? { note } : {}),
        })),
      )
      .onConflictDoNothing();
  });

  return {
    roles: CATALOGUE_COUNTS.roles,
    permissions: CATALOGUE_COUNTS.permissions,
    rolePermissions: grants.length,
    reserved: reserved.length,
  };
}
