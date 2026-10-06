// M1 §17's enumeration requirement for party lookup, as it names it:
//
//   "/parties/lookup returns identical shape and timing for miss and for
//    discoverable_by_email = false"
//   "Rate limits trigger per user, per device and per IP independently"
//
// Modelled on login.enumeration.int.test.ts, because the property is the same one and the way to
// measure it is the same: interleave the two series so a drifting machine load affects both equally,
// warm the pool and the plan cache first, and compare medians rather than means.
//
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../src/app.js';
import { createIdentityAuth } from '../../../../src/modules/identity/index.js';
import { createIdempotencyGate } from '../../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { createTokenSigner } from '../../../../src/modules/identity/infrastructure/jwt/access-token.js';
import {
  NO_LOOKUP_BUDGET,
  createLookupBudget,
} from '../../../../src/modules/identity/infrastructure/redis/lookup-budget.js';
import { lookupParty, type PartyDeps } from '../../../../src/modules/identity/services/party.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { TYPEAHEAD_HANDLES, insertUser } from '../infrastructure/postgres/support.js';
import { skeleton } from '../../../../src/modules/identity/domain/username/skeleton.js';
import { createTestRedis, redisReady, testConfig, testLogger } from '../support.js';

const SAMPLES = 300;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
};

describe.runIf(infraEnabled)('party lookup enumeration (M1 §17)', () => {
  const t = useTestDatabase();
  // Without this express ignores `X-Forwarded-For` entirely (TRUST_PROXY_HOPS defaults to 0), so
  // the per-IP cases below would all share the loopback address and pass for the wrong reason.
  const config = testConfig({ TRUST_PROXY_HOPS: '1' });
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

  /** A caller who passes §8.3 control 2, with a live session and an access token for it. */
  const seedCaller = async (level = 'CONTACT_VERIFIED'): Promise<string> => {
    const userId = await insertUser(t.owner(), { status: 'ACTIVE', verification_level: level });
    const { rows } = await t.owner().query<{ id: string }>(
      `INSERT INTO identity.sessions
         (user_id, scope, family_id, refresh_token_hash, absolute_expires_at, idle_expires_at, amr)
       VALUES ($1, 'CONSUMER', gen_random_uuid(), $2,
               now() + interval '30 days', now() + interval '30 days', ARRAY['pwd'])
       RETURNING id`,
      [userId, Buffer.from(userId.replaceAll('-', ''), 'hex')],
    );
    const session = rows[0];
    if (!session) throw new Error('seedCaller(): no session row');
    return createTokenSigner(config).sign({ sub: userId, sid: session.id, scp: 'CONSUMER', epc: 1 });
  };

  const seedParty = async (email: string, overrides: Record<string, unknown> = {}): Promise<string> => {
    const userId = await insertUser(t.owner(), {
      status: 'ACTIVE',
      verification_level: 'CONTACT_VERIFIED',
      ...overrides,
    });
    await t.owner().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary, verified_at)
         VALUES ($1, $2, $2, true, now())`,
      [userId, email],
    );
    return userId;
  };

  const lookupEmail = (token: string, email: string, ip = '198.51.100.1') =>
    request(app)
      .post('/v1/parties/lookup')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', ip)
      .send({ email });

  const FOUND = 'found@example.com';
  const HIDDEN = 'hidden@example.com';
  const MISSING = 'missing@example.com';

  const seedThree = async (): Promise<void> => {
    await seedParty(FOUND);
    await seedParty(HIDDEN, { discoverable_by_email: false });
  };

  it('answers a miss and a hidden user with the same status and the same body', async () => {
    const token = await seedCaller();
    await seedThree();

    const hidden = await lookupEmail(token, HIDDEN);
    const missing = await lookupEmail(token, MISSING);

    expect(hidden.status).toBe(200);
    expect(missing.status).toBe(hidden.status);
    expect(hidden.body).toEqual(missing.body);
    expect(hidden.body).toEqual({ found: false, canInvite: true, maskedHint: null });
  });

  it('answers a suspended user the same way', async () => {
    const token = await seedCaller();
    await seedParty('suspended@example.com', { status: 'SUSPENDED' });

    const suspended = await lookupEmail(token, 'suspended@example.com');
    const missing = await lookupEmail(token, MISSING);
    expect(suspended.body).toEqual(missing.body);
  });

  // The two timing cases measure `lookupParty` DIRECTLY and not over HTTP, which is what
  // `login.enumeration.int.test.ts` does for the same property and for the same reason: the route's
  // own §8.3 control 3 window is ten a minute, so six hundred samples through HTTP would be five
  // hundred and ninety 429s and the comparison would be between two error responses. What has to be
  // flat is the DATABASE work, and that is what these measure.
  const serviceDeps = (): PartyDeps => ({ db: t.db(), budget: NO_LOOKUP_BUDGET });

  const measure = async (caller: string, a: string, b: string): Promise<number> => {
    const call = (email: string) =>
      lookupParty(serviceDeps(), {
        actorUserId: caller,
        ip: '198.51.100.1',
        key: { channel: 'EMAIL', canonical: email },
      });

    // Warm the pool and the plan cache; the first few calls of either path are not comparable.
    for (let i = 0; i < 20; i += 1) {
      await call(a);
      await call(b);
    }

    const first: number[] = [];
    const second: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      // Interleaved, so a drifting machine load affects both series equally.
      let start = performance.now();
      await call(a);
      first.push(performance.now() - start);

      start = performance.now();
      await call(b);
      second.push(performance.now() - start);
    }
    return Math.abs(median(first) - median(second));
  };

  it(
    `takes the same time for a hidden user and for a miss: < 5ms over ${String(SAMPLES)} samples`,
    { timeout: 180_000 },
    async () => {
      // The pair M1 §17 names for this endpoint.
      const callerId = await insertUser(t.owner(), {
        status: 'ACTIVE',
        verification_level: 'CONTACT_VERIFIED',
      });
      await seedThree();
      expect(await measure(callerId, HIDDEN, MISSING)).toBeLessThan(5);
    },
  );

  it(
    `takes the same time for a found party and for a miss: < 5ms over ${String(SAMPLES)} samples`,
    { timeout: 180_000 },
    async () => {
      // Not named by §17, but the same oracle one step further out: if finding somebody were
      // measurably slower than not finding them, the uniform body would buy nothing.
      const callerId = await insertUser(t.owner(), {
        status: 'ACTIVE',
        verification_level: 'CONTACT_VERIFIED',
      });
      await seedThree();
      expect(await measure(callerId, FOUND, MISSING)).toBeLessThan(5);
    },
  );

  it('returns no contact field on a found card (§8.2)', async () => {
    const token = await seedCaller();
    await seedThree();

    const found = await lookupEmail(token, FOUND);
    expect(found.body).toMatchObject({ found: true });
    expect(JSON.stringify(found.body)).not.toContain(FOUND);
    expect(Object.keys((found.body as { party: object }).party).sort()).toEqual([
      'avatarUrl',
      'badges',
      'canBuy',
      'completedTrades',
      'displayName',
      'isMerchant',
      'memberSince',
      'merchantName',
      'publicId',
      'username',
      'verificationLevel',
    ]);
  });

  it('answers 403 for a caller below CONTACT_VERIFIED, whatever it is asked about', async () => {
    // The gate is about the CALLER. A 403 for a real person and a 404 for nobody would be the
    // oracle moved one layer up.
    const token = await seedCaller('UNVERIFIED');
    await seedThree();

    const real = await lookupEmail(token, FOUND);
    const missing = await lookupEmail(token, MISSING);
    expect(real.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(real.body).toEqual(missing.body);
  });

  it('writes one identity.party.lookup_performed per call, hit or miss, carrying no address', async () => {
    const token = await seedCaller();
    await seedThree();

    await lookupEmail(token, FOUND);
    await lookupEmail(token, HIDDEN);
    await lookupEmail(token, MISSING);

    const { rows } = await t.app().query<{ payload: { found: boolean } }>(
      `SELECT payload FROM platform.outbox
        WHERE event_type = 'identity.party.lookup_performed' ORDER BY occurred_at, event_id`,
    );
    expect(rows.map((row) => row.payload.found)).toEqual([true, false, false]);
    for (const address of [FOUND, HIDDEN, MISSING]) {
      expect(JSON.stringify(rows)).not.toContain(address);
    }
  });

  it('limits an email lookup per user, per device and per IP independently (M1 §17)', async () => {
    const token = await seedCaller();
    await seedThree();

    // §8.3 control 3: 10/min on the user key. Ten different IPs, one caller.
    for (let i = 0; i < 10; i += 1) {
      expect((await lookupEmail(token, MISSING, `203.0.113.${String(i)}`)).status).toBe(200);
    }
    expect((await lookupEmail(token, MISSING, '203.0.113.99')).status).toBe(429);

    // One device fingerprint, many callers, many IPs: the device budget still bites.
    const send = (bearer: string, ip: string) =>
      request(app)
        .post('/v1/parties/lookup')
        .set('Authorization', `Bearer ${bearer}`)
        .set('X-Forwarded-For', ip)
        .send({ email: MISSING, deviceFingerprint: 'one-handset' });

    for (let i = 0; i < 10; i += 1) {
      await send(await seedCaller(), `192.0.2.${String(i)}`);
    }
    expect((await send(await seedCaller(), '192.0.2.99')).status).toBe(429);
  });

  it('bounds a caller at fifty email lookups a day, not merely ten a minute (§8.3 control 3)', async () => {
    // The minute budget is the route's; the day budget is identity's own, and it is the one that
    // bounds an attacker willing to wait between bursts. Exercised directly against Redis, because
    // reaching it through HTTP means first defeating the route's own ten-a-minute window, and a test
    // that deletes the route's keys to get past it would be testing the deletion.
    const budget = createLookupBudget({ redis, logger: testLogger, keyPrefix: `lb-${randomUUID()}` });
    const subject = `user:${randomUUID()}`;

    for (let i = 0; i < 50; i += 1) await budget.charge('EMAIL', subject);
    await expect(budget.charge('EMAIL', subject)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });

    // A handle is public by design, so its budget is ten times looser on the same horizon.
    const handles = `user:${randomUUID()}`;
    for (let i = 0; i < 51; i += 1) await budget.charge('USERNAME', handles);
  });

  it('answers a handle typeahead with at most eight, and nothing for two characters', async () => {
    const token = await seedCaller();
    for (const username of TYPEAHEAD_HANDLES) {
      await insertUser(t.owner(), {
        status: 'ACTIVE',
        verification_level: 'CONTACT_VERIFIED',
        username,
        // Through `skeleton()`, not the handle itself: the column holds the FOLD, and a fixture
        // that writes the raw handle there seeds a row the service could never have written and
        // quietly stops exercising users_username_skeleton_unique.
        username_skeleton: skeleton(username),
      });
    }

    const suggest = (q: string) =>
      request(app).get('/v1/parties/suggest').query({ q }).set('Authorization', `Bearer ${token}`);

    expect(((await suggest('jan')).body as { parties: unknown[] }).parties).toHaveLength(8);
    expect(((await suggest('ja')).body as { parties: unknown[] }).parties).toHaveLength(0);
  });

  it('refuses an unauthenticated caller on every lookup route', async () => {
    for (const call of [
      request(app).get('/v1/parties/lookup').query({ username: 'janedoe' }),
      request(app).post('/v1/parties/lookup').send({ email: MISSING }),
      request(app).get('/v1/parties/suggest').query({ q: 'jan' }),
      request(app).post('/v1/parties/invite').send({
        channel: 'EMAIL',
        destination: MISSING,
        intendedRole: 'SELLER',
      }),
    ]) {
      expect((await call).status).toBe(401);
    }
  });
});
