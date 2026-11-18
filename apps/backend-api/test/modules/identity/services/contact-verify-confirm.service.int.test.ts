// F-081, the second step: spending the code.
//
// Two things here are not obvious and are the reason this file exists. A challenge is bound to BOTH
// the caller and the channel, so another account's code — or this account's email code offered as a
// phone code — proves nothing. And when two accounts each hold the same address unproven, the one
// that confirms second must be told cleanly, not handed a 500 by the partial unique index.
//
// Skipped unless KOMTRU_INFRA_TESTS=1.
import { describe, expect, it } from 'vitest';
import {
  confirmContactVerification,
  startContactVerification,
} from '../../../../src/modules/identity/services/contact-verify.service.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser, testLogger } from '../support.js';

const hasher = createHmacHasher('pepper'.padEnd(32, 'x'));

describe.runIf(infraEnabled)('confirmContactVerification (F-081)', () => {
  const t = useTestDatabase();

  const deps = () => ({ db: t.db(), logger: testLogger, otpHasher: hasher });

  const start = async (userId: string, channel: 'EMAIL' | 'PHONE', address?: string) => {
    const started = await startContactVerification(deps(), {
      userId,
      channel,
      ...(address === undefined ? {} : { address }),
      ip: null,
      userAgent: null,
    });
    if (started.outcome !== 'STARTED') throw new Error(`start was ${started.outcome}`);
    return started;
  };

  const confirm = (userId: string, channel: 'EMAIL' | 'PHONE', challengeId: string, code: string) =>
    confirmContactVerification(deps(), { userId, channel, challengeId, code });

  /** Codes live only in the outbox; this is how a test learns one. */
  const codeFor = async (challengeId: string): Promise<string> => {
    const { rows } = await t
      .owner()
      .query<{ payload: { challengeId: string; code: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested' ORDER BY occurred_at`,
      );
    const match = rows.map((r) => r.payload).find((p) => p.challengeId === challengeId);
    if (!match) throw new Error(`no otp event for ${challengeId}`);
    return match.code;
  };

  const addVerifiedPhone = (userId: string, phone: string) =>
    t.owner().query(
      `INSERT INTO identity.user_phones (user_id, phone_e164, country_code, is_primary, verified_at)
       VALUES ($1, $2, 'NG', true, now())`,
      [userId, phone],
    );

  const prove = async (userId: string, channel: 'EMAIL' | 'PHONE', address: string) => {
    const started = await start(userId, channel, address);
    return confirm(userId, channel, started.challengeId, await codeFor(started.challengeId));
  };

  it('marks the address verified and reports the new level', async () => {
    const { userId } = await seedUser(t.app());
    await addVerifiedPhone(userId, '+2348100000020');

    const result = await prove(userId, 'EMAIL', 'both@example.test');

    expect(result).toMatchObject({ outcome: 'VERIFIED', verificationLevel: 'CONTACT_VERIFIED' });
  });

  it('leaves the level alone when only one channel is proven', async () => {
    const { userId } = await seedUser(t.app());

    const result = await prove(userId, 'EMAIL', 'only@example.test');

    expect(result).toMatchObject({ outcome: 'VERIFIED', verificationLevel: 'UNVERIFIED' });
  });

  it('answers UNKNOWN for a challenge belonging to another account', async () => {
    const { userId: owner } = await seedUser(t.app());
    const started = await start(owner, 'EMAIL', 'owner@example.test');
    const code = await codeFor(started.challengeId);
    const { userId: stranger } = await seedUser(t.app());

    expect(await confirm(stranger, 'EMAIL', started.challengeId, code)).toEqual({
      outcome: 'UNKNOWN',
    });
  });

  it('answers UNKNOWN for a challenge issued for the other channel', async () => {
    const { userId } = await seedUser(t.app());
    const started = await start(userId, 'EMAIL', 'crosschannel@example.test');
    const code = await codeFor(started.challengeId);

    expect(await confirm(userId, 'PHONE', started.challengeId, code)).toEqual({
      outcome: 'UNKNOWN',
    });
  });

  it('answers TAKEN when somebody else proved the address first', async () => {
    const shared = 'contested@example.test';
    const { userId: loser } = await seedUser(t.app());
    const started = await start(loser, 'EMAIL', shared);
    const code = await codeFor(started.challengeId);

    // The winner proves it between the loser's start and the loser's confirm.
    const { userId: winner } = await seedUser(t.app());
    expect(await prove(winner, 'EMAIL', shared)).toMatchObject({ outcome: 'VERIFIED' });

    expect(await confirm(loser, 'EMAIL', started.challengeId, code)).toEqual({ outcome: 'TAKEN' });
  });

  it('charges an attempt on a wrong code', async () => {
    const { userId } = await seedUser(t.app());
    const started = await start(userId, 'EMAIL', 'wrongcode@example.test');

    const result = await confirm(userId, 'EMAIL', started.challengeId, '000000');

    expect(result).toMatchObject({ outcome: 'WRONG_CODE' });
    const { rows } = await t
      .owner()
      .query<{ attempts: number }>(`SELECT attempts FROM identity.otp_challenges WHERE id = $1`, [
        started.challengeId,
      ]);
    expect(rows[0]?.attempts).toBe(1);
  });

  it('makes a proven phone the primary number', async () => {
    const { userId } = await seedUser(t.app());

    await prove(userId, 'PHONE', '+2348100000021');

    const { rows } = await t.owner().query<{ is_primary: boolean; verified: boolean }>(
      `SELECT is_primary, verified_at IS NOT NULL AS verified
           FROM identity.user_phones WHERE user_id = $1`,
      [userId],
    );
    expect(rows[0]).toMatchObject({ is_primary: true, verified: true });
  });
});
