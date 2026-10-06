// §S3's uniform failure, against a real database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import { login, resolveLoginCandidate } from '../../../../src/modules/identity/services/login.service.js';
import {
  attachEmail,
  attachPhone,
  markEmailVerified,
  markPhoneVerified,
} from '../../../../src/modules/identity/services/contact.service.js';
import { setPassword } from '../../../../src/modules/identity/services/credential.service.js';
import { sha256 } from '../../../../src/platform/crypto/hmac.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { accountDeps, countingHasher, seedUser } from '../support.js';

const PASSWORD = 'a sturdy passphrase 1';
const EMAIL = 'jane@example.com';
const PHONE = '+2348023415567';

describe.runIf(infraEnabled)('password login', () => {
  const t = useTestDatabase();
  const deps = accountDeps();

  /** A user with a verified email, a verified phone, a handle and a password. */
  const seedSignedUp = async (status = 'ACTIVE') => {
    const { userId } = await seedUser(t.app(), { status });
    await t
      .owner()
      .query(`UPDATE identity.users SET username = 'janedoe', username_skeleton = 'janedoe' WHERE id = $1`, [
        userId,
      ]);
    await t.db().transaction(async (tx) => {
      const email = await attachEmail(tx, { userId, email: EMAIL, makePrimary: true });
      await markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' });
      const phone = await attachPhone(tx, { userId, phone: PHONE, makePrimary: true });
      await markPhoneVerified(tx, { userId, phoneId: phone.phoneId });
      await setPassword(tx, deps, { userId, password: PASSWORD });
    });
    return userId;
  };

  /** A real Chrome-on-Android string, so `deviceLabel` has both halves to find. */
  const USER_AGENT =
    'Mozilla/5.0 (Linux; Android 14; Infinix X6831) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

  const attempt = (identifier: string, password = PASSWORD, d = deps) =>
    login(t.db(), d, { identifier, password, ip: '203.0.113.7', userAgent: USER_AGENT });

  it('signs in by verified email, by verified phone and by username (screen E4, M1 §10.1)', async () => {
    const userId = await seedSignedUp();
    for (const identifier of [EMAIL, PHONE, 'janedoe', '@janedoe', '0802 341 5567', 'JANE@example.com']) {
      const result = await attempt(identifier);
      expect(result.outcome, `identifier ${identifier}`).toBe('SESSION');
      if (result.outcome === 'SESSION') expect(result.user.id).toBe(userId);
    }
  });

  it('ignores an UNVERIFIED contact: an unproven address is not globally unique', async () => {
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      await attachEmail(tx, { userId, email: EMAIL, makePrimary: true });
      await setPassword(tx, deps, { userId, password: PASSWORD });
    });
    expect((await attempt(EMAIL)).outcome).toBe('REJECTED');
  });

  it('classifies a bracketed Nigerian number as a phone, not a handle', async () => {
    await seedSignedUp();
    expect((await attempt('(0802) 341-5567')).outcome).toBe('SESSION');
  });

  it('opens a CONSUMER session with amr ["pwd"]', async () => {
    await seedSignedUp();
    const result = await attempt(EMAIL);
    if (result.outcome !== 'SESSION') throw new Error('expected a session');
    expect(result.session.scope).toBe('CONSUMER');

    const { rows } = await t
      .app()
      .query<{ amr: string[] }>(`SELECT amr FROM identity.sessions WHERE id = $1`, [
        result.session.sessionId,
      ]);
    expect(rows[0]?.amr).toEqual(['pwd']);
  });

  it.each([
    ['nobody@example.com', 'a user that does not exist'],
    [EMAIL, 'a wrong password'],
  ])('answers REJECTED for %s (%s)', async (identifier, _why) => {
    await seedSignedUp();
    expect((await attempt(identifier, 'not the password')).outcome).toBe('REJECTED');
  });

  it('answers REJECTED for a social-only account, with no hint that it exists (S3)', async () => {
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      const email = await attachEmail(tx, { userId, email: EMAIL, makePrimary: true });
      await markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' });
    });
    expect((await attempt(EMAIL)).outcome).toBe('REJECTED');
  });

  it('answers REJECTED while the §S5 throttle is in force, for the right password too', async () => {
    await seedSignedUp();
    await t
      .owner()
      .query(`UPDATE identity.user_credentials SET locked_until = now() + interval '15 minutes'`);
    expect((await attempt(EMAIL)).outcome).toBe('REJECTED');
  });

  it.each(['SUSPENDED', 'LOCKED', 'CLOSED', 'ANONYMISED'])(
    'answers REJECTED for a %s account, with the same shape as a wrong password (S3)',
    async (status) => {
      await seedSignedUp(status);
      expect(await attempt(EMAIL)).toEqual({ outcome: 'REJECTED' });
      expect(await attempt('nobody@example.com')).toEqual({ outcome: 'REJECTED' });
    },
  );

  it.each(['PENDING_VERIFICATION', 'RESTRICTED'])(
    'lets a %s account sign in (M1 §9.1 table)',
    async (status) => {
      await seedSignedUp(status);
      expect((await attempt(EMAIL)).outcome).toBe('SESSION');
    },
  );

  it('performs exactly one password verification per attempt, hit or miss (S3)', async () => {
    await seedSignedUp();
    for (const [identifier, matches] of [
      [EMAIL, true],
      [EMAIL, false],
      ['nobody@example.com', false],
      ['no-such-handle', false],
    ] as const) {
      const hasher = countingHasher({ matches });
      await attempt(identifier, PASSWORD, accountDeps({ hasher }));
      const calls = hasher.calls();
      expect(calls.verify + calls.decoy, `identifier ${identifier}`).toBe(1);
    }
  });

  it('rehashes a weak stored hash on a successful sign-in (S1)', async () => {
    const userId = await seedSignedUp();
    const hasher = countingHasher({ matches: true, needsRehash: true });
    const result = await attempt(EMAIL, PASSWORD, accountDeps({ hasher }));
    expect(result.outcome).toBe('SESSION');
    expect(hasher.calls().hash).toBe(1);

    const { rows } = await t
      .app()
      .query<{ metadata: { rehashed?: boolean } }>(
        `SELECT metadata FROM identity.identity_audit_log WHERE action = 'LOGIN' AND subject_user_id = $1`,
        [userId],
      );
    expect(rows[0]?.metadata.rehashed).toBe(true);
  });

  it('clears failed_attempts on success and counts them on failure', async () => {
    await seedSignedUp();
    await attempt(EMAIL, 'not the password');
    await attempt(EMAIL, 'not the password');
    const before = await t
      .app()
      .query<{ failed_attempts: number }>(`SELECT failed_attempts FROM identity.user_credentials`);
    expect(before.rows[0]?.failed_attempts).toBe(2);

    await attempt(EMAIL);
    const after = await t
      .app()
      .query<{ failed_attempts: number }>(`SELECT failed_attempts FROM identity.user_credentials`);
    expect(after.rows[0]?.failed_attempts).toBe(0);
  });

  it('publishes identity.login.failed with a HASH of the identifier and no identifier (S12)', async () => {
    await attempt(EMAIL, 'not the password');
    const { rows } = await t
      .app()
      .query<{ payload: { identifierHash: string; identifierKind: string; reason: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.login.failed'`,
      );
    expect(rows[0]?.payload).toMatchObject({
      identifierHash: sha256(EMAIL).toString('hex'),
      identifierKind: 'EMAIL',
      reason: 'unknown_identifier',
    });
    expect(JSON.stringify(rows[0]?.payload)).not.toContain(EMAIL);
  });

  it('records WHY it failed in the audit log while telling the caller nothing (S3, S10)', async () => {
    await seedSignedUp('SUSPENDED');
    await attempt(EMAIL);
    const { rows } = await t
      .app()
      .query<{ metadata: { reason: string } }>(
        `SELECT metadata FROM identity.identity_audit_log WHERE action = 'LOGIN_FAILED'`,
      );
    expect(rows[0]?.metadata.reason).toBe('status_not_usable');
  });

  it('publishes identity.device.signed_in only for a fingerprint it has not seen (S11)', async () => {
    const userId = await seedSignedUp();
    const withDevice = (fingerprint: string) =>
      login(t.db(), deps, {
        identifier: EMAIL,
        password: PASSWORD,
        deviceFingerprint: fingerprint,
        ip: '203.0.113.7',
        userAgent: USER_AGENT,
      });

    await withDevice('fingerprint-one');
    await withDevice('fingerprint-one');
    await withDevice('fingerprint-two');

    const { rows } = await t
      .app()
      .query<{ payload: { deviceLabel: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.device.signed_in'`,
      );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.payload.deviceLabel).toBe('Chrome on Android');

    const devices = await t.app().query(`SELECT 1 FROM identity.devices WHERE user_id = $1`, [userId]);
    expect(devices.rows).toHaveLength(2);
  });

  it('records no device and no new-device event for a client with no fingerprint', async () => {
    await seedSignedUp();
    await attempt(EMAIL);
    expect((await t.app().query(`SELECT 1 FROM identity.devices`)).rows).toEqual([]);
    expect(
      (await t.app().query(`SELECT 1 FROM platform.outbox WHERE event_type = 'identity.device.signed_in'`))
        .rows,
    ).toEqual([]);
  });

  it('resolves an identifier in one statement whatever kind it is', async () => {
    const userId = await seedSignedUp();
    for (const [identifier, expected] of [
      [EMAIL, userId],
      [PHONE, userId],
      ['janedoe', userId],
      ['nobody@example.com', null],
      ['not-a-handle-here', null],
      ['+2340000000000', null],
    ] as const) {
      const found = await t.db().transaction((tx) => resolveLoginCandidate(tx, identifier));
      expect(found?.userId ?? null, `identifier ${identifier}`).toBe(expected);
    }
  });
});
