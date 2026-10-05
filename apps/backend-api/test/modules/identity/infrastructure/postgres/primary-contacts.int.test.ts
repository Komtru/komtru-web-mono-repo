// M1 §5.4's composite foreign keys. A simple FK on (primary_email_id) would happily let user A's
// primary email point at user B's row, which is how a password reset reaches an attacker.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { constraintName, insertUser } from './support.js';

describe.runIf(infraEnabled)('primary contact pointers', () => {
  const t = useTestDatabase();

  const addEmail = async (userId: string, email = `${userId.slice(0, 8)}@example.com`) => {
    const { rows } = await t.app().query<{ id: string }>(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary)
       VALUES ($1, $2, $2, true) RETURNING id`,
      [userId, email],
    );
    return rows[0]!.id;
  };

  const addPhone = async (userId: string, phone: string) => {
    const { rows } = await t.app().query<{ id: string }>(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary)
       VALUES ($1, $2, 'NG', true) RETURNING id`,
      [userId, phone],
    );
    return rows[0]!.id;
  };

  const setPrimaryEmail = (userId: string, emailId: string | null) =>
    t.app().query(`UPDATE identity.users SET primary_email_id = $2 WHERE id = $1`, [userId, emailId]);

  const setPrimaryPhone = (userId: string, phoneId: string | null) =>
    t.app().query(`UPDATE identity.users SET primary_phone_id = $2 WHERE id = $1`, [userId, phoneId]);

  const primaryIds = async (userId: string) => {
    const { rows } = await t
      .app()
      .query<{ primary_email_id: string | null; primary_phone_id: string | null }>(
        `SELECT primary_email_id, primary_phone_id FROM identity.users WHERE id = $1`,
        [userId],
      );
    return rows[0];
  };

  it('accepts a primary email belonging to the same user', async () => {
    const user = await insertUser(t.app());
    await setPrimaryEmail(user, await addEmail(user));
    expect((await primaryIds(user))?.primary_email_id).toEqual(expect.any(String));
  });

  it('rejects a primary email belonging to another user', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    expect(await constraintName(setPrimaryEmail(a, await addEmail(b)))).toBe('users_primary_email_fk');
  });

  it('rejects a primary phone belonging to another user', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    expect(await constraintName(setPrimaryPhone(a, await addPhone(b, '+2348012345678')))).toBe(
      'users_primary_phone_fk',
    );
  });

  it('nulls the pointer when the email row is deleted, keeping the user', async () => {
    const user = await insertUser(t.app());
    const emailId = await addEmail(user);
    await setPrimaryEmail(user, emailId);
    await t.app().query(`DELETE FROM identity.user_emails WHERE id = $1`, [emailId]);
    expect(await primaryIds(user)).toEqual({ primary_email_id: null, primary_phone_id: null });
  });

  it('nulls the pointer when the phone row is deleted, keeping the user', async () => {
    const user = await insertUser(t.app());
    const phoneId = await addPhone(user, '+2348012345678');
    await setPrimaryPhone(user, phoneId);
    await t.app().query(`DELETE FROM identity.user_phones WHERE id = $1`, [phoneId]);
    expect(await primaryIds(user)).toEqual({ primary_email_id: null, primary_phone_id: null });
  });

  // users cascades into user_emails while users.primary_email_id points back at it: the cycle only
  // resolves because the composite keys are DEFERRABLE INITIALLY DEFERRED.
  it('deletes a user that has a primary email and a primary phone', async () => {
    const user = await insertUser(t.app());
    await setPrimaryEmail(user, await addEmail(user));
    await setPrimaryPhone(user, await addPhone(user, '+2348012345678'));
    await expect(t.app().query(`DELETE FROM identity.users WHERE id = $1`, [user])).resolves.toBeDefined();
    const { rows } = await t.app().query('SELECT id FROM identity.users');
    expect(rows).toEqual([]);
  });

  it('defers the check to commit, so registration can write the pointer before the row', async () => {
    const user = await insertUser(t.app());
    const emailId = '00000000-0000-4000-8000-00000000beef';
    const client = await t.app().connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE identity.users SET primary_email_id = $2 WHERE id = $1`, [user, emailId]);
      await client.query(
        `INSERT INTO identity.user_emails (id, user_id, email, email_normal, is_primary)
         VALUES ($1, $2, 'deferred@example.com', 'deferred@example.com', true)`,
        [emailId, user],
      );
      await expect(client.query('COMMIT')).resolves.toBeDefined();
    } finally {
      client.release();
    }
    expect((await primaryIds(user))?.primary_email_id).toBe(emailId);
  });
});
