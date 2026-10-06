// T-030 left roles, permissions, role_permissions and reserved_usernames empty and deferred the
// seed rows here. There is no migration for them: `seedIdentityCatalogue` is idempotent and runs
// after `pnpm db:migrate`, so re-running it is a no-op and a catalogue change needs no DDL.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_COUNTS } from '../../../../../src/modules/identity/domain/rbac/catalog.js';
import { reservedSkeletonRows } from '../../../../../src/modules/identity/domain/username/reserved.js';
import { seedIdentityCatalogue } from '../../../../../src/modules/identity/infrastructure/postgres/seed.js';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { insertUser } from './support.js';

const counts = async (pool: pg.Pool) => {
  const { rows } = await pool.query<{ roles: number; permissions: number; grants: number; reserved: number }>(
    `SELECT (SELECT count(*) FROM identity.roles)::int AS roles,
            (SELECT count(*) FROM identity.permissions)::int AS permissions,
            (SELECT count(*) FROM identity.role_permissions)::int AS grants,
            (SELECT count(*) FROM identity.reserved_usernames)::int AS reserved`,
  );
  return rows[0];
};

describe.runIf(infraEnabled)('identity catalogue seed', () => {
  const t = useTestDatabase();

  it('inserts every role, permission and grant in the catalogue', async () => {
    const result = await seedIdentityCatalogue(t.db());
    expect(result).toEqual({
      roles: CATALOGUE_COUNTS.roles,
      permissions: CATALOGUE_COUNTS.permissions,
      rolePermissions: CATALOGUE_COUNTS.grants,
      reserved: reservedSkeletonRows().length,
    });
    expect(await counts(t.app())).toEqual({
      roles: 12,
      permissions: 22,
      grants: 105,
      reserved: reservedSkeletonRows().length,
    });
  });

  it('sets requires_dual_approval at insert time', async () => {
    await seedIdentityCatalogue(t.db());
    const { rows } = await t
      .app()
      .query<{ code: string }>('SELECT code FROM identity.roles WHERE requires_dual_approval ORDER BY code');
    expect(rows.map((r) => r.code)).toEqual(['COMPLIANCE_OFFICER', 'FINANCE_ADMIN', 'SUPER_ADMIN']);
  });

  it('is idempotent', async () => {
    await seedIdentityCatalogue(t.db());
    const before = await counts(t.app());
    await seedIdentityCatalogue(t.db());
    expect(await counts(t.app())).toEqual(before);
  });

  // The T-030 backfill trigger refuses a false -> true flip while unapproved live grants exist.
  // Seeding the flag on INSERT means a fresh database never reaches that state, and re-seeding
  // re-asserts the same value rather than flipping it.
  it('re-seeds over a role that already requires dual approval and has a live grant', async () => {
    await seedIdentityCatalogue(t.db());
    const [subject, grantor, approver] = await Promise.all([
      insertUser(t.app()),
      insertUser(t.app()),
      insertUser(t.app()),
    ]);
    await t.app().query(
      `INSERT INTO identity.admin_role_assignments (user_id, role_code, granted_by, approved_by, reason)
         VALUES ($1, 'SUPER_ADMIN', $2, $3, 'test')`,
      [subject, grantor, approver],
    );
    await expect(seedIdentityCatalogue(t.db())).resolves.toMatchObject({ roles: 12 });
  });

  it('removes a grant the catalogue no longer has', async () => {
    await seedIdentityCatalogue(t.db());
    await t.app().query("INSERT INTO identity.role_permissions VALUES ('READ_ONLY', 'user.suspend')");
    await seedIdentityCatalogue(t.db());
    const { rows } = await t
      .app()
      .query(
        "SELECT 1 FROM identity.role_permissions WHERE role_code = 'READ_ONLY' AND permission_code = 'user.suspend'",
      );
    expect(rows).toHaveLength(0);
  });

  it('restores a grant someone deleted by hand', async () => {
    await seedIdentityCatalogue(t.db());
    await t
      .app()
      .query(
        "DELETE FROM identity.role_permissions WHERE role_code = 'SUPER_ADMIN' AND permission_code = 'role.grant'",
      );
    await seedIdentityCatalogue(t.db());
    expect((await counts(t.app()))?.grants).toBe(105);
  });

  it('seeds every fold of every reserved word, so a reserved @flutterwave also blocks @fiutterwave', async () => {
    await seedIdentityCatalogue(t.db());
    const { rows } = await t
      .app()
      .query<{ username_skeleton: string }>(
        "SELECT username_skeleton FROM identity.reserved_usernames WHERE username_skeleton IN ('fluterwave', 'fiuterwave')",
      );
    expect(rows).toHaveLength(2);
  });

  // Trust & Safety owns this table at runtime (M1 §6.2): the seeder never deletes from it.
  it('leaves a row added at runtime alone', async () => {
    await seedIdentityCatalogue(t.db());
    await t
      .app()
      .query(
        "INSERT INTO identity.reserved_usernames (username_skeleton, category) VALUES ('sometermts', 'OFFENSIVE')",
      );
    await seedIdentityCatalogue(t.db());
    const { rows } = await t
      .app()
      .query("SELECT 1 FROM identity.reserved_usernames WHERE username_skeleton = 'sometermts'");
    expect(rows).toHaveLength(1);
  });
});
