// M1 §17's enumeration suite again, for the branch T-036 adds — and the reason this file exists at
// all.
//
// T-032 built `LoginResult` with exactly ONE failure variant and said so in its ticket note: a union
// carrying NO_SUCH_USER or SUSPENDED is one somebody eventually maps onto three status codes. The
// `mfaRequired` branch is the first thing since then that could reopen that, because the question an
// attacker now wants answered is no longer only "does this account exist" but "is it worth
// attacking" — and an account that answers `{ mfaRequired: true }` has told them it is hardened.
//
// It cannot, and the reason is structural rather than careful: the branch is on the FAR SIDE of the
// password check. Nothing above the single `return { outcome: 'REJECTED' }` learns whether the
// account has a factor, so a caller who does not already hold the password sees the identical
// rejection whichever kind of account they aimed at. Two tests hold that line:
//
//   - the timing one, which is what §17 literally asks for; and
//   - the statement-counting one, which the timing test cannot replace. An implementation that read
//     the factors early and threw the answer away would pass a timing test on a fast machine and
//     fail this one, and it is the drift that would reintroduce the oracle.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../src/app.js';
import { createIdentityAuth } from '../../../../src/modules/identity/index.js';
import { attachEmail, markEmailVerified } from '../../../../src/modules/identity/services/contact.service.js';
import { setPassword } from '../../../../src/modules/identity/services/credential.service.js';
import { login } from '../../../../src/modules/identity/services/login.service.js';
import { activateTotp, enrolTotp } from '../../../../src/modules/identity/services/mfa.service.js';
import { totpCodeAt, totpStep } from '../../../../src/modules/identity/domain/mfa/totp.js';
import { createIdempotencyGate } from '../../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  countStatements,
  countingHasher,
  createTestRedis,
  mfaDeps,
  redisReady,
  seedUser,
  testConfig,
  testLogger,
} from '../support.js';

const PASSWORD = 'a sturdy passphrase 1';
const WRONG = 'not the password at all';
const MFA_USER = 'hardened@example.com';
const PLAIN_USER = 'plain@example.com';
const UNKNOWN = 'nobody@example.com';
const SAMPLES = 1000;

/** supertest types `response.body` as `any`; every read in this file goes through `bodyOf`. */
const bodyOf = <T>(response: { body: unknown }): T => response.body as T;

interface Session {
  accessToken: string;
  refreshToken: string;
  scope: string;
  mfaRequired?: undefined;
}
interface Challenge {
  mfaRequired: true;
  mfaToken: string;
  expiresAt: number;
  factors: { id: string; type: string; hint: string | null; isDefault: boolean }[];
  accessToken?: undefined;
  refreshToken?: undefined;
}
type LoginBody = Partial<Session> & Partial<Challenge>;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
};

describe.runIf(infraEnabled)('the mfaRequired branch is not an enumeration signal (M1 §17)', () => {
  const t = useTestDatabase();
  const config = testConfig();
  let redis: Redis;
  let app: Express;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    const auth = createIdentityAuth({ db: t.db(), redis, config, logger: testLogger });
    app = createApp({
      config,
      logger: testLogger,
      mountV1: mountRoutes(auth.routes ?? [], {
        logger: testLogger,
        idempotency: createIdempotencyGate({ db: t.db(), redis, logger: testLogger }),
        rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `rl-${randomUUID()}` }),
        resolveActor: auth.resolveActor,
      }),
    });
  });

  afterAll(() => {
    redis?.disconnect();
  });

  const seedAccount = async (email: string, deps = mfaDeps()): Promise<string> => {
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      const row = await attachEmail(tx, { userId, email, makePrimary: true });
      await markEmailVerified(tx, { userId, emailId: row.emailId, source: 'otp' });
      await setPassword(tx, deps, { userId, password: PASSWORD });
    });
    return userId;
  };

  const seedHardened = async (deps = mfaDeps()): Promise<string> => {
    const userId = await seedAccount(MFA_USER, deps);
    const enrolled = await enrolTotp(t.db(), deps, { userId, accountName: null });
    if (enrolled.outcome !== 'ENROLLED') throw new Error('expected ENROLLED');
    const activated = await activateTotp(t.db(), deps, {
      userId,
      factorId: enrolled.factorId,
      // The PREVIOUS step, so the activation does not burn the code the sign-in below presents.
      code: totpCodeAt(enrolled.secret, totpStep(Date.now()) - 1),
    });
    if (activated.outcome !== 'ACTIVATED') throw new Error('expected ACTIVATED');
    return userId;
  };

  it(
    `costs the same to fail against an MFA account, a plain account and nobody: < 5ms over ${String(SAMPLES)} samples`,
    { timeout: 180_000 },
    async () => {
      const cheap = mfaDeps({ hasher: countingHasher({ matches: false }) });
      // Seeded with the real hasher so the stored PHC string is a real one; the measurement then
      // runs with the constant-cost hasher, for the reason the §17 suite beside this one gives.
      await seedHardened();
      await seedAccount(PLAIN_USER);

      const attempt = (identifier: string) =>
        login(t.db(), cheap, { identifier, password: WRONG, ip: null, userAgent: null });

      for (let i = 0; i < 20; i += 1) {
        await attempt(MFA_USER);
        await attempt(PLAIN_USER);
        await attempt(UNKNOWN);
      }

      const hardened: number[] = [];
      const plain: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        // Interleaved, so a drifting machine load affects all three series equally.
        let start = performance.now();
        await attempt(MFA_USER);
        hardened.push(performance.now() - start);

        start = performance.now();
        await attempt(PLAIN_USER);
        plain.push(performance.now() - start);

        start = performance.now();
        await attempt(UNKNOWN);
        unknown.push(performance.now() - start);
      }

      expect(Math.abs(median(hardened) - median(plain))).toBeLessThan(5);
      expect(Math.abs(median(hardened) - median(unknown))).toBeLessThan(5);
    },
  );

  /**
   * The one the timing test cannot replace.
   *
   * A machine fast enough hides an extra indexed lookup inside 5ms, so a drifted implementation that
   * read the factors before the rejection would still pass the measurement above. Counting the
   * statements the rejected path issues does not depend on how fast the machine is.
   *
   * What it pins is T-036's property: among accounts that EXIST, a rejection costs the same whether
   * or not the account is MFA-protected. That is the question the `mfaRequired` branch could have
   * made answerable, and the equality below is what stops it becoming so.
   *
   * It deliberately does NOT assert that a miss costs the same as a hit. It does not: a hit runs
   * `verifyAndRecord`'s `SELECT … FOR UPDATE` on `user_credentials` and its failed-attempt
   * `UPDATE`, and a miss has no row for either, so the miss is exactly two statements cheaper. That
   * asymmetry is T-032's and predates this ticket — its decoy pads the ~50ms of argon2, not the
   * database — and closing it would mean an unauthenticated request WRITING a decoy row for every
   * identifier that matches nobody. M1 §17's acceptance criterion for hit-versus-miss is the
   * timing one, which `login.enumeration.int.test.ts` measures over 1,000 samples and which passes.
   * The gap is pinned at exactly two here so it cannot grow unnoticed.
   */
  it('issues no extra statement on the rejected path for an MFA account than for a plain one', async () => {
    const cheap = mfaDeps({ hasher: countingHasher({ matches: false }) });
    await seedHardened();
    await seedAccount(PLAIN_USER);

    const attempt = (identifier: string) => () =>
      login(t.db(), cheap, { identifier, password: WRONG, ip: null, userAgent: null });

    // Warm first: a prepared-statement or pool handshake is not part of the comparison.
    await attempt(PLAIN_USER)();
    await attempt(MFA_USER)();
    await attempt(UNKNOWN)();

    const plain = await countStatements(t.app(), attempt(PLAIN_USER));
    const hardened = await countStatements(t.app(), attempt(MFA_USER));
    const unknown = await countStatements(t.app(), attempt(UNKNOWN));

    // T-036's property, and the reason this test exists.
    expect(hardened).toBe(plain);
    // T-032's documented hit/miss gap, pinned rather than asserted away: the credential read and
    // the failed-attempt write that a miss has no row for.
    expect(plain - unknown).toBe(2);
  });

  it('answers all three with the identical 401 body', async () => {
    await seedHardened();
    await seedAccount(PLAIN_USER);

    const send = (identifier: string) =>
      request(app).post('/v1/auth/login').send({ identifier, password: WRONG });

    const hardened = await send(MFA_USER);
    const plain = await send(PLAIN_USER);
    const unknown = await send(UNKNOWN);

    expect(hardened.status).toBe(401);
    expect(plain.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(hardened.body).toEqual(plain.body);
    expect(hardened.body).toEqual(unknown.body);
  });

  /**
   * The branch is reached only with the RIGHT password, which is the whole argument: anyone who can
   * see it has already won the thing enumeration was the first step towards.
   */
  it('reaches the branch only on a correct password', async () => {
    await seedHardened();

    const refused = await request(app).post('/v1/auth/login').send({ identifier: MFA_USER, password: WRONG });
    expect(refused.status).toBe(401);
    expect(bodyOf<LoginBody>(refused).mfaRequired).toBeUndefined();

    const challenged = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: MFA_USER, password: PASSWORD });
    expect(challenged.status).toBe(200);
    const body = bodyOf<LoginBody>(challenged);
    expect(body.mfaRequired).toBe(true);
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });

  /** A suspended MFA account must still look exactly like a wrong password (§S3, status after work). */
  it('answers a suspended MFA account with the rejection and never with a challenge', async () => {
    const userId = await seedHardened();
    await t.owner().query(`UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1`, [userId]);

    const response = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: MFA_USER, password: PASSWORD });
    expect(response.status).toBe(401);
    expect(bodyOf<LoginBody>(response).mfaRequired).toBeUndefined();
  });

  /** The challenge says what to present, and nothing about the account beyond that. */
  it('names the factors without leaking a secret or an address', async () => {
    await seedHardened();
    const response = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: MFA_USER, password: PASSWORD });

    const challenge = bodyOf<Challenge>(response);
    // The authenticator and the backup codes activating it minted — screen TF2's sheet is a way
    // through a challenge, which is what it is for.
    expect(challenge.factors.map((factor) => factor.type).sort()).toEqual(['RECOVERY_CODE', 'TOTP']);
    expect(challenge.factors.find((factor) => factor.type === 'TOTP')).toMatchObject({
      hint: 'Authenticator app',
      isDefault: true,
    });
    for (const factor of challenge.factors) expect(factor.id).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain(MFA_USER);
  });
});
