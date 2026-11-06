// T-042's table, against a real database: the rules the database enforces on the service's behalf.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { seedUser } from './support.js';

describe.runIf(infraEnabled)('identity.user_addresses (T-042)', () => {
  const t = useTestDatabase();
  const STATE = '0190b0a0-0000-7000-8000-000000000001';
  const CITY = '0190b0a0-0000-7000-8000-000000000002';

  const insert = async (userId: string, over: Record<string, unknown> = {}) => {
    const row = {
      user_id: userId,
      label: 'Home',
      recipient_name: 'Ada Obi',
      recipient_phone: '+2348012345678',
      street_line: '12 Allen Avenue',
      state_id: STATE,
      city_id: CITY,
      is_default: false,
      archived_at: null,
      ...over,
    };
    const cols = Object.keys(row);
    return t.app().query<{ id: string }>(
      `INSERT INTO identity.user_addresses (${cols.join(', ')})
         VALUES (${cols.map((_c, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
  };

  it('allows one default per user and not two', async () => {
    const { userId } = await seedUser(t.app());
    await insert(userId, { is_default: true });
    await expect(insert(userId, { is_default: true })).rejects.toMatchObject({
      constraint: 'user_addresses_one_default',
    });
    // Another user's default is independent, and any number of non-defaults is fine.
    const other = await seedUser(t.app());
    await insert(other.userId, { is_default: true });
    await insert(userId);
    await insert(userId);
  });

  it('refuses a default that is archived', async () => {
    const { userId } = await seedUser(t.app());
    await expect(insert(userId, { is_default: true, archived_at: new Date() })).rejects.toMatchObject({
      constraint: 'user_addresses_default_is_live',
    });
  });

  it('refuses a phone that is not E.164 and a blank label', async () => {
    const { userId } = await seedUser(t.app());
    await expect(insert(userId, { recipient_phone: '08012345678' })).rejects.toMatchObject({
      constraint: 'user_addresses_phone_e164',
    });
    await expect(insert(userId, { label: '   ' })).rejects.toMatchObject({
      constraint: 'user_addresses_text_not_blank',
    });
  });

  it('keeps no foreign key into geo: the references are soft', async () => {
    const { rows } = await t
      .owner()
      .query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'identity.user_addresses'::regclass AND contype = 'f'`,
      );
    expect(rows.map((r) => r.conname)).toEqual(['user_addresses_user_id_users_id_fk']);
  });

  it('is never deleted, by the owner or the app role', async () => {
    const { userId } = await seedUser(t.app());
    await insert(userId);
    await expect(t.owner().query(`DELETE FROM identity.user_addresses`)).rejects.toMatchObject({
      code: 'KT002',
    });
    await expect(t.app().query(`DELETE FROM identity.user_addresses`)).rejects.toThrow();
    const { rows } = await t
      .app()
      .query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.user_addresses`);
    expect(rows[0]?.n).toBe(1);
  });
});
