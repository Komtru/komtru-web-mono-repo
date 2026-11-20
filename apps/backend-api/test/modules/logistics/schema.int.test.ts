// T-085's migration against a real database: the m2 §3 invariants hold in Postgres itself, including
// under a race, so a service that forgets a check still cannot write the row. Skipped unless
// KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';

describe.runIf(infraEnabled)('logistics schema (migration 0057)', () => {
  const t = useTestDatabase();

  const company = async (name: string, isDefault = false): Promise<string> => {
    const { rows } = await t
      .app()
      .query<{ id: string }>(
        `INSERT INTO logistics.logistics_companies (name, is_default) VALUES ($1, $2) RETURNING id`,
        [name, isDefault],
      );
    return rows[0]!.id;
  };

  const member = (companyId: string, userId: string, status = 'INVITED', role = 'ADMIN') =>
    t.app().query<{ id: string }>(
      `INSERT INTO logistics.logistics_company_members (company_id, user_id, role, status)
         VALUES ($1, $2, $3::logistics.member_role, $4::logistics.member_status) RETURNING id`,
      [companyId, userId, role, status],
    );

  it('allows at most one default company (Park)', async () => {
    await company('Komtru Park', true);
    await expect(company('Another default', true)).rejects.toMatchObject({
      constraint: 'logistics_companies_one_default_uidx',
    });
    await expect(company('Swift Couriers')).resolves.toBeDefined();
  });

  it('lets two simultaneous activations for one user produce exactly one ACTIVE row', async () => {
    const userId = randomUUID();
    const a = await company('Courier A');
    const b = await company('Courier B');
    const rowA = (await member(a, userId)).rows[0]!.id;
    const rowB = (await member(b, userId)).rows[0]!.id;

    const activate = (id: string) =>
      t
        .app()
        .query(
          `UPDATE logistics.logistics_company_members SET status = 'ACTIVE', accepted_at = now() WHERE id = $1`,
          [id],
        );
    const results = await Promise.allSettled([activate(rowA), activate(rowB)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.reason).toMatchObject({ constraint: 'logistics_company_members_active_user_uidx' });
    const { rows } = await t
      .app()
      .query(`SELECT id FROM logistics.logistics_company_members WHERE user_id = $1 AND status = 'ACTIVE'`, [
        userId,
      ]);
    expect(rows).toHaveLength(1);
  });

  it('refuses a second live row for one person at one company, but keeps history', async () => {
    const userId = randomUUID();
    const a = await company('Courier A');
    await member(a, userId, 'ACTIVE');
    await expect(member(a, userId, 'INVITED')).rejects.toMatchObject({
      constraint: 'logistics_company_members_company_user_live_uidx',
    });
    await t
      .app()
      .query(`UPDATE logistics.logistics_company_members SET status = 'REMOVED' WHERE user_id = $1`, [
        userId,
      ]);
    await expect(member(a, userId, 'INVITED')).resolves.toBeDefined();
  });

  it('allows one non-REJECTED package per trade, and a new one after a rejection', async () => {
    const a = await company('Courier A');
    const tradeId = randomUUID();
    const pkg = (status: string) =>
      t.app().query(
        `INSERT INTO logistics.logistics_packages (trade_id, company_id, requested_by_user_id, status)
           VALUES ($1, $2, $3, $4::logistics.package_status)`,
        [tradeId, a, randomUUID(), status],
      );
    await pkg('REJECTED');
    await pkg('REQUESTED');
    await expect(pkg('ACCEPTED')).rejects.toMatchObject({ constraint: 'logistics_packages_trade_live_uidx' });
  });

  it('keeps the package status history append-only for the app role', async () => {
    const a = await company('Courier A');
    const { rows } = await t.app().query<{ id: string }>(
      `INSERT INTO logistics.logistics_packages (trade_id, company_id, requested_by_user_id)
         VALUES ($1, $2, $3) RETURNING id`,
      [randomUUID(), a, randomUUID()],
    );
    const packageId = rows[0]!.id;
    await t
      .app()
      .query(
        `INSERT INTO logistics.logistics_package_status_events (package_id, to_status) VALUES ($1, 'REQUESTED')`,
        [packageId],
      );
    await expect(
      t.app().query(`UPDATE logistics.logistics_package_status_events SET note = 'edited'`),
    ).rejects.toThrow();
    await expect(t.owner().query(`DELETE FROM logistics.logistics_package_status_events`)).rejects.toThrow();
  });

  it('allows one pending invitation per address per company', async () => {
    const a = await company('Courier A');
    const invite = () =>
      t.app().query(
        `INSERT INTO logistics.logistics_member_invitations
           (company_id, role, channel, destination_hash, destination_masked, destination_enc, expires_at)
         VALUES ($1, 'OPERATOR', 'EMAIL', '\\x01', 'j•••@example.com', '\\x02', now() + interval '7 days')`,
        [a],
      );
    await invite();
    await expect(invite()).rejects.toMatchObject({ constraint: 'logistics_member_invitations_pending_uidx' });
  });
});
