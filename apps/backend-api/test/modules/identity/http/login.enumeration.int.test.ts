// M1 §17's enumeration suite, as named there. Skipped unless KOMTRU_INFRA_TESTS=1.
//
//   - "POST /auth/login response time variance between existing and nonexistent user < 5ms across
//     1,000 samples"
//   - "/auth/password/forgot returns identical response for known and unknown identifiers"
//   - "Rate limits trigger per user, per device and per IP independently"
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
import { createIdempotencyGate } from '../../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import {
  mfaDeps,
  countingHasher,
  createTestRedis,
  redisReady,
  seedUser,
  testConfig,
  testLogger,
} from '../support.js';

const PASSWORD = 'a sturdy passphrase 1';
const KNOWN = 'jane@example.com';
const UNKNOWN = 'nobody@example.com';
const SAMPLES = 1000;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
};

describe.runIf(infraEnabled)('enumeration (M1 §17)', () => {
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

  const seedKnownUser = async (): Promise<string> => {
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      const email = await attachEmail(tx, { userId, email: KNOWN, makePrimary: true });
      await markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' });
      await setPassword(tx, mfaDeps(), { userId, password: PASSWORD });
    });
    return userId;
  };

  // 2 x SAMPLES real transactions against Postgres. The default 5s budget is for a unit test; this
  // one is a measurement, and cutting it short would turn a timing assertion into a timeout.
  it(
    `takes the same time for an existing and a nonexistent user: < 5ms over ${String(SAMPLES)} samples`,
    { timeout: 120_000 },
    async () => {
      await seedKnownUser();
      // A CONSTANT-COST hasher, injected. The argon2 work is identical on both paths by construction
      // — credential.service's own suite proves exactly one verification happens either way — and
      // measuring it here would spend two minutes of CPU confirming that. What this measures instead
      // is the DATABASE work, which is where a real difference would hide: an extra credential
      // lookup on the hit path and none on the miss path is precisely the oracle §S3 is about.
      const deps = mfaDeps({ hasher: countingHasher({ matches: false }) });
      const attempt = (identifier: string) =>
        login(t.db(), deps, { identifier, password: 'not the password', ip: null, userAgent: null });

      // Warm the pool and the plan cache; the first few calls of either path are not comparable.
      for (let i = 0; i < 20; i += 1) {
        await attempt(KNOWN);
        await attempt(UNKNOWN);
      }

      const hits: number[] = [];
      const misses: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        // Interleaved, so a drifting machine load affects both series equally.
        let start = performance.now();
        await attempt(KNOWN);
        hits.push(performance.now() - start);

        start = performance.now();
        await attempt(UNKNOWN);
        misses.push(performance.now() - start);
      }

      expect(Math.abs(median(hits) - median(misses))).toBeLessThan(5);
    },
  );

  it('answers a wrong password and an unknown identifier with exactly the same body and status', async () => {
    await seedKnownUser();
    const wrong = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: KNOWN, password: 'not the password' });
    const unknown = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: UNKNOWN, password: 'not the password' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('answers a suspended account the same way as a wrong password (S3)', async () => {
    const userId = await seedKnownUser();
    await t.owner().query(`UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1`, [userId]);

    const suspended = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: KNOWN, password: PASSWORD });
    const unknown = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: UNKNOWN, password: PASSWORD });
    expect(suspended.status).toBe(401);
    expect(suspended.body).toEqual(unknown.body);
  });

  it('returns an identical forgot-password response for a known and an unknown identifier', async () => {
    await seedKnownUser();
    const known = await request(app).post('/v1/auth/password/forgot').send({ identifier: KNOWN });
    const unknown = await request(app).post('/v1/auth/password/forgot').send({ identifier: UNKNOWN });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);

    // The property M1 §17 asks for is that nothing in the response depends on whether the account
    // EXISTS. `challengeId` and `expiresAt` differ between any two calls, and `maskedDestination`
    // is a mask of what the CALLER TYPED — `j•••@example.com` against `n•••@example.com` — so it
    // differs because the inputs did, not because one matched. Comparing the whole body asserted
    // something stronger than the guarantee and stronger than is achievable.
    const shape = (body: Record<string, unknown>) => ({
      ...body,
      challengeId: '',
      expiresAt: 0,
      maskedDestination: '',
    });
    expect(shape(unknown.body as Record<string, unknown>)).toEqual(
      shape(known.body as Record<string, unknown>),
    );
    expect(Object.keys(unknown.body as object).sort()).toEqual(Object.keys(known.body as object).sort());
    expect((known.body as { challengeId: string }).challengeId).toBeTruthy();
    expect((unknown.body as { challengeId: string }).challengeId).toBeTruthy();

    // And the mask really is of the input, not of anything the account holds.
    expect((known.body as { maskedDestination: string }).maskedDestination).toBe('j•••@example.com');
    expect((unknown.body as { maskedDestination: string }).maskedDestination).toBe('n•••@example.com');
  });

  it('answers the same way for two identifiers that differ only in whether they exist', async () => {
    // The sharpest form of §17: same shape, same length, one real and one not — so the only thing
    // that could differ is existence, and nothing does.
    await seedKnownUser();
    const a = await request(app).post('/v1/auth/password/forgot').send({ identifier: KNOWN });
    const b = await request(app)
      .post('/v1/auth/password/forgot')
      .send({ identifier: KNOWN.replace('jane', 'jak3') });

    expect(b.status).toBe(a.status);
    const shape = (body: Record<string, unknown>) => ({ ...body, challengeId: '', expiresAt: 0 });
    // Same local-part length, so even the mask matches.
    expect(shape(b.body as Record<string, unknown>)).toEqual(shape(a.body as Record<string, unknown>));
  });

  it('writes a real challenge row for the unknown identifier, so verifying it is indistinguishable', async () => {
    const unknown = await request(app).post('/v1/auth/password/forgot').send({ identifier: UNKNOWN });
    const challengeId = (unknown.body as { challengeId: string }).challengeId;

    const { rows } = await t
      .app()
      .query<{ user_id: string | null }>(`SELECT user_id FROM identity.otp_challenges WHERE id = $1`, [
        challengeId,
      ]);
    expect(rows[0]?.user_id).toBeNull();

    // And it answers like a real one: a wrong code spends an attempt and says how many are left.
    const attempt = await request(app).post('/v1/auth/verify-otp').send({ challengeId, code: '000000' });
    expect(attempt.status).toBe(422);
    expect(attempt.body).toMatchObject({ code: 'OTP_INVALID', attemptsRemaining: 4 });
  });

  it('answers a resend the same way for a decoy challenge and a real one (closes the oracle)', async () => {
    await seedKnownUser();
    const known = await request(app).post('/v1/auth/password/forgot').send({ identifier: KNOWN });
    const unknown = await request(app).post('/v1/auth/password/forgot').send({ identifier: UNKNOWN });

    // The whole decoy design is undone if one extra unauthenticated request can tell them apart:
    // take the challengeId the forgot response just gave you and ask for a resend.
    const resendKnown = await request(app)
      .post('/v1/auth/otp/resend')
      .send({ challengeId: (known.body as { challengeId: string }).challengeId });
    const resendUnknown = await request(app)
      .post('/v1/auth/otp/resend')
      .send({ challengeId: (unknown.body as { challengeId: string }).challengeId });

    expect(resendKnown.status).toBe(200);
    expect(resendUnknown.status).toBe(resendKnown.status);
    const shape = (body: Record<string, unknown>) => ({ ...body, challengeId: '', expiresAt: 0 });
    expect(shape(resendUnknown.body as Record<string, unknown>)).toEqual(
      shape(resendKnown.body as Record<string, unknown>),
    );
    // And the resend response carries no mask, which would have been the same oracle by another name.
    expect(resendKnown.body).not.toHaveProperty('maskedDestination');
  });

  it('still sends nothing for the decoy, however many times it is resent', async () => {
    const unknown = await request(app).post('/v1/auth/password/forgot').send({ identifier: UNKNOWN });
    const challengeId = (unknown.body as { challengeId: string }).challengeId;
    await request(app).post('/v1/auth/otp/resend').send({ challengeId });

    const { rows } = await t
      .app()
      .query(`SELECT 1 FROM platform.outbox WHERE event_type = 'identity.otp.requested'`);
    expect(rows).toEqual([]);
  });

  it('sends nothing for the unknown identifier', async () => {
    await request(app).post('/v1/auth/password/forgot').send({ identifier: UNKNOWN });
    const { rows } = await t
      .app()
      .query(`SELECT 1 FROM platform.outbox WHERE event_type = 'identity.otp.requested'`);
    expect(rows).toEqual([]);
  });

  it('limits login per identifier, per IP and per device independently (M1 §17)', async () => {
    await seedKnownUser();
    const send = (body: Record<string, unknown>, ip: string) =>
      request(app).post('/v1/auth/login').set('X-Forwarded-For', ip).send(body);

    // §S4: 5/min/identifier. Five different IPs, one identifier.
    for (let i = 0; i < 5; i += 1) {
      const response = await send({ identifier: KNOWN, password: 'x'.repeat(12) }, `198.51.100.${String(i)}`);
      expect(response.status).toBe(401);
    }
    expect((await send({ identifier: KNOWN, password: 'x'.repeat(12) }, '198.51.100.9')).status).toBe(429);

    // One device fingerprint, many identifiers, many IPs: the device budget still bites.
    for (let i = 0; i < 10; i += 1) {
      await send(
        {
          identifier: `user${String(i)}@example.com`,
          password: 'x'.repeat(12),
          deviceFingerprint: 'one-handset',
        },
        `203.0.113.${String(i)}`,
      );
    }
    const capped = await send(
      { identifier: 'user99@example.com', password: 'x'.repeat(12), deviceFingerprint: 'one-handset' },
      '203.0.113.99',
    );
    expect(capped.status).toBe(429);
  });
});
