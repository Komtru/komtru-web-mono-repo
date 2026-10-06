// The whole of M1 §9.3 in one walk: E2 → E3 → onboarding → E4, and what the notify pipeline makes
// of it. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { NotifyConfig } from '../../../src/config/env.js';
import { DEFAULT_TERMS_VERSION } from '../../../src/modules/identity/domain/terms.js';
import { createIdentityAuth } from '../../../src/modules/identity/index.js';
import { BINDINGS } from '../../../src/modules/notify/domain/binding.js';
import { CATALOGUE } from '../../../src/modules/notify/domain/catalogue.js';
import { dispatchForEvent } from '../../../src/modules/notify/services/dispatch.service.js';
import { syncCatalogue } from '../../../src/modules/notify/services/sync.service.js';
import { createIdempotencyGate } from '../../../src/platform/http/idempotency.js';
import { mountRoutes } from '../../../src/platform/http/mount.js';
import { createRateLimitGate } from '../../../src/platform/http/rateLimit.js';
import { infraEnabled } from '../../support/db-urls.js';
import { useTestDatabase } from '../../support/db.js';
import { createTestRedis, testConfig, testLogger } from './support.js';

const bodyOf = <T>(response: { body: unknown }): T => response.body as T;

interface Registered {
  userId: string;
  challengeId: string;
  nextStep: string;
}
interface Session {
  accessToken: string;
  refreshToken: string;
  nextStep: string;
  user: { id: string; username: string | null };
}

const PHONE = '0802 341 5567';
const EMAIL = 'jane@example.com';
const PASSWORD = 'a sturdy passphrase 1';

const notifyConfig = (overrides: Partial<NotifyConfig> = {}): NotifyConfig => ({
  defaultLocale: 'en-NG',
  maxAttempts: 5,
  retryBaseDelayMs: 10,
  rateLimitWindowMinutes: 60,
  rateLimitMaxPerWindow: 20,
  smsDryRun: true,
  pushDryRun: true,
  ...overrides,
});

describe.runIf(infraEnabled)('the registration flow end to end (M1 §9.3)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let app: Express;

  const build = (mirror: boolean) => {
    const config = testConfig(mirror ? { IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL: 'true' } : {});
    const auth = createIdentityAuth({ db: t.db(), redis, config, logger: testLogger });
    return createApp({
      config,
      logger: testLogger,
      mountV1: mountRoutes(auth.routes ?? [], {
        logger: testLogger,
        idempotency: createIdempotencyGate({ db: t.db(), redis, logger: testLogger }),
        rateLimit: createRateLimitGate({ redis, logger: testLogger, keyPrefix: `rl-${randomUUID()}` }),
        resolveActor: auth.resolveActor,
      }),
    });
  };

  beforeEach(async () => {
    redis ??= createTestRedis();
    app = build(false);
    // The templates the identity bindings render from. In a running process `notify`'s start() does
    // this; here only the identity routes are mounted, so the catalogue is synced by hand.
    await syncCatalogue(t.db(), CATALOGUE);
  });

  afterAll(() => {
    redis?.disconnect();
  });

  const codeFor = async (challengeId: string): Promise<string> => {
    const { rows } = await t
      .app()
      .query<{ payload: { challengeId: string; code: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested'`,
      );
    const match = rows.map((r) => r.payload).find((p) => p.challengeId === challengeId);
    if (!match) throw new Error(`no identity.otp.requested for ${challengeId}`);
    return match.code;
  };

  /** Runs the notify binding for every `identity.otp.requested` in the outbox, as the worker would. */
  const runOtpBinding = async (): Promise<void> => {
    const binding = BINDINGS.find((b) => b.event.eventType === 'identity.otp.requested');
    if (!binding) throw new Error('no identity.otp.requested binding');
    const { rows } = await t.app().query<{ event_id: string; occurred_at: Date; payload: unknown }>(
      `SELECT event_id, occurred_at, payload FROM platform.outbox
          WHERE event_type = 'identity.otp.requested' ORDER BY occurred_at`,
    );
    for (const row of rows) {
      await t.db().transaction((tx) =>
        dispatchForEvent({ config: notifyConfig(), logger: testLogger }, tx, {
          envelope: {
            eventId: row.event_id,
            eventType: 'identity.otp.requested',
            version: 1,
            occurredAt: row.occurred_at.toISOString(),
            actor: { type: 'SYSTEM' },
            payload: row.payload,
          },
          templateKey: binding.templateKey,
          recipients: binding.recipients(row.payload),
        }),
      );
    }
  };

  const notifications = async () =>
    (
      await t
        .app()
        .query<{ channel: string; status: string; rendered_body: string; recipient_masked: string | null }>(
          `SELECT channel, status, rendered_body, recipient_masked FROM notify.notifications ORDER BY channel`,
        )
    ).rows;

  it('takes a phone-first user from signup to CONTACT_VERIFIED', async () => {
    // E2: sign up with a number and a name, no password.
    const registered = bodyOf<Registered>(
      await request(app).post('/v1/auth/register').send({
        channel: 'PHONE',
        phone: PHONE,
        fullName: 'Jane Doe',
        acceptedTermsVersion: DEFAULT_TERMS_VERSION,
      }),
    );
    expect(registered.nextStep).toBe('VERIFY_PHONE');

    // E3: the code arrives by SMS and proves the channel.
    let session = bodyOf<Session>(
      await request(app)
        .post('/v1/auth/verify-otp')
        .send({ challengeId: registered.challengeId, code: await codeFor(registered.challengeId) }),
    );
    expect(session.nextStep).toBe('SET_PASSWORD');
    const bearer = () => `Bearer ${session.accessToken}`;

    // §9.3: the phone path sets its password after the channel is proven, with no older one.
    expect(
      (
        await request(app)
          .post('/v1/auth/password/change')
          .set('Authorization', bearer())
          .send({ newPassword: PASSWORD })
      ).status,
    ).toBe(200);

    // CHOOSE_USERNAME is next, and it is T-033's route.
    expect(
      (
        await request(app)
          .post('/v1/me/username')
          .set('Authorization', bearer())
          .send({ username: 'janedoe' })
      ).status,
    ).toBe(200);

    // E4: the password works.
    session = bodyOf<Session>(
      await request(app).post('/v1/auth/login').send({ identifier: 'janedoe', password: PASSWORD }),
    );
    expect(session.user.username).toBe('janedoe');
    expect(session.nextStep).toBe('ADD_EMAIL');

    // The second channel. M1 §2: level 1 needs BOTH.
    const { rows: before } = await t
      .app()
      .query<{ verification_level: string }>(`SELECT verification_level FROM identity.users WHERE id = $1`, [
        registered.userId,
      ]);
    expect(before[0]?.verification_level).toBe('UNVERIFIED');
  });

  it('queues one SMS and no email for a phone registration', async () => {
    await request(app).post('/v1/auth/register').send({
      channel: 'PHONE',
      phone: PHONE,
      acceptedTermsVersion: DEFAULT_TERMS_VERSION,
    });
    await runOtpBinding();

    const rows = await notifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'SMS',
      status: 'QUEUED',
      recipient_masked: '+23480•••5567',
    });
    // The seeded SMS body is 'Komtru: {{code}} is your {{purpose}} code...'
    expect(rows[0]?.rendered_body).toMatch(/^Komtru: \d{6} is your verification code/);
  });

  it('queues one email and no SMS for an email registration', async () => {
    await request(app).post('/v1/auth/register').send({
      channel: 'EMAIL',
      email: EMAIL,
      password: PASSWORD,
      acceptedTermsVersion: DEFAULT_TERMS_VERSION,
    });
    await runOtpBinding();

    const rows = await notifications();
    expect(rows.map((r) => r.channel)).toEqual(['EMAIL']);
    expect(rows[0]?.status).toBe('QUEUED');
  });

  it('mirrors a phone OTP to email when IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL is on', async () => {
    const mirroring = build(true);

    // A registration code has nowhere to be mirrored — the account has no email yet.
    const registered = bodyOf<Registered>(
      await request(mirroring)
        .post('/v1/auth/register')
        .send({ channel: 'PHONE', phone: PHONE, acceptedTermsVersion: DEFAULT_TERMS_VERSION }),
    );
    const channelsOf = async (challengeId: string): Promise<string[]> => {
      const { rows } = await t
        .app()
        .query<{ payload: { challengeId: string; channels: string[] } }>(
          `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested'`,
        );
      const match = rows.map((r) => r.payload).find((p) => p.challengeId === challengeId);
      if (!match) throw new Error(`no identity.otp.requested for ${challengeId}`);
      return match.channels;
    };
    expect(await channelsOf(registered.challengeId)).toEqual(['SMS']);

    // Give the account an email, then resend: now there is somewhere to mirror to.
    await t.owner().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary)
           VALUES ($1, $2, $2, true)`,
      [registered.userId, EMAIL],
    );
    const resent = bodyOf<Registered>(
      await request(mirroring).post('/v1/auth/otp/resend').send({ challengeId: registered.challengeId }),
    );
    expect(await channelsOf(resent.challengeId)).toEqual(['SMS', 'EMAIL']);

    // And the binding turns that into two notification rows carrying the same code.
    await runOtpBinding();
    const rows = (await notifications()).filter((r) => r.status === 'QUEUED');
    expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'SMS']);
    const code = await codeFor(resent.challengeId);
    for (const row of rows) expect(row.rendered_body).toContain(code);
  });

  it('does not mirror when the flag is off, even for a user who has an email', async () => {
    const registered = bodyOf<Registered>(
      await request(app)
        .post('/v1/auth/register')
        .send({ channel: 'PHONE', phone: PHONE, acceptedTermsVersion: DEFAULT_TERMS_VERSION }),
    );
    await t.owner().query(
      `INSERT INTO identity.user_emails (user_id, email, email_normal, is_primary)
           VALUES ($1, $2, $2, true)`,
      [registered.userId, EMAIL],
    );
    const resent = bodyOf<Registered>(
      await request(app).post('/v1/auth/otp/resend').send({ challengeId: registered.challengeId }),
    );

    const { rows } = await t
      .app()
      .query<{ payload: { challengeId: string; channels: string[] } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested'`,
      );
    expect(rows.map((r) => r.payload).find((p) => p.challengeId === resent.challengeId)?.channels).toEqual([
      'SMS',
    ]);
  });

  it('never writes an OTP code or a password into the audit log (S12)', async () => {
    const registered = bodyOf<Registered>(
      await request(app)
        .post('/v1/auth/register')
        .send({ channel: 'PHONE', phone: PHONE, acceptedTermsVersion: DEFAULT_TERMS_VERSION }),
    );
    const code = await codeFor(registered.challengeId);
    const session = bodyOf<Session>(
      await request(app).post('/v1/auth/verify-otp').send({ challengeId: registered.challengeId, code }),
    );
    await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ newPassword: PASSWORD });

    const { rows } = await t
      .app()
      .query<{ metadata: unknown }>(`SELECT metadata FROM identity.identity_audit_log`);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('+2348023415567');
  });

  it('is not idempotent by key: a replayed register is a genuine second attempt', async () => {
    const key = randomUUID();
    const first = await request(app)
      .post('/v1/auth/register')
      .set('Idempotency-Key', key)
      .send({ channel: 'PHONE', phone: PHONE, acceptedTermsVersion: DEFAULT_TERMS_VERSION });
    expect(first.status).toBe(201);

    // The route declares `retryable: false`, so the key is ignored and the second call opens a
    // second PENDING account on the same unverified number — which the partial index allows.
    const second = await request(app)
      .post('/v1/auth/register')
      .set('Idempotency-Key', key)
      .send({ channel: 'PHONE', phone: PHONE, acceptedTermsVersion: DEFAULT_TERMS_VERSION });
    expect(second.status).toBe(201);
    expect(bodyOf<Registered>(second).userId).not.toBe(bodyOf<Registered>(first).userId);
  });
});
