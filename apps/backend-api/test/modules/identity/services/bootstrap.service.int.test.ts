// T-037: the break-glass path that creates the first SUPER_ADMINs.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BootstrapRefused,
  bootstrapSuperAdmins,
} from '../../../../src/modules/identity/services/bootstrap.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser } from '../support.js';
import { seedCatalogue } from '../http/staff.support.js';

describe.runIf(infraEnabled)('bootstrapping the first SUPER_ADMINs', () => {
  const t = useTestDatabase();

  beforeEach(async () => {
    await seedCatalogue(t);
  });

  const factor = (userId: string) =>
    t
      .owner()
      .query(
        `INSERT INTO identity.mfa_factors (user_id, factor_type, status, verified_at) VALUES ($1, 'TOTP', 'ACTIVE', now())`,
        [userId],
      );

  const cast = async () => {
    const a = (await seedUser(t.app())).userId;
    const b = (await seedUser(t.app())).userId;
    const witness1 = (await seedUser(t.app())).userId;
    const witness2 = (await seedUser(t.app())).userId;
    await factor(a);
    await factor(b);
    return { a, b, witness1, witness2 };
  };
  const run = (
    c: Awaited<ReturnType<typeof cast>>,
    over: Partial<Parameters<typeof bootstrapSuperAdmins>[1]> = {},
  ) =>
    bootstrapSuperAdmins(t.db(), {
      userIds: [c.a, c.b],
      grantedBy: c.witness1,
      approvedBy: c.witness2,
      reason: 'initial platform setup',
      ...over,
    });

  it('creates both initial SUPER_ADMINs, time-boxed and audited, once', async () => {
    const c = await cast();
    const { assignmentIds } = await run(c);
    expect(assignmentIds).toHaveLength(2);
    const { rows } = await t
      .owner()
      .query<{ expires_at: Date | null; approved_by: string }>(
        `SELECT expires_at, approved_by FROM identity.admin_role_assignments WHERE role_code = 'SUPER_ADMIN'`,
      );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.expires_at !== null && row.approved_by === c.witness2)).toBe(true);
    const audit = await t
      .owner()
      .query(
        `SELECT 1 FROM identity.identity_audit_log WHERE action = 'SUPER_ADMIN_BOOTSTRAPPED' AND actor_type = 'SYSTEM'`,
      );
    expect(audit.rowCount).toBe(2);
  });

  it('refuses to run again once any SUPER_ADMIN exists', async () => {
    const c = await cast();
    await run(c, { userIds: [c.a] });
    await expect(run(c, { userIds: [c.b] })).rejects.toThrow(BootstrapRefused);
    await expect(run(c, { userIds: [c.b] })).rejects.toThrow(/already exists/);
  });

  it('refuses a user with no second factor, a missing user and a non-ACTIVE one', async () => {
    const c = await cast();
    const bare = (await seedUser(t.app())).userId;
    await expect(run(c, { userIds: [bare] })).rejects.toMatchObject({
      detail: expect.stringMatching(/second factor/) as unknown,
    });
    await expect(run(c, { userIds: ['0190a6e0-0000-7000-8000-000000000000'] })).rejects.toThrow(
      /No such user/,
    );
    const suspended = (await seedUser(t.app(), { status: 'SUSPENDED' })).userId;
    await expect(run(c, { userIds: [suspended] })).rejects.toThrow(/not ACTIVE/);
    expect((await t.owner().query(`SELECT 1 FROM identity.admin_role_assignments`)).rowCount).toBe(0);
  });

  it('refuses overlapping people, too many users and a blank reason', async () => {
    const c = await cast();
    await expect(run(c, { grantedBy: c.a })).rejects.toThrow(/different people/);
    await expect(run(c, { approvedBy: c.witness1 })).rejects.toThrow(/different people/);
    await expect(run(c, { userIds: [] })).rejects.toThrow(/one or two/);
    await expect(run(c, { userIds: [c.a, c.b, c.witness1] })).rejects.toThrow(/one or two/);
    await expect(run(c, { reason: '  ' })).rejects.toThrow(/reason/);
  });
});
