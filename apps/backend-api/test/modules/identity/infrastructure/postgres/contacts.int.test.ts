// M1 §5.4: one verified owner per address or number, one primary per user — both enforced by partial
// unique indexes, because a service that checks then inserts loses the race. Skipped unless
// KOMTRU_INFRA_TESTS=1.

import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { constraintName, insertUser, sqlState } from './support.js';

const EMAIL = 'jane@gmail.com';
const PHONE = '+2348012345678';

describe.runIf(infraEnabled)('identity contact channels', () => {
  const t = useTestDatabase();

  const addEmail = (
    userId: string,
    { email = EMAIL, normal = EMAIL, verified = false, primary = false } = {},
  ) =>
    t.app().query<{ id: string }>(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END) RETURNING id`,
      [userId, email, normal, primary, verified],
    );

  const addPhone = (userId: string, { phone = PHONE, verified = false, primary = false } = {}) =>
    t.app().query<{ id: string }>(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
       VALUES ($1, $2, 'NG', $3, CASE WHEN $4 THEN now() END) RETURNING id`,
      [userId, phone, primary, verified],
    );

  /**
   * Both transactions insert before either commits, so the second is blocked by the index rather
   * than by having read the first's row — the race a check-then-insert service would lose.
   */
  const raceInserts = async (statement: string, values: unknown[][]): Promise<string> => {
    const [first, second] = await Promise.all([t.app().connect(), t.app().connect()]);
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query(statement, values[0]);
      // sqlState() wraps the query synchronously: the rejection arrives while COMMIT is still in
      // flight, and a handler attached after that point is an unhandled rejection.
      const blocked = sqlState(second.query(statement, values[1]));
      await first.query('COMMIT');
      const state = await blocked;
      await second.query('ROLLBACK');
      return state;
    } finally {
      first.release();
      second.release();
    }
  };

  it('allows one primary email per user', async () => {
    const user = await insertUser(t.app());
    await addEmail(user, { primary: true });
    expect(await sqlState(addEmail(user, { email: 'other@gmail.com', primary: true }))).toBe('23505');
  });

  it('allows many non-primary emails', async () => {
    const user = await insertUser(t.app());
    await addEmail(user, { email: 'a@example.com', normal: 'a@example.com' });
    await expect(addEmail(user, { email: 'b@example.com', normal: 'b@example.com' })).resolves.toBeDefined();
  });

  it('allows two unverified claims on the same normalised address', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    await addEmail(a, { email: 'j.ane@gmail.com' });
    await expect(addEmail(b, { email: 'jane+shop@gmail.com' })).resolves.toBeDefined();
  });

  it('allows only one verified owner of a normalised address', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    await addEmail(a, { email: 'j.ane@gmail.com', verified: true });
    expect(await sqlState(addEmail(b, { email: 'jane+shop@gmail.com', verified: true }))).toBe('23505');
  });

  it('rejects a second verified owner of an address inserted concurrently', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    const state = await raceInserts(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, verified_at)
       VALUES ($1, $2, $3, now())`,
      [
        [a, 'j.ane@gmail.com', EMAIL],
        [b, 'jane+shop@gmail.com', EMAIL],
      ],
    );
    expect(state).toBe('23505');
  });

  // The production path is not a verified INSERT but an UPDATE when the OTP is confirmed, so race
  // that statement too: the index, not the order of the reads, has to be what stops the second one.
  it('rejects a second verified owner of an address claimed concurrently by update', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    const first = await addEmail(a, { email: 'j.ane@gmail.com' });
    const second = await addEmail(b, { email: 'jane+shop@gmail.com' });
    const state = await raceInserts(`UPDATE identity.user_emails SET verified_at = now() WHERE id = $1`, [
      [first.rows[0]!.id],
      [second.rows[0]!.id],
    ]);
    expect(state).toBe('23505');
  });

  it('allows one primary phone per user', async () => {
    const user = await insertUser(t.app());
    await addPhone(user, { primary: true });
    expect(await sqlState(addPhone(user, { phone: '+2348012345679', primary: true }))).toBe('23505');
  });

  it('allows only one verified owner of an E.164 number', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    await addPhone(a, { verified: true });
    expect(await sqlState(addPhone(b, { verified: true }))).toBe('23505');
  });

  it('rejects a second verified owner of a number inserted concurrently', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    const state = await raceInserts(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, verified_at)
       VALUES ($1, $2, 'NG', now())`,
      [
        [a, PHONE],
        [b, PHONE],
      ],
    );
    expect(state).toBe('23505');
  });

  it.each([['08012345678'], ['+0801234567'], ['+234'], ['+2348012345678901234'], ['+234 801 2345']])(
    'rejects %s as a phone number',
    async (phone) => {
      const user = await insertUser(t.app());
      expect(await constraintName(addPhone(user, { phone }))).toBe('phone_e164_format');
    },
  );

  it('accepts a valid E.164 number', async () => {
    const user = await insertUser(t.app());
    await expect(addPhone(user)).resolves.toBeDefined();
  });

  it("deletes a user's emails and phones with the user", async () => {
    const user = await insertUser(t.app());
    await addEmail(user);
    await addPhone(user);
    await t.app().query(`DELETE FROM identity.users WHERE id = $1`, [user]);
    const counts = async (table: string) =>
      (await t.app().query<{ n: string }>(`SELECT count(*) AS n FROM identity.${table}`)).rows[0]?.n;
    expect([await counts('user_emails'), await counts('user_phones')]).toEqual(['0', '0']);
  });

  it('keeps (id, user_id) unique so the primary pointers can reference it', async () => {
    const { rows } = await t
      .owner()
      .query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'identity' AND indexname = ANY($1)`,
        [['user_emails_id_user', 'user_phones_id_user']],
      );
    expect(rows.map((row) => row.indexname).sort()).toEqual(['user_emails_id_user', 'user_phones_id_user']);
  });
});
