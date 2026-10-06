// §10.1's `{ mfaRequired: true, mfaToken, factors }` branch and `POST /auth/mfa/verify`, against a
// real database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { login } from '../../../../src/modules/identity/services/login.service.js';
import { completeMfaLogin } from '../../../../src/modules/identity/services/mfa-login.service.js';
import {
  activateTotp,
  enrolTotp,
  regenerateRecoveryCodes,
  type MfaDeps,
} from '../../../../src/modules/identity/services/mfa.service.js';
import { issueProofToken, issueOtp } from '../../../../src/modules/identity/services/otp.service.js';
import { attachEmail, markEmailVerified } from '../../../../src/modules/identity/services/contact.service.js';
import { setPassword } from '../../../../src/modules/identity/services/credential.service.js';
import { totpCodeAt, totpStep } from '../../../../src/modules/identity/domain/mfa/totp.js';
import { MFA_TOKEN_TTL_SECONDS } from '../../../../src/modules/identity/domain/mfa/policy.js';
import {
  mfaFactors,
  otpChallenges,
  sessions,
  devices,
} from '../../../../src/modules/identity/infrastructure/postgres/schema/sessions.js';
import { users } from '../../../../src/modules/identity/infrastructure/postgres/schema/users.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  createTestRedis,
  identityInfrastructure,
  mfaDeps,
  outboxEventTypes,
  redisReady,
  seedUser,
  testConfig,
} from '../support.js';

const PASSWORD = 'a sturdy passphrase 1';
const EMAIL = 'jane@example.com';
const FINGERPRINT = 'fp-handset-1';

const codeNow = (secret: string): string => totpCodeAt(secret, totpStep(Date.now()));

/**
 * The code for the step BEFORE the current one — still inside `verifyTotp`'s ±1 window.
 *
 * From review: `activateTotp` seals the step it accepted into the factor, so activating with the
 * CURRENT step's code and then presenting that same step a moment later is refused by the replay
 * guard. Every assertion after an activation would then depend on a 30-second boundary happening to
 * fall between the two calls. Spending the previous step leaves the current one free.
 */
const codeToActivate = (secret: string): string => totpCodeAt(secret, totpStep(Date.now()) - 1);

describe.runIf(infraEnabled)('the mfaRequired login branch (M1 §10.1)', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let deps: MfaDeps;

  const withDeps = async (): Promise<MfaDeps> => {
    redis ??= createTestRedis();
    await redisReady(redis);
    deps ??= mfaDeps(identityInfrastructure(config, redis));
    return deps;
  };

  /** An account with a password, a verified email and (optionally) an ACTIVE TOTP factor. */
  const seedAccount = async ({ withTotp = true } = {}) => {
    const d = await withDeps();
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      const email = await attachEmail(tx, { userId, email: EMAIL, makePrimary: true });
      await markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' });
      await setPassword(tx, d, { userId, password: PASSWORD });
    });
    if (!withTotp) return { userId, secret: null, deps: d };

    const enrolled = await enrolTotp(t.db(), d, { userId, accountName: null });
    if (enrolled.outcome !== 'ENROLLED') throw new Error('expected ENROLLED');
    const activated = await activateTotp(t.db(), d, {
      userId,
      factorId: enrolled.factorId,
      code: codeToActivate(enrolled.secret),
    });
    if (activated.outcome !== 'ACTIVATED') throw new Error('expected ACTIVATED');
    return { userId, secret: enrolled.secret, deps: d };
  };

  const signIn = async (d: MfaDeps) =>
    login(t.db(), d, {
      identifier: EMAIL,
      password: PASSWORD,
      deviceFingerprint: FINGERPRINT,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36',
    });

  it('challenges rather than opening a session, and writes neither a session nor a device row', async () => {
    const { userId, deps: d } = await seedAccount();
    const result = await signIn(d);

    expect(result.outcome).toBe('MFA_REQUIRED');
    if (result.outcome !== 'MFA_REQUIRED') return;
    expect(result.mfaToken.split('.')).toHaveLength(2);

    // The session and the device belong in the transaction that COMPLETES the login, which this is
    // not. A device row written here would also make `isNewDevice` false by the time the session is
    // actually opened, and the §S11 new-device notification would never fire for an MFA user.
    expect(await t.db().select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
    expect(await t.db().select().from(devices).where(eq(devices.userId, userId))).toHaveLength(0);

    const user = (await t.db().select().from(users).where(eq(users.id, userId)))[0];
    expect(user?.lastLoginAt).toBeNull();
  });

  it('writes one MFA_CHALLENGE row with five attempts and a five-minute life', async () => {
    const { userId, deps: d } = await seedAccount();
    const result = await signIn(d);
    if (result.outcome !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');

    // LIVE rows only. An enrolment ceremony is also a MFA_CHALLENGE row scoped to this user, and
    // activating the factor leaves it behind CONSUMED — counting every row of that purpose would
    // count the spent ceremony too, which says nothing about what the sign-in just wrote.
    const rows = (await t.db().select().from(otpChallenges)).filter(
      (row) => row.purpose === 'MFA_CHALLENGE' && row.userId === userId && row.consumedAt === null,
    );
    expect(rows).toHaveLength(1);
    // And it is the row the token names, not merely a row of the right shape.
    expect(rows[0]?.id).toBe(result.mfaToken.split('.')[0]);
    expect(rows[0]?.maxAttempts).toBe(5);
    expect((rows[0]?.expiresAt.getTime() ?? 0) - Date.now()).toBeLessThanOrEqual(
      MFA_TOKEN_TTL_SECONDS * 1000,
    );

    const { rows: audit } = await t
      .app()
      .query<{ action: string; outcome: string }>(
        `SELECT action, outcome FROM identity.identity_audit_log WHERE subject_user_id = $1`,
        [userId],
      );
    expect(audit.map((row) => row.action)).toContain('MFA_CHALLENGED');
  });

  it('describes the factors without a secret, an address or a seed', async () => {
    const { deps: d, secret } = await seedAccount();
    if (secret === null) throw new Error('expected a TOTP secret');
    const result = await signIn(d);
    if (result.outcome !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');

    // TWO: the authenticator, and the backup codes activating it minted. Offering the sheet here is
    // the whole promise of screen TF2 — "each works once if you ever lose access to your
    // authenticator app" — and `verifyFactor` accepts one. They do not make an account two-factor
    // (domain/mfa/policy.ts), but once a real factor has demanded a challenge they are a way
    // through it.
    expect(result.factors.map((factor) => factor.type).sort()).toEqual(['RECOVERY_CODE', 'TOTP']);
    expect(result.factors.find((factor) => factor.type === 'TOTP')).toMatchObject({
      hint: 'Authenticator app',
      isDefault: true,
    });
    expect(result.factors.find((factor) => factor.type === 'RECOVERY_CODE')?.hint).toBe('Backup codes');
    // Nothing presentable leaks: no seed, no sheet, no address.
    expect(JSON.stringify(result.factors)).not.toContain(EMAIL);
    expect(JSON.stringify(result.factors)).not.toContain(secret);
  });

  /** Ten printed codes are not a second factor; an account holding only those just signs in. */
  it('opens a session for an account holding only recovery codes', async () => {
    const { userId, deps: d } = await seedAccount({ withTotp: false });
    await t.db().transaction((tx) => regenerateRecoveryCodes(tx, d, userId));

    expect((await signIn(d)).outcome).toBe('SESSION');
  });

  it('opens a session for an account with no factor at all', async () => {
    const { deps: d } = await seedAccount({ withTotp: false });
    expect((await signIn(d)).outcome).toBe('SESSION');
  });
});

describe.runIf(infraEnabled)('completeMfaLogin (POST /auth/mfa/verify)', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let deps: MfaDeps;

  const withDeps = async (): Promise<MfaDeps> => {
    redis ??= createTestRedis();
    await redisReady(redis);
    deps ??= mfaDeps(identityInfrastructure(config, redis));
    return deps;
  };

  const challenged = async () => {
    const d = await withDeps();
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      const email = await attachEmail(tx, { userId, email: EMAIL, makePrimary: true });
      await markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' });
      await setPassword(tx, d, { userId, password: PASSWORD });
    });
    const enrolled = await enrolTotp(t.db(), d, { userId, accountName: null });
    if (enrolled.outcome !== 'ENROLLED') throw new Error('expected ENROLLED');
    await activateTotp(t.db(), d, {
      userId,
      factorId: enrolled.factorId,
      code: codeToActivate(enrolled.secret),
    });

    const result = await login(t.db(), d, {
      identifier: EMAIL,
      password: PASSWORD,
      deviceFingerprint: FINGERPRINT,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36',
    });
    if (result.outcome !== 'MFA_REQUIRED') throw new Error('expected MFA_REQUIRED');
    return { userId, deps: d, secret: enrolled.secret, ...result };
  };

  const complete = (d: MfaDeps, input: { mfaToken: string; factorId: string; code: string }) =>
    completeMfaLogin(t.db(), d, {
      ...input,
      deviceFingerprint: FINGERPRINT,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36',
    });

  it('opens the session, the device row and the audit trail in one transaction', async () => {
    const { userId, deps: d, mfaToken, factors, secret } = await challenged();
    const result = await complete(d, {
      mfaToken,
      factorId: factors[0]?.id as string,
      code: codeNow(secret),
    });

    expect(result.outcome).toBe('SESSION');
    if (result.outcome !== 'SESSION') return;
    expect(result.session.scope).toBe('CONSUMER');

    const rows = await t.db().select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amr).toEqual(['pwd', 'otp']);
    expect(rows[0]?.deviceId).not.toBeNull();

    expect(await t.db().select().from(devices).where(eq(devices.userId, userId))).toHaveLength(1);
    const user = (await t.db().select().from(users).where(eq(users.id, userId)))[0];
    expect(user?.lastLoginAt).not.toBeNull();

    const types = await outboxEventTypes(t.app());
    expect(types).toContain('identity.session.created');
    expect(types).toContain('identity.device.signed_in');
  });

  it('spends the mfa token, so the same one cannot open a second session', async () => {
    const { deps: d, mfaToken, factors, secret } = await challenged();
    await complete(d, { mfaToken, factorId: factors[0]?.id as string, code: codeNow(secret) });

    // A fresh code, so the refusal is about the token and not about the TOTP replay guard.
    const again = await complete(d, {
      mfaToken,
      factorId: factors[0]?.id as string,
      code: totpCodeAt(secret, totpStep(Date.now()) + 1),
    });
    expect(again).toEqual({ outcome: 'REJECTED' });
  });

  /**
   * The attempt is charged before the comparison, so the transaction must COMMIT on a wrong code —
   * otherwise a caller who cuts the connection buys an unmetered guess at the second factor.
   */
  it('commits a wrong code, charging the attempt, and opens no session', async () => {
    const { userId, deps: d, mfaToken, factors } = await challenged();
    const result = await complete(d, { mfaToken, factorId: factors[0]?.id as string, code: '000000' });

    expect(result).toEqual({ outcome: 'WRONG_CODE', attemptsRemaining: 4 });
    expect(await t.db().select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
  });

  it('is spent after five wrong codes, even for the right one', async () => {
    const { deps: d, mfaToken, factors, secret } = await challenged();
    for (let i = 0; i < 5; i += 1) {
      await complete(d, { mfaToken, factorId: factors[0]?.id as string, code: '000000' });
    }
    expect(
      await complete(d, { mfaToken, factorId: factors[0]?.id as string, code: codeNow(secret) }),
    ).toEqual({ outcome: 'REJECTED' });
  });

  /**
   * No `attemptsRemaining` on a forged token. The counter is only reachable once the token has
   * matched; attaching it to an unrecognised one would make the endpoint a token-validity oracle.
   */
  it('rejects a forged token flatly, with no attempt counter attached', async () => {
    const { deps: d, factors } = await challenged();
    const result = await complete(d, {
      mfaToken: `${crypto.randomUUID()}.forged`,
      factorId: factors[0]?.id as string,
      code: '000000',
    });
    expect(result).toEqual({ outcome: 'REJECTED' });
  });

  it('rejects an expired token', async () => {
    const { deps: d, mfaToken, factors, secret } = await challenged();
    await t.owner().query(
      `UPDATE identity.otp_challenges SET expires_at = now() - interval '1 second'
          WHERE purpose = 'MFA_CHALLENGE'`,
    );
    expect(
      await complete(d, { mfaToken, factorId: factors[0]?.id as string, code: codeNow(secret) }),
    ).toEqual({ outcome: 'REJECTED' });
  });

  it('rejects a factor belonging to another account', async () => {
    const { deps: d, mfaToken, secret } = await challenged();
    const stranger = await seedUser(t.app());
    const [foreign] = await t
      .db()
      .insert(mfaFactors)
      .values({ userId: stranger.userId, factorType: 'TOTP', status: 'ACTIVE', verifiedAt: new Date() })
      .returning({ id: mfaFactors.id });

    expect(await complete(d, { mfaToken, factorId: foreign?.id as string, code: codeNow(secret) })).toEqual({
      outcome: 'REJECTED',
    });
  });

  /** A PASSWORD_RESET proof token is the same shape; the purpose predicate is what separates them. */
  it('rejects a reset token presented as an mfa token, and leaves it spendable', async () => {
    const { deps: d, factors, secret, userId } = await challenged();
    const otpDeps = { hasher: d.otpHasher, logger: d.logger };

    const reset = await t.db().transaction(async (tx) => {
      const issued = await issueOtp(tx, otpDeps, {
        userId,
        purpose: 'PASSWORD_RESET',
        channels: ['EMAIL'],
        destination: EMAIL,
      });
      const row = (await tx.select().from(otpChallenges).where(eq(otpChallenges.id, issued.challengeId)))[0];
      if (!row) throw new Error('no reset challenge');
      return issueProofToken(tx, otpDeps, row);
    });

    expect(
      await complete(d, {
        mfaToken: reset.token,
        factorId: factors[0]?.id as string,
        code: codeNow(secret),
      }),
    ).toEqual({ outcome: 'REJECTED' });

    const row = (await t.db().select().from(otpChallenges).where(eq(otpChallenges.id, reset.challengeId)))[0];
    expect(row?.consumedAt).toBeNull();
    expect(row?.attempts).toBe(0);
  });
});
