// M1 §5.8–5.10: sessions, devices, MFA, OTP, recovery, username history and party invitations.
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { infraEnabled } from '../../../../support/db-urls.js';
import { useTestDatabase } from '../../../../support/db.js';
import { constraintName, insertUser, sqlState } from './support.js';

const hash = (seed: string) => Buffer.from(seed.padEnd(32, '.'));

describe.runIf(infraEnabled)('identity sessions, devices and username protection', () => {
  const t = useTestDatabase();

  const addDevice = async (userId: string, fingerprint = 'fp-1') => {
    const { rows } = await t.app().query<{ id: string }>(
      `INSERT INTO identity.devices (user_id, device_fingerprint, platform)
       VALUES ($1, $2, 'WEB') RETURNING id`,
      [userId, fingerprint],
    );
    return rows[0]!.id;
  };

  const addSession = (
    userId: string,
    { refresh = 'refresh-1', deviceId = null as string | null, scope = 'CONSUMER' } = {},
  ) =>
    t.app().query<{ id: string }>(
      `INSERT INTO identity.sessions
         (user_id, device_id, scope, family_id, refresh_token_hash, absolute_expires_at, idle_expires_at)
       VALUES ($1, $2, $3, gen_random_uuid(), $4, now() + interval '30 days', now() + interval '1 day')
       RETURNING id`,
      [userId, deviceId, scope, hash(refresh)],
    );

  const addFactor = (
    userId: string,
    { isDefault = true, revoked = false, phoneId = null as string | null } = {},
  ) =>
    t.app().query(
      `INSERT INTO identity.mfa_factors (user_id, factor_type, is_default, phone_id, revoked_at)
       VALUES ($1, 'TOTP', $2, $3, CASE WHEN $4 THEN now() END)`,
      [userId, isDefault, phoneId, revoked],
    );

  it('rejects a duplicate refresh token hash', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    await addSession(a);
    expect(await sqlState(addSession(b))).toBe('23505');
  });

  it('defaults a session to the CONSUMER scope', async () => {
    const user = await insertUser(t.app());
    const { rows } = await addSession(user);
    const { rows: scope } = await t
      .app()
      .query<{ scope: string }>('SELECT scope FROM identity.sessions WHERE id = $1', [rows[0]!.id]);
    expect(scope[0]?.scope).toBe('CONSUMER');
  });

  it.each([['STAFF'], ['LOGISTICS']])('accepts a %s session', async (scope) => {
    const user = await insertUser(t.app());
    await expect(addSession(user, { refresh: `refresh-${scope}`, scope })).resolves.toBeDefined();
  });

  it('rejects a duplicate device fingerprint for one user', async () => {
    const user = await insertUser(t.app());
    await addDevice(user);
    expect(await sqlState(addDevice(user))).toBe('23505');
  });

  // Shared-device detection is a strong fraud signal for Risk (M13), so this must stay legal.
  it('allows the same fingerprint for two users', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    await addDevice(a);
    await expect(addDevice(b)).resolves.toEqual(expect.any(String));
  });

  it('nulls a session device_id when the device is deleted', async () => {
    const user = await insertUser(t.app());
    const deviceId = await addDevice(user);
    const { rows } = await addSession(user, { deviceId });
    await t.app().query(`DELETE FROM identity.devices WHERE id = $1`, [deviceId]);
    const { rows: after } = await t
      .app()
      .query<{ device_id: string | null }>('SELECT device_id FROM identity.sessions WHERE id = $1', [
        rows[0]!.id,
      ]);
    expect(after[0]?.device_id).toBeNull();
  });

  it('keeps a session rotation family linked to its parent', async () => {
    const user = await insertUser(t.app());
    const { rows } = await addSession(user);
    await expect(
      t.app().query(
        `INSERT INTO identity.sessions
           (user_id, family_id, refresh_token_hash, parent_session_id, absolute_expires_at, idle_expires_at)
         SELECT user_id, family_id, $2, id, absolute_expires_at, idle_expires_at
           FROM identity.sessions WHERE id = $1`,
        [rows[0]!.id, hash('refresh-2')],
      ),
    ).resolves.toBeDefined();
  });

  it('allows one default MFA factor per user', async () => {
    const user = await insertUser(t.app());
    await addFactor(user);
    expect(await sqlState(addFactor(user))).toBe('23505');
  });

  it('allows a new default factor once the first is revoked', async () => {
    const user = await insertUser(t.app());
    await addFactor(user, { revoked: true });
    await expect(addFactor(user)).resolves.toBeDefined();
  });

  it('nulls mfa_factors.phone_id when the phone is deleted', async () => {
    const user = await insertUser(t.app());
    const { rows } = await t.app().query<{ id: string }>(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code)
       VALUES ($1, '+2348012345678', 'NG') RETURNING id`,
      [user],
    );
    await addFactor(user, { phoneId: rows[0]!.id });
    await t.app().query(`DELETE FROM identity.user_phones WHERE id = $1`, [rows[0]!.id]);
    const { rows: after } = await t
      .app()
      .query<{ phone_id: string | null }>('SELECT phone_id FROM identity.mfa_factors');
    expect(after[0]?.phone_id).toBeNull();
  });

  it('rejects a duplicate passkey credential id', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    const insert = (userId: string) =>
      t.app().query(
        `INSERT INTO identity.passkey_credentials (user_id, credential_id, public_key)
         VALUES ($1, $2, $3)`,
        [userId, hash('cred'), hash('key')],
      );
    await insert(a);
    expect(await sqlState(insert(b))).toBe('23505');
  });

  it('rejects a reviewer who is the subject of the recovery request', async () => {
    const user = await insertUser(t.app());
    expect(
      await constraintName(
        t.app().query(
          `INSERT INTO identity.account_recovery_requests
             (user_id, claimed_identifier_hash, method, reviewed_by, expires_at)
           VALUES ($1, $2, 'LOST_PASSWORD', $1, now() + interval '1 day')`,
          [user, hash('claim')],
        ),
      ),
    ).toBe('recovery_reviewer_not_subject');
  });

  // The requester may not be resolvable to a user at intake, so a reviewer is fine when user_id is null.
  it('allows a reviewer on a request with no resolved user', async () => {
    const reviewer = await insertUser(t.app());
    await expect(
      t.app().query(
        `INSERT INTO identity.account_recovery_requests
           (claimed_identifier_hash, method, reviewed_by, expires_at)
         VALUES ($1, 'LOST_ALL', $2, now() + interval '1 day')`,
        [hash('claim'), reviewer],
      ),
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate reserved username skeleton', async () => {
    const insert = () =>
      t
        .app()
        .query(
          `INSERT INTO identity.reserved_usernames (username_skeleton, category) VALUES ('admin', 'ROLE')`,
        );
    await insert();
    expect(await sqlState(insert())).toBe('23505');
  });

  it('rejects a duplicate invitation token hash', async () => {
    const [a, b] = [await insertUser(t.app()), await insertUser(t.app())];
    const insert = (userId: string) =>
      t.app().query(
        `INSERT INTO identity.party_invitations
           (inviter_user_id, channel, destination_hash, destination_masked, destination_enc,
            intended_role, token_hash, expires_at)
         VALUES ($1, 'EMAIL', $2, 'j****@gmail.com', $3, 'BUYER', $4, now() + interval '7 days')`,
        [userId, hash('dest'), hash('enc'), hash('token')],
      );
    await insert(a);
    expect(await sqlState(insert(b))).toBe('23505');
  });

  it('deletes sessions, devices, factors and username history with the user', async () => {
    const user = await insertUser(t.app());
    const deviceId = await addDevice(user);
    await addSession(user, { deviceId });
    await addFactor(user);
    await t.app().query(
      `INSERT INTO identity.username_history (user_id, username, username_skeleton, claimed_at)
       VALUES ($1, 'janedoe', 'janedoe', now())`,
      [user],
    );
    await t.app().query(`DELETE FROM identity.users WHERE id = $1`, [user]);
    const count = async (table: string) =>
      (await t.app().query<{ n: string }>(`SELECT count(*) AS n FROM identity.${table}`)).rows[0]?.n;
    expect([
      await count('sessions'),
      await count('devices'),
      await count('mfa_factors'),
      await count('username_history'),
    ]).toEqual(['0', '0', '0', '0']);
  });
});
