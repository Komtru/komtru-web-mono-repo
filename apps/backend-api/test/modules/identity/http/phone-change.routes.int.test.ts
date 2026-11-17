/* eslint-disable @typescript-eslint/no-unsafe-member-access -- raw `pg` rows and supertest bodies are untyped in assertions */
// F-045 (SP-M05) over HTTP: moving an account to a new phone number. Skipped unless KOMTRU_INFRA_TESTS=1.
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { attachPhone, markPhoneVerified } from '../../../../src/modules/identity/services/contact.service.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { createTestRedis, redisReady } from '../support.js';
import {
  PASSWORD,
  bodyOf,
  buildApp,
  seedCatalogue,
  seedMember,
  type Problem,
  type SessionBody,
} from './staff.support.js';

const OLD = '+2348032214471';
const NEW = '+2349051182290';

interface Started {
  changeId: string;
  challengeId: string;
  maskedDestination: string;
  delivered: boolean;
}
interface Sent {
  challengeId: string;
  maskedDestination: string;
}

describe.runIf(infraEnabled)('changing the phone number (F-045, SP-M05)', () => {
  const t = useTestDatabase();
  let redis: Redis;
  let app: Express;

  beforeEach(async () => {
    redis ??= createTestRedis();
    await redisReady(redis);
    await seedCatalogue(t);
    app = buildApp(t, redis);
  });
  afterAll(() => {
    redis?.disconnect();
  });

  /** A member with a verified email, a password and a verified phone, signed in. */
  const signedIn = async (phone: string | null = OLD) => {
    const member = await seedMember(t, app);
    if (phone !== null) {
      await t.db().transaction(async (tx) => {
        const attached = await attachPhone(tx, { userId: member.userId, phone, makePrimary: true });
        await markPhoneVerified(tx, { userId: member.userId, phoneId: attached.phoneId });
      });
    }
    const login = await request(app)
      .post('/v1/auth/login')
      .send({ identifier: member.email, password: PASSWORD });
    expect(login.status).toBe(200);
    return { ...member, token: bodyOf<SessionBody>(login).accessToken };
  };

  const as = (token: string) => ({
    post: (path: string, body: object = {}) =>
      request(app).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  /** The codes are only ever in the outbox: this is how a test learns one, by event type. */
  const codeFor = async (eventType: string, challengeId: string): Promise<string> => {
    const { rows } = await t
      .app()
      .query<{ payload: { challengeId: string; code: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = $1 ORDER BY occurred_at`,
        [eventType],
      );
    const match = rows.map((r) => r.payload).find((p) => p.challengeId === challengeId);
    if (!match) throw new Error(`no ${eventType} for ${challengeId}`);
    return match.code;
  };

  const phones = async (userId: string) =>
    (
      await t.owner().query<{ phone_e164: string; is_primary: boolean; verified: boolean }>(
        `SELECT phone_e164, is_primary, verified_at IS NOT NULL AS verified
             FROM identity.user_phones WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      )
    ).rows;

  /** §S7: a fresh single-use proof for each start. These members hold no factor, so the password is the proof. */
  const proof = async (token: string): Promise<string> => {
    const response = await as(token).post('/me/step-up', { password: PASSWORD });
    expect(response.status).toBe(200);
    return bodyOf<{ stepUpToken: string }>(response).stepUpToken;
  };

  const startRaw = async (token: string, newPhone = NEW) =>
    as(token).post('/me/phone/change', { newPhone, stepUpToken: await proof(token) });

  const start = async (token: string, newPhone = NEW) => {
    const response = await startRaw(token, newPhone);
    expect(response.status).toBe(200);
    return bodyOf<Started>(response);
  };

  const confirmCurrent = async (token: string, started: Started, code?: string) =>
    as(token).post('/me/phone/change/confirm-current', {
      changeId: started.changeId,
      challengeId: started.challengeId,
      code: code ?? (await codeFor('identity.otp.requested', started.challengeId)),
    });

  it('needs a session', async () => {
    expect((await request(app).post('/v1/me/phone/change').send({ newPhone: NEW })).status).toBe(401);
  });

  it('needs proof it is you first (§S7), and leaves nothing behind when it is refused', async () => {
    const me = await signedIn();
    const refused = await as(me.token).post('/me/phone/change', { newPhone: NEW });
    expect(refused.status).toBe(403);
    expect(bodyOf<Problem>(refused).code).toBe('STEP_UP_REQUIRED');
    expect(await phones(me.userId)).toHaveLength(1);
    // A proof is spent by the start it was for: it cannot start a second one.
    const token = await proof(me.token);
    expect((await as(me.token).post('/me/phone/change', { newPhone: NEW, stepUpToken: token })).status).toBe(
      200,
    );
    const again = await as(me.token).post('/me/phone/change', { newPhone: NEW, stepUpToken: token });
    expect(again.status).toBe(403);
  });

  it('moves the account to the new number once both numbers are proven, and tells the old one', async () => {
    const me = await signedIn();
    const started = await start(me.token, '0905 118 2290');
    // The first code goes to the CURRENT number, which is all the response says about it.
    expect(started.maskedDestination).toBe('+23480•••4471');
    expect(started.delivered).toBe(true);
    // Nothing has changed yet: the new number is pending and claims nothing.
    expect(await phones(me.userId)).toEqual([
      { phone_e164: OLD, is_primary: true, verified: true },
      { phone_e164: NEW, is_primary: false, verified: false },
    ]);

    const second = await confirmCurrent(me.token, started);
    expect(second.status).toBe(200);
    const sent = bodyOf<Sent>(second);
    expect(sent.maskedDestination).toBe('+23490•••2290');
    expect(await phones(me.userId)).toHaveLength(2);

    const done = await as(me.token).post('/me/phone/change/confirm-new', {
      changeId: started.changeId,
      challengeId: sent.challengeId,
      code: await codeFor('identity.phone_change.code_requested', sent.challengeId),
    });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ status: 'CHANGED', maskedPhone: '+23490•••2290' });

    // The new number is the account's; the old one is left in the shape Notify finds it by, claiming nothing.
    expect(await phones(me.userId)).toEqual([
      { phone_e164: OLD, is_primary: false, verified: false },
      { phone_e164: NEW, is_primary: true, verified: true },
    ]);
    const { rows } = await t
      .owner()
      .query(
        `SELECT p.phone_e164 FROM identity.users u JOIN identity.user_phones p ON p.id = u.primary_phone_id WHERE u.id = $1`,
        [me.userId],
      );
    expect(rows[0]?.phone_e164).toBe(NEW);

    // The notice is on its way, and carries no number in the clear.
    const notice = await t
      .app()
      .query(`SELECT payload FROM platform.outbox WHERE event_type = 'identity.phone.changed'`);
    expect(notice.rows).toHaveLength(1);
    expect(JSON.stringify(notice.rows[0]?.payload)).not.toMatch(/\+234\d{6,}/);
    // Both ends are on the audit trail, by id.
    const audit = await t
      .owner()
      .query<{ action: string; metadata: unknown }>(
        `SELECT action, metadata FROM identity.identity_audit_log WHERE subject_user_id = $1 AND action IN ('PHONE_CHANGE_STARTED','PHONE_CHANGED') ORDER BY occurred_at`,
        [me.userId],
      );
    expect(audit.rows.map((r) => r.action)).toEqual(['PHONE_CHANGE_STARTED', 'PHONE_CHANGED']);
    expect(JSON.stringify(audit.rows)).not.toContain('+234');
  });

  it('signs nobody in with the old number afterwards, and signs them in with the new one', async () => {
    const me = await signedIn();
    const started = await start(me.token);
    const sent = bodyOf<Sent>(await confirmCurrent(me.token, started));
    await as(me.token).post('/me/phone/change/confirm-new', {
      changeId: started.changeId,
      challengeId: sent.challengeId,
      code: await codeFor('identity.phone_change.code_requested', sent.challengeId),
    });
    const old = await request(app).post('/v1/auth/login').send({ identifier: OLD, password: PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await request(app).post('/v1/auth/login').send({ identifier: NEW, password: PASSWORD });
    expect(fresh.status).toBe(200);
  });

  it('retires a text-message second factor on the old number instead of moving it', async () => {
    const me = await signedIn();
    // Started while the account holds no factor, so the password is the proof; the factors arrive before the swap.
    const started = await start(me.token);
    const { rows: oldRows } = await t
      .owner()
      .query<{ id: string }>(`SELECT id FROM identity.user_phones WHERE user_id = $1`, [me.userId]);
    await t
      .owner()
      .query(
        `INSERT INTO identity.mfa_factors (user_id, factor_type, status, phone_id, verified_at, is_default) VALUES ($1, 'SMS_OTP', 'ACTIVE', $2, now(), true)`,
        [me.userId, oldRows[0]?.id],
      );
    await t
      .owner()
      .query(
        `INSERT INTO identity.mfa_factors (user_id, factor_type, status, verified_at) VALUES ($1, 'RECOVERY_CODE', 'ACTIVE', now())`,
        [me.userId],
      );
    const sent = bodyOf<Sent>(await confirmCurrent(me.token, started));
    await as(me.token).post('/me/phone/change/confirm-new', {
      changeId: started.changeId,
      challengeId: sent.challengeId,
      code: await codeFor('identity.phone_change.code_requested', sent.challengeId),
    });
    const { rows } = await t
      .owner()
      .query<{ factor_type: string; status: string; phone_id: string | null }>(
        `SELECT factor_type, status::text, phone_id FROM identity.mfa_factors WHERE user_id = $1 ORDER BY factor_type::text`,
        [me.userId],
      );
    // Revoked, not moved: the new number holds no factor until its owner sets one up there. With no second factor left, the
    // printed codes go too.
    expect(rows).toEqual([
      { factor_type: 'RECOVERY_CODE', status: 'REVOKED', phone_id: null },
      { factor_type: 'SMS_OTP', status: 'REVOKED', phone_id: oldRows[0]?.id },
    ]);
  });

  it('says a wrong code is wrong, with the tries left, and does not move on', async () => {
    const me = await signedIn();
    const started = await start(me.token);
    const wrong = await confirmCurrent(me.token, started, '000000');
    expect(wrong.status).toBe(422);
    expect(bodyOf<Problem>(wrong).code).toBe('OTP_INVALID');
    expect(wrong.body.attemptsRemaining).toBe(4);
    const { rows } = await t
      .app()
      .query(`SELECT 1 FROM platform.outbox WHERE event_type = 'identity.phone_change.code_requested'`);
    expect(rows).toHaveLength(0);
  });

  it('will not take the first number’s code for the second, or one challenge’s code for another change', async () => {
    const me = await signedIn();
    const started = await start(me.token);
    const firstCode = await codeFor('identity.otp.requested', started.challengeId);
    const sent = bodyOf<Sent>(await confirmCurrent(me.token, started, firstCode));
    // The code for the OLD number, offered against the NEW number's step.
    const early = await as(me.token).post('/me/phone/change/confirm-new', {
      changeId: started.changeId,
      challengeId: started.challengeId,
      code: firstCode,
    });
    expect(early.status).toBe(422);
    expect(bodyOf<Problem>(early).code).toBe('OTP_INVALID');
    expect(await phones(me.userId)).toEqual([
      { phone_e164: OLD, is_primary: true, verified: true },
      { phone_e164: NEW, is_primary: false, verified: false },
    ]);
    // The new number's real code still works afterwards: a wrong offer did not spend it.
    const done = await as(me.token).post('/me/phone/change/confirm-new', {
      changeId: started.changeId,
      challengeId: sent.challengeId,
      code: await codeFor('identity.phone_change.code_requested', sent.challengeId),
    });
    expect(done.status).toBe(200);
  });

  it('will not let another account finish a change it did not start', async () => {
    const me = await signedIn();
    const other = await signedIn('+2348099900011');
    const started = await start(me.token);
    const response = await confirmCurrent(other.token, started);
    expect(response.status).toBe(422);
    expect(await phones(other.userId)).toEqual([
      { phone_e164: '+2348099900011', is_primary: true, verified: true },
    ]);
  });

  it('refuses a number another account has already proven, and changes nothing', async () => {
    const me = await signedIn();
    await signedIn(NEW);
    const started = await start(me.token);
    const sent = bodyOf<Sent>(await confirmCurrent(me.token, started));
    const response = await as(me.token).post('/me/phone/change/confirm-new', {
      changeId: started.changeId,
      challengeId: sent.challengeId,
      code: await codeFor('identity.phone_change.code_requested', sent.challengeId),
    });
    expect(response.status).toBe(409);
    expect(bodyOf<Problem>(response).code).toBe('CONFLICT');
    expect((await phones(me.userId)).find((p) => p.phone_e164 === OLD)).toMatchObject({
      is_primary: true,
      verified: true,
    });
  });

  it('refuses the same number, and a number that is not one', async () => {
    const me = await signedIn();
    const same = await startRaw(me.token, '0803 221 4471');
    expect(same.status).toBe(422);
    const junk = await startRaw(me.token, '12345');
    expect(junk.status).toBe(422);
    expect(await phones(me.userId)).toHaveLength(1);
  });

  it('has nothing to change on an account with no verified phone', async () => {
    const me = await signedIn(null);
    const response = await startRaw(me.token);
    expect(response.status).toBe(409);
  });

  it('keeps one pending number: starting again replaces the first attempt', async () => {
    const me = await signedIn();
    await start(me.token, NEW);
    await start(me.token, '+2349051182291');
    expect(await phones(me.userId)).toEqual([
      { phone_e164: OLD, is_primary: true, verified: true },
      { phone_e164: '+2349051182291', is_primary: false, verified: false },
    ]);
  });

  it('will not take a step-up proof for a code, and does not burn the proof by being offered it', async () => {
    const me = await signedIn();
    const started = await start(me.token);
    const token = await proof(me.token);
    const [challengeId, secret] = token.split('.');
    const body = { changeId: started.changeId, challengeId, code: secret };
    for (const path of ['/me/phone/change/confirm-current', '/me/phone/change/confirm-new']) {
      const response = await as(me.token).post(path, body);
      expect(response.status).toBe(422);
      expect(bodyOf<Problem>(response).code).toBe('OTP_INVALID');
    }
    // Unchanged, and the proof still works for what it was for.
    expect(await phones(me.userId)).toEqual([
      { phone_e164: OLD, is_primary: true, verified: true },
      { phone_e164: NEW, is_primary: false, verified: false },
    ]);
    expect((await as(me.token).post('/me/phone/change', { newPhone: NEW, stepUpToken: token })).status).toBe(
      200,
    );
  });

  it('keeps the notice for the old number pointed at the old number, whatever a session starts next', async () => {
    const me = await signedIn();
    const started = await start(me.token);
    const sent = bodyOf<Sent>(await confirmCurrent(me.token, started));
    await as(me.token).post('/me/phone/change/confirm-new', {
      changeId: started.changeId,
      challengeId: sent.challengeId,
      code: await codeFor('identity.phone_change.code_requested', sent.challengeId),
    });
    // The moment after the swap commits, before Notify has read anything, the same session starts another change toward a
    // number of its own. That used to re-address the "your number was changed" notice to it.
    await start(me.token, '+2349051182291');
    const { rows } = await t
      .owner()
      .query<{ phone_e164: string; change_state: string }>(
        `SELECT phone_e164, change_state FROM identity.user_phones WHERE user_id = $1 AND change_state <> 'NONE' ORDER BY change_state`,
        [me.userId],
      );
    expect(rows).toEqual([
      { phone_e164: '+2349051182291', change_state: 'PENDING' },
      { phone_e164: OLD, change_state: 'RETIRED' },
    ]);
    const { resolveDestination } =
      await import('../../../../src/modules/notify/services/recipients.service.js');
    expect((await resolveDestination(t.db(), me.userId, 'SMS', { phoneTarget: 'RETIRED' }))?.address).toEqual(
      [OLD],
    );
    expect((await resolveDestination(t.db(), me.userId, 'SMS', { phoneTarget: 'PENDING' }))?.address).toEqual(
      ['+2349051182291'],
    );
  });

  it('caps the codes sent to one number: the third start inside ten minutes is the last that sends', async () => {
    const me = await signedIn();
    const delivered: boolean[] = [];
    for (let i = 0; i < 4; i += 1) delivered.push((await start(me.token)).delivered);
    expect(delivered).toEqual([true, true, true, false]);
  });

  it('caps the codes sent to one stranger’s number across accounts, so it cannot be used to spam a handset', async () => {
    const victim = '+2349051182299';
    const results: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      const me = await signedIn(`+23480322144${String(70 + i)}`);
      const started = await start(me.token, victim);
      const second = await confirmCurrent(me.token, started);
      expect(second.status).toBe(200);
      results.push(bodyOf<{ delivered: boolean }>(second).delivered);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it('writes the failures to the audit log: wrong codes and a change that is not theirs', async () => {
    const me = await signedIn();
    const other = await signedIn('+2348099900011');
    const started = await start(me.token);
    await confirmCurrent(me.token, started, '000000');
    await confirmCurrent(other.token, started);
    const { rows } = await t
      .owner()
      .query<{ subject_user_id: string; metadata: { reason: string; step: string } }>(
        `SELECT subject_user_id, metadata FROM identity.identity_audit_log WHERE action = 'PHONE_CHANGE_FAILED' ORDER BY occurred_at`,
      );
    expect(rows.map((r) => [r.subject_user_id, r.metadata.reason, r.metadata.step])).toEqual([
      [me.userId, 'WRONG_CODE', 'CURRENT'],
      [other.userId, 'UNKNOWN_CHANGE', 'CURRENT'],
    ]);
    expect(JSON.stringify(rows)).not.toContain('+234');
  });

  it('spends the code on a number somebody else proved, so the loser cannot replay it', async () => {
    const me = await signedIn();
    await signedIn(NEW);
    const started = await start(me.token);
    const sent = bodyOf<Sent>(await confirmCurrent(me.token, started));
    const code = await codeFor('identity.phone_change.code_requested', sent.challengeId);
    const body = { changeId: started.changeId, challengeId: sent.challengeId, code };
    expect((await as(me.token).post('/me/phone/change/confirm-new', body)).status).toBe(409);
    expect((await as(me.token).post('/me/phone/change/confirm-new', body)).status).toBe(422);
    const { rows } = await t
      .owner()
      .query(`SELECT 1 FROM identity.identity_audit_log WHERE action = 'PHONE_CHANGE_FAILED'`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
