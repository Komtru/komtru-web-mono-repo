// `GET /admin/me` (F-051): who the signed-in staff member is and what the console may show them.
//
// Nothing here decides access. Roles and permissions are the ones `resolvePrincipal` re-read from the
// database for this very request (live grants only: not revoked, not expired, approved where the role
// needs it), so the console's menu and the backend's check cannot drift. The permission set is sorted
// so the answer is stable. Reading yourself is not an audited admin read: it exposes nothing about
// anyone else and carries no reason.
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { ApiError } from '../../../platform/errors.js';
import type { Principal } from '../../../platform/http/principal.js';
import { roles } from '../infrastructure/postgres/schema/rbac.js';
import { userProfiles, users } from '../infrastructure/postgres/schema/users.js';

export interface StaffMe {
  user: { id: string; publicId: string; displayName: string | null; username: string | null };
  roles: { code: string; name: string }[];
  permissions: string[];
}

export async function getStaffMe(db: Db, principal: Principal): Promise<StaffMe> {
  const [row] = await db
    .select({
      id: users.id,
      publicId: users.publicId,
      username: users.username,
      displayName: userProfiles.displayName,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, principal.userId));
  if (!row) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in with a staff session');

  const named =
    principal.roles.length === 0
      ? []
      : await db
          .select({ code: roles.code, name: roles.name })
          .from(roles)
          .where(inArray(roles.code, [...principal.roles]));
  const byCode = new Map(named.map((role) => [role.code, role.name]));

  return {
    user: {
      id: row.id,
      publicId: row.publicId,
      displayName: row.displayName ?? null,
      username: row.username ?? null,
    },
    roles: principal.roles.map((code) => ({ code, name: byCode.get(code) ?? code })),
    permissions: [...principal.permissions].sort(),
  };
}
