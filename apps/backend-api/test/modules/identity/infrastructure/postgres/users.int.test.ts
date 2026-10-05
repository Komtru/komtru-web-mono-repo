// M1 §5.2–5.3: the username rules the database itself must hold, because a service that forgets to
// lowercase is how `JaneDoe` and `janedoe` become two accounts. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { generatePublicId } from '../../../../../src/platform/identifiers.js';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { constraintName, insertUser, sqlState } from './support.js';

describe.runIf(infraEnabled)('identity.users', () => {
  const t = useTestDatabase();

  const withUsername = (username: string, skeleton = username.replace(/[._]/g, '')) =>
    insertUser(t.app(), { username, username_skeleton: skeleton });

  it('rejects an uppercase username', async () => {
    expect(await constraintName(withUsername('JaneDoe'))).toBe('users_username_format');
  });

  it.each([
    ['ab', 'shorter than three characters'],
    ['1jane', 'leading digit'],
    ['.jane', 'leading separator'],
    ['jane-doe', 'a hyphen'],
    ['jane doe', 'a space'],
    ['jané', 'a non-ascii character'],
    ['j'.repeat(31), 'longer than thirty characters'],
  ])('rejects %s (%s)', async (username) => {
    expect(await constraintName(withUsername(username))).toBe('users_username_format');
  });

  it.each([['jan'], ['jane.doe_01'], ['j'.repeat(30)]])('accepts %s', async (username) => {
    await expect(withUsername(username)).resolves.toEqual(expect.any(String));
  });

  it('rejects a username with no skeleton', async () => {
    expect(await constraintName(insertUser(t.app(), { username: 'janedoe' }))).toBe('users_username_pair');
  });

  it('rejects a skeleton with no username', async () => {
    expect(await constraintName(insertUser(t.app(), { username_skeleton: 'janedoe' }))).toBe(
      'users_username_pair',
    );
  });

  it('accepts a user with neither a username nor a skeleton', async () => {
    await expect(insertUser(t.app())).resolves.toEqual(expect.any(String));
  });

  it('rejects a duplicate username', async () => {
    await withUsername('janedoe');
    expect(await sqlState(insertUser(t.app(), { username: 'janedoe', username_skeleton: 'other' }))).toBe(
      '23505',
    );
  });

  // The uppercase variant never reaches the unique index — the format CHECK rejects it first — so
  // what citext buys here is the lookup below, not the uniqueness.
  it('stores the username as citext', async () => {
    await withUsername('janedoe');
    const { rows } = await t
      .app()
      .query<{ type: string }>(`SELECT pg_typeof(username)::text AS type FROM identity.users`);
    expect(rows[0]?.type).toBe('citext');
  });

  it('finds a username case-insensitively', async () => {
    await withUsername('janedoe');
    const { rows } = await t.app().query(`SELECT id FROM identity.users WHERE username = 'JaneDoe'`);
    expect(rows).toHaveLength(1);
  });

  it('rejects a duplicate skeleton', async () => {
    await withUsername('dellstore', 'delstoreng');
    expect(
      await sqlState(insertUser(t.app(), { username: 'dellstoreng', username_skeleton: 'delstoreng' })),
    ).toBe('23505');
  });

  it('rejects a duplicate public_id', async () => {
    const publicId = generatePublicId();
    await insertUser(t.app(), { public_id: publicId });
    expect(await sqlState(insertUser(t.app(), { public_id: publicId }))).toBe('23505');
  });

  it('defaults a new user to pending, unverified, discoverable and epoch 1', async () => {
    const id = await insertUser(t.app());
    const { rows } = await t.app().query(
      `SELECT status, verification_level, sessions_epoch, skeleton_version, username_change_count,
              discoverable_by_username, discoverable_by_email, discoverable_by_phone,
              mfa_required, marketing_opt_in, locale, timezone
         FROM identity.users WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      status: 'PENDING_VERIFICATION',
      verification_level: 'UNVERIFIED',
      sessions_epoch: 1,
      skeleton_version: 1,
      username_change_count: 0,
      discoverable_by_username: true,
      discoverable_by_email: true,
      discoverable_by_phone: true,
      mfa_required: false,
      marketing_opt_in: false,
      locale: 'en-NG',
      timezone: 'Africa/Lagos',
    });
  });

  it('caps a profile bio at 500 characters', async () => {
    const id = await insertUser(t.app());
    const insert = (bio: string) =>
      t.app().query(`INSERT INTO identity.user_profiles (user_id, bio) VALUES ($1, $2)`, [id, bio]);
    expect(await constraintName(insert('a'.repeat(501)))).toBe('profile_bio_len');
    await expect(insert('a'.repeat(500))).resolves.toBeDefined();
  });

  it('holds one profile per user and deletes it with the user', async () => {
    const id = await insertUser(t.app());
    await t.app().query(`INSERT INTO identity.user_profiles (user_id) VALUES ($1)`, [id]);
    expect(
      await sqlState(t.app().query(`INSERT INTO identity.user_profiles (user_id) VALUES ($1)`, [id])),
    ).toBe('23505');
    await t.app().query(`DELETE FROM identity.users WHERE id = $1`, [id]);
    const { rows } = await t.app().query('SELECT user_id FROM identity.user_profiles');
    expect(rows).toEqual([]);
  });
});
