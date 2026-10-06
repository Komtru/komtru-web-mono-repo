// §S1, §S2, §S3 and §S5 against a real database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMS_VERSION } from '../../../../src/modules/identity/domain/terms.js';
import { register, type AccountDeps } from '../../../../src/modules/identity/services/auth.service.js';
import {
  changePassword,
  completePasswordReset,
} from '../../../../src/modules/identity/services/password.service.js';
import { sha1Hex } from '../../../../src/modules/identity/domain/credential/breach.js';
import { argon2Hasher, hashPassword } from '../../../../src/modules/identity/domain/credential/hashing.js';
import { LOCKOUT_THRESHOLD } from '../../../../src/modules/identity/domain/credential/lockout.js';
import {
  PASSWORD_HISTORY,
  hasCredential,
  setPassword,
  validatePassword,
  verifyAndRecord,
  type CredentialDeps,
} from '../../../../src/modules/identity/services/credential.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { accountDeps, countingHasher, seedUser, testLogger } from '../support.js';

const GOOD = 'a sturdy passphrase 1';

const deps = (overrides: Partial<CredentialDeps> = {}): CredentialDeps => ({
  hasher: argon2Hasher,
  breach: { enabled: false, logger: testLogger },
  logger: testLogger,
  ...overrides,
});

/** A corpus that reports GOOD as breached, with no network involved. */
const breachedDeps = (): CredentialDeps =>
  deps({
    breach: {
      enabled: true,
      logger: testLogger,
      fetch: () => Promise.resolve(new Response(`${sha1Hex(GOOD).slice(5)}:12345`)),
    },
  });

describe.runIf(infraEnabled)('credentials', () => {
  const t = useTestDatabase();

  const credential = async (userId: string) =>
    (
      await t.app().query<{
        password_hash: string;
        previous_hashes: string[];
        failed_attempts: number;
        locked_until: Date | null;
      }>(`SELECT * FROM identity.user_credentials WHERE user_id = $1`, [userId])
    ).rows[0];

  const set = (userId: string, password: string, d = deps()) =>
    t.db().transaction((tx) => setPassword(tx, d, { userId, password }));

  const verify = (userId: string | null, password: string, d = deps()) =>
    t.db().transaction((tx) => verifyAndRecord(tx, d, { userId, password }));

  it('refuses a password below ten characters without writing a row', async () => {
    const { userId } = await seedUser(t.app());
    expect(await set(userId, 'too short')).toMatchObject({ ok: false, rejection: 'TOO_SHORT' });
    expect(await credential(userId)).toBeUndefined();
  });

  it('refuses a breached password when the flag is on', async () => {
    // `validatePassword`, not `setPassword`: the corpus check is deliberately on the side of the
    // split that runs OUTSIDE the transaction, because it is a three-second HTTP call and holding a
    // Postgres connection and its row locks across a third party's availability is the wrong trade.
    // The describe below is the guard that every path which writes a password still goes through it.
    expect(await validatePassword(breachedDeps(), GOOD)).toMatchObject({
      ok: false,
      rejection: 'BREACHED',
    });
  });

  it('accepts a password the corpus could not be consulted about, falling back to the offline list', async () => {
    const down = deps({
      breach: { enabled: true, logger: testLogger, fetch: () => Promise.reject(new Error('ECONNRESET')) },
    });
    expect(await validatePassword(down, GOOD)).toMatchObject({ ok: true });
    // The offline list is still in force, which is what failing open costs and buys.
    expect(await validatePassword(down, 'password123')).toMatchObject({ ok: false, rejection: 'COMMON' });
  });

  it('setPassword alone does not consult the corpus, and that is the documented split', async () => {
    const { userId } = await seedUser(t.app());
    let called = false;
    const watched = deps({
      breach: {
        enabled: true,
        logger: testLogger,
        fetch: () => {
          called = true;
          return Promise.resolve(new Response(''));
        },
      },
    });
    expect(await set(userId, GOOD, watched)).toMatchObject({ ok: true });
    expect(called).toBe(false);
  });

  it('keeps the last five hashes and refuses a reuse', async () => {
    const { userId } = await seedUser(t.app());
    // SIX, not five: the window holds the password in force plus the four before it, so after five
    // distinct passwords the first is still inside it. Six is the smallest number that pushes one
    // out, and pushing one out is the half of the rule worth testing.
    const passwords = Array.from(
      { length: PASSWORD_HISTORY + 1 },
      (_, i) => `a sturdy passphrase ${String(i)}`,
    );
    for (const password of passwords) expect(await set(userId, password)).toMatchObject({ ok: true });

    // The one in force, and the four before it.
    for (const password of passwords.slice(2)) {
      expect(await set(userId, password)).toMatchObject({ ok: false, rejection: 'REUSED' });
    }
    // The oldest has fallen out of the window.
    expect(await set(userId, passwords[0]!)).toMatchObject({ ok: true });
  });

  it('verifies a correct password and leaves failed_attempts at zero', async () => {
    const { userId } = await seedUser(t.app());
    await set(userId, GOOD);
    expect(await verify(userId, GOOD)).toEqual({ outcome: 'OK', rehashed: false });
    expect((await credential(userId))?.failed_attempts).toBe(0);
  });

  it('counts a wrong password and locks for fifteen minutes at the tenth (S5)', async () => {
    const { userId } = await seedUser(t.app());
    await set(userId, GOOD);
    for (let i = 1; i < LOCKOUT_THRESHOLD; i += 1) {
      expect(await verify(userId, 'wrong wrong wrong')).toMatchObject({
        outcome: 'WRONG',
        lockedUntil: null,
      });
    }
    const tenth = await verify(userId, 'wrong wrong wrong');
    expect(tenth).toMatchObject({ outcome: 'WRONG', failedAttempts: LOCKOUT_THRESHOLD });
    expect((await credential(userId))?.locked_until).not.toBeNull();
  });

  it('answers LOCKED while locked_until is in the future, even for the right password', async () => {
    const { userId } = await seedUser(t.app());
    await set(userId, GOOD);
    await t
      .owner()
      .query(
        `UPDATE identity.user_credentials SET locked_until = now() + interval '15 minutes' WHERE user_id = $1`,
        [userId],
      );
    expect(await verify(userId, GOOD)).toMatchObject({ outcome: 'LOCKED' });
  });

  it('clears a lapsed lock on the next correct password', async () => {
    const { userId } = await seedUser(t.app());
    await set(userId, GOOD);
    await t
      .owner()
      .query(
        `UPDATE identity.user_credentials SET locked_until = now() - interval '1 second', failed_attempts = 12 WHERE user_id = $1`,
        [userId],
      );
    expect(await verify(userId, GOOD)).toMatchObject({ outcome: 'OK' });
    expect(await credential(userId)).toMatchObject({ failed_attempts: 0, locked_until: null });
  });

  it('never sets users.status to LOCKED — that is the risk lock, not the throttle (M1 §9.1)', async () => {
    const { userId } = await seedUser(t.app());
    await set(userId, GOOD);
    for (let i = 0; i <= LOCKOUT_THRESHOLD; i += 1) await verify(userId, 'wrong wrong wrong');
    const { rows } = await t
      .app()
      .query<{ status: string }>(`SELECT status FROM identity.users WHERE id = $1`, [userId]);
    expect(rows[0]?.status).toBe('ACTIVE');
  });

  it('answers NO_CREDENTIAL for a social-only user after the same hashing work (S3)', async () => {
    const { userId } = await seedUser(t.app());
    const counting = countingHasher();
    expect(await verify(userId, GOOD, deps({ hasher: counting }))).toEqual({ outcome: 'NO_CREDENTIAL' });
    expect(counting.calls()).toEqual({ hash: 0, verify: 0, decoy: 1 });
  });

  it('performs exactly one verification for a userId of null (S3)', async () => {
    const counting = countingHasher();
    expect(await verify(null, GOOD, deps({ hasher: counting }))).toEqual({ outcome: 'NO_CREDENTIAL' });
    expect(counting.calls()).toEqual({ hash: 0, verify: 0, decoy: 1 });
  });

  it('performs exactly one verification for a wrong password, a right one and a locked account (S3)', async () => {
    const { userId } = await seedUser(t.app());
    await set(userId, GOOD);

    for (const [password, expected] of [
      [GOOD, 'OK'],
      ['wrong wrong wrong', 'WRONG'],
    ] as const) {
      const counting = countingHasher({ matches: password === GOOD });
      expect((await verify(userId, password, deps({ hasher: counting }))).outcome).toBe(expected);
      expect(counting.calls().verify + counting.calls().decoy).toBe(1);
    }

    await t
      .owner()
      .query(
        `UPDATE identity.user_credentials SET locked_until = now() + interval '15 minutes' WHERE user_id = $1`,
        [userId],
      );
    const counting = countingHasher({ matches: true });
    expect((await verify(userId, GOOD, deps({ hasher: counting }))).outcome).toBe('LOCKED');
    expect(counting.calls().verify + counting.calls().decoy).toBe(1);
  });

  it('rehashes transparently when the stored parameters are below the baseline (S1)', async () => {
    const { userId } = await seedUser(t.app());
    await set(userId, GOOD);
    // A hash from a weaker era. Written directly, because the service will never produce one.
    const weak = (await hashPassword(GOOD)).replace('m=19456,t=2,p=1', 'm=4096,t=2,p=1');
    await t
      .owner()
      .query(`UPDATE identity.user_credentials SET password_hash = $2 WHERE user_id = $1`, [userId, weak]);

    // A hash whose parameters were edited no longer verifies, so this proves the DECISION, not the
    // upgrade: needsRehash is what drives it, and the real path is covered by the login suite.
    expect(argon2Hasher.needsRehash(weak)).toBe(true);

    const counting = countingHasher({ matches: true, needsRehash: true });
    expect(await verify(userId, GOOD, deps({ hasher: counting }))).toEqual({ outcome: 'OK', rehashed: true });
    expect(counting.calls().hash).toBe(1);
    expect((await credential(userId))?.password_hash).not.toBe(weak);
  });

  it('does not rehash a hash already at the baseline', async () => {
    const { userId } = await seedUser(t.app());
    await set(userId, GOOD);
    const before = (await credential(userId))?.password_hash;
    expect(await verify(userId, GOOD)).toEqual({ outcome: 'OK', rehashed: false });
    expect((await credential(userId))?.password_hash).toBe(before);
  });

  it('reports whether a user has a password at all', async () => {
    const { userId } = await seedUser(t.app());
    expect(await t.db().transaction((tx) => hasCredential(tx, userId))).toBe(false);
    await set(userId, GOOD);
    expect(await t.db().transaction((tx) => hasCredential(tx, userId))).toBe(true);
  });
});

/**
 * The guard on the split.
 *
 * `setPassword` writes; `validatePassword` runs §S2's policy and the breach corpus, outside the
 * transaction. That is a deliberate separation and it is exactly the kind that regresses silently —
 * a later ticket calls `setPassword` directly and the corpus check quietly stops happening for that
 * path. So this asserts the property at the level that matters: EVERY service that can write a
 * password refuses a breached one.
 */
describe.runIf(infraEnabled)('every path that writes a password consults the breach corpus', () => {
  const t = useTestDatabase();

  const breached = (): AccountDeps =>
    accountDeps({
      breach: {
        enabled: true,
        logger: testLogger,
        fetch: () => Promise.resolve(new Response(`${sha1Hex(GOOD).slice(5)}:12345`)),
      },
    });

  it('register refuses it', async () => {
    const result = await register(t.db(), breached(), {
      channel: 'EMAIL',
      email: 'jane@example.com',
      password: GOOD,
      acceptedTermsVersion: DEFAULT_TERMS_VERSION,
      marketingOptIn: false,
      ip: null,
      userAgent: null,
    });
    expect(result).toMatchObject({ outcome: 'REJECTED', rejection: 'BREACHED' });
    // And nothing was written: a refused password must not leave an account nobody can sign into.
    expect((await t.app().query(`SELECT 1 FROM identity.users`)).rows).toEqual([]);
  });

  it('changePassword refuses it', async () => {
    const { userId } = await seedUser(t.app());
    const result = await changePassword(t.db(), breached(), {
      userId,
      sessionId: randomUUID(),
      newPassword: GOOD,
      ip: null,
      userAgent: null,
    });
    expect(result).toMatchObject({ outcome: 'REJECTED', rejection: 'BREACHED' });
  });

  it('completePasswordReset refuses it', async () => {
    const result = await completePasswordReset(t.db(), breached(), {
      resetToken: `${randomUUID()}.whatever`,
      newPassword: GOOD,
      ip: null,
      userAgent: null,
    });
    // REJECTED before the token is even looked at, which is the point: the corpus runs first.
    expect(result).toMatchObject({ outcome: 'REJECTED', rejection: 'BREACHED' });
  });
});
