// Screens TF1 and TF2 end to end, over HTTP. Skipped unless KOMTRU_INFRA_TESTS=1.
//
// This is the journey a user actually takes: set up two-factor, write the backup codes down, sign
// in again and be asked for a code, then try to turn two-factor off and be asked to prove it is
// you first.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../src/app.js';
import { createIdentityAuth } from '../../../../src/modules/identity/index.js';
import { attachEmail, markEmailVerified } from '../../../../src/modules/identity/services/contact.service.js';
import { setPassword } from '../../../../src/modules/identity/services/credential.service.js';
import { totpCodeAt, totpStep } from '../../../../src/modules/identity/domain/mfa/totp.js';
import { RECOVERY_CODE_COUNT } from '../../../../src/modules/identity/domain/mfa/recovery-codes.js';
import { createIdempotencyGate } from '../../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../../src/platform/http/rateLimit.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, mfaDeps, redisReady, seedUser, testConfig, testLogger } from '../support.js';

const PASSWORD = 'a sturdy passphrase 1';
const EMAIL = 'jane@example.com';

const codeNow = (secret: string): string => totpCodeAt(secret, totpStep(Date.now()));

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
interface Problem {
  code: string;
  acceptedFactors?: string[];
  attemptsRemaining?: number;
}

interface Enrolled {
  factorId: string;
  secret: string;
  otpauthUri: string;
}
interface Activated {
  factorId: string;
  recoveryCodes: string[] | null;
}
interface FactorPage {
  total: number;
  items: { id: string; type: string }[];
}
interface SessionPage {
  total: number;
  items: { id: string; current: boolean }[];
}
interface StepUp {
  stepUpToken: string;
}
interface Device {
  fingerprintHint: string;
}

describe.runIf(infraEnabled)('the two-factor journey (screens TF1, TF2)', () => {
  const t = useTestDatabase();
  const config = testConfig({ WEBAUTHN_ORIGINS: 'https://app.komtru.test' });
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

  const seedSignedUp = async (): Promise<string> => {
    const { userId } = await seedUser(t.app());
    await t.db().transaction(async (tx) => {
      const email = await attachEmail(tx, { userId, email: EMAIL, makePrimary: true });
      await markEmailVerified(tx, { userId, emailId: email.emailId, source: 'otp' });
      await setPassword(tx, mfaDeps(), { userId, password: PASSWORD });
    });
    return userId;
  };

  const signIn = async (): Promise<string> => {
    const response = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD });
    expect(response.status).toBe(200);
    return bodyOf<Session>(response).accessToken;
  };

  it('walks TF1 to TF2, then asks for the factor on the next sign-in, then for step-up to remove it', async () => {
    await seedSignedUp();
    const token = await signIn();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    // TF1 — "Scan this with Google Authenticator".
    const response = await auth(request(app).post('/v1/me/mfa/totp/enroll'));
    expect(response.status).toBe(200);
    const enrolled = bodyOf<Enrolled>(response);
    expect(enrolled.otpauthUri).toContain('otpauth://totp/');
    const secret = enrolled.secret;

    // A wrong code is a 422 that says how many tries are left (the same shape as screen E3b).
    const missed = await auth(
      request(app).post('/v1/me/mfa/totp/activate').send({ factorId: enrolled.factorId, code: '000000' }),
    );
    expect(missed.status).toBe(422);
    expect(bodyOf<Problem>(missed).attemptsRemaining).toBe(4);

    // TF1 — "Verify & enable" — and TF2, which is the same response.
    //
    // The PREVIOUS step, deliberately. Every presentation below has to be strictly newer than the
    // last one spent (the replay guard) AND inside `verifyTotp`'s ±1 window, so this journey walks
    // step-1 → step → step+1. Activating on the current step leaves only step+1 for the two
    // presentations that follow, and step+2 is outside the window.
    const activated = await auth(
      request(app)
        .post('/v1/me/mfa/totp/activate')
        .send({ factorId: enrolled.factorId, code: totpCodeAt(secret, totpStep(Date.now()) - 1) }),
    );
    expect(activated.status).toBe(200);
    expect(bodyOf<Activated>(activated).recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);

    const factors = bodyOf<FactorPage>(await auth(request(app).get('/v1/me/mfa/factors')));
    expect(factors.items.map((item) => item.type).sort()).toEqual(['RECOVERY_CODE', 'TOTP']);

    // The next sign-in is challenged rather than completed.
    const response2 = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD });
    expect(response2.status).toBe(200);
    const challenged = bodyOf<Challenge>(response2);
    expect(challenged.mfaRequired).toBe(true);
    expect(challenged.accessToken).toBeUndefined();

    // Named explicitly: the challenge offers the backup-code sheet alongside the authenticator, and
    // which one comes first is `activeFactors`' ordering, not something this test should rely on.
    const totpFactor = challenged.factors.find((factor) => factor.type === 'TOTP');
    const completed = await request(app)
      .post('/v1/auth/mfa/verify')
      .send({
        mfaToken: challenged.mfaToken,
        factorId: totpFactor?.id,
        code: codeNow(secret),
      });
    expect(completed.status).toBe(200);
    expect(bodyOf<Session>(completed).accessToken).toBeTruthy();
    expect(bodyOf<Session>(completed).scope).toBe('CONSUMER');

    // §S7 — removing a factor needs step-up, and the refusal says what to present.
    const refused = await auth(request(app).delete(`/v1/me/mfa/factors/${enrolled.factorId}`).send({}));
    expect(refused.status).toBe(403);
    expect(bodyOf<Problem>(refused).code).toBe('STEP_UP_REQUIRED');
    expect(bodyOf<Problem>(refused).acceptedFactors).toContain('TOTP');

    const proved = await auth(
      request(app)
        .post('/v1/me/step-up')
        .send({ factorId: enrolled.factorId, code: totpCodeAt(secret, totpStep(Date.now()) + 1) }),
    );
    expect(proved.status).toBe(200);

    const removed = await auth(
      request(app)
        .delete(`/v1/me/mfa/factors/${enrolled.factorId}`)
        .send({ stepUpToken: bodyOf<StepUp>(proved).stepUpToken }),
    );
    expect(removed.status).toBe(200);

    // The sheet of codes goes with it: ten printed codes are not a second factor.
    expect(bodyOf<FactorPage>(await auth(request(app).get('/v1/me/mfa/factors'))).items).toHaveLength(0);

    // And the sign-in is no longer challenged.
    const plain = bodyOf<LoginBody>(
      await request(app).post('/v1/auth/login').send({ identifier: EMAIL, password: PASSWORD }),
    );
    expect(plain.mfaRequired).toBeUndefined();
    expect(plain.accessToken).toBeTruthy();
  });

  /** A step-up token is single use: the 403 comes straight back on the second attempt. */
  it('spends the step-up token on the action it was presented for', async () => {
    await seedSignedUp();
    const token = await signIn();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const enrolled = bodyOf<Enrolled>(await auth(request(app).post('/v1/me/mfa/totp/enroll')));
    const secret = enrolled.secret;
    await auth(
      request(app)
        .post('/v1/me/mfa/totp/activate')
        .send({ factorId: enrolled.factorId, code: codeNow(secret) }),
    );

    const proved = await auth(
      request(app)
        .post('/v1/me/step-up')
        .send({ factorId: enrolled.factorId, code: totpCodeAt(secret, totpStep(Date.now()) + 1) }),
    );
    const { stepUpToken } = bodyOf<StepUp>(proved);

    // Spend it on something harmless, then try to reuse it.
    expect((await auth(request(app).post('/v1/me/mfa/recovery-codes').send({ stepUpToken }))).status).toBe(
      200,
    );
    expect((await auth(request(app).post('/v1/me/mfa/recovery-codes').send({ stepUpToken }))).status).toBe(
      403,
    );
  });

  /** An account with no factor proves itself with its password; one with a factor may not. */
  it('accepts a password for step-up only while the account has no factor', async () => {
    await seedSignedUp();
    const token = await signIn();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    expect((await auth(request(app).post('/v1/me/step-up').send({ password: PASSWORD }))).status).toBe(200);

    const enrolled = bodyOf<Enrolled>(await auth(request(app).post('/v1/me/mfa/totp/enroll')));
    await auth(
      request(app)
        .post('/v1/me/mfa/totp/activate')
        .send({ factorId: enrolled.factorId, code: codeNow(enrolled.secret) }),
    );

    expect((await auth(request(app).post('/v1/me/step-up').send({ password: PASSWORD }))).status).toBe(401);
  });

  it('answers 401 to an anonymous caller on every /me/mfa route', async () => {
    for (const [method, path] of [
      ['get', '/v1/me/mfa/factors'],
      ['post', '/v1/me/mfa/totp/enroll'],
      ['post', '/v1/me/step-up'],
    ] as const) {
      const response: request.Response = await request(app)[method](path).send({});
      expect(response.status, path).toBe(401);
    }
  });

  /** The device list and the session list belong to the same screen; both are T-036's. */
  it('lists the devices and the sessions of the caller only', async () => {
    await seedSignedUp();
    const token = await signIn();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const registered: request.Response = await auth(
      request(app)
        .post('/v1/me/devices')
        .send({ deviceFingerprint: 'fp-handset-abcdef', platform: 'ANDROID', pushToken: 'fcm-1' }),
    );
    expect(registered.status).toBe(200);
    expect(bodyOf<Device>(registered).fingerprintHint).toBe('abcdef');
    expect(JSON.stringify(registered.body)).not.toContain('fcm-1');

    const devices = bodyOf<{ total: number }>(await auth(request(app).get('/v1/me/devices')));
    expect(devices.total).toBe(1);

    const sessions = bodyOf<SessionPage>(await auth(request(app).get('/v1/me/sessions')));
    expect(sessions.total).toBe(1);
    expect(sessions.items[0]?.current).toBe(true);

    // Signing this session out makes the token useless on the next request.
    const revoked = await auth(request(app).delete(`/v1/me/sessions/${sessions.items[0]?.id ?? ''}`));
    expect(revoked.status).toBe(200);
    expect((await auth(request(app).get('/v1/me/sessions'))).status).toBe(401);
  });
});
