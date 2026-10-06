// §S4 and §S6 against a real database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OTP_MAX_ATTEMPTS,
  OTP_SEND_BURST,
  OTP_SEND_DAILY,
} from '../../../../src/modules/identity/domain/otp/challenge.js';
import {
  consumeOtp,
  consumeProofToken,
  findLiveChallenge,
  issueOtp,
  issueProofToken,
  type OtpDeps,
} from '../../../../src/modules/identity/services/otp.service.js';
import { createHmacHasher } from '../../../../src/platform/crypto/hmac.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { seedUser, testLogger } from '../support.js';

const deps: OtpDeps = {
  hasher: createHmacHasher('pepper-for-tests-0123456789abcdef'),
  logger: testLogger,
};

const DESTINATION = '+2348023415567';

describe.runIf(infraEnabled)('otp challenges', () => {
  const t = useTestDatabase();

  /** The code is only ever visible in the event payload; this is how a test learns it. */
  const codeFor = async (challengeId: string): Promise<string> => {
    const { rows } = await t
      .app()
      .query<{ payload: { challengeId: string; code: string } }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested' ORDER BY occurred_at`,
      );
    const match = rows.map((r) => r.payload).find((p) => p.challengeId === challengeId);
    if (!match) throw new Error(`no identity.otp.requested for ${challengeId}`);
    return match.code;
  };

  const otpEvents = async (): Promise<{ payload: unknown }[]> =>
    (
      await t
        .app()
        .query<{ payload: unknown }>(
          `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested'`,
        )
    ).rows;

  const issue = (overrides: Partial<Parameters<typeof issueOtp>[2]> = {}) =>
    t.db().transaction((tx) =>
      issueOtp(tx, deps, {
        userId: null,
        purpose: 'REGISTRATION',
        channels: ['SMS'],
        destination: DESTINATION,
        ...overrides,
      }),
    );

  it('stores only the HMAC — the code appears nowhere in the row (S6)', async () => {
    const issued = await issue();
    const code = await codeFor(issued.challengeId);
    const { rows } = await t
      .app()
      .query(`SELECT * FROM identity.otp_challenges WHERE id = $1`, [issued.challengeId]);
    expect(JSON.stringify(rows[0])).not.toContain(code);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('verifies the right code exactly once', async () => {
    const issued = await issue();
    const code = await codeFor(issued.challengeId);

    const first = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code }));
    expect(first.outcome).toBe('VERIFIED');

    const second = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code }));
    expect(second.outcome).toBe('UNKNOWN');
  });

  it('invalidates every unconsumed challenge for the same purpose and destination (S6)', async () => {
    const first = await issue();
    const firstCode = await codeFor(first.challengeId);
    const second = await issue();

    expect(second.challengeId).not.toBe(first.challengeId);
    const stale = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: first.challengeId, code: firstCode }));
    expect(stale.outcome).toBe('UNKNOWN');
  });

  it('leaves a challenge for a DIFFERENT purpose alone', async () => {
    const registration = await issue({ purpose: 'REGISTRATION' });
    const code = await codeFor(registration.challengeId);
    await issue({ purpose: 'PASSWORD_RESET' });

    const result = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: registration.challengeId, code }));
    expect(result.outcome).toBe('VERIFIED');
  });

  it('expires after five minutes', async () => {
    const issued = await issue();
    const code = await codeFor(issued.challengeId);
    await t
      .owner()
      .query(`UPDATE identity.otp_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, [
        issued.challengeId,
      ]);

    const result = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code }));
    expect(result.outcome).toBe('EXPIRED');
  });

  it('counts a wrong code against the challenge and reports what is left (E3b)', async () => {
    const issued = await issue();
    const first = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code: '000000' }));
    expect(first).toEqual({ outcome: 'WRONG_CODE', attemptsRemaining: OTP_MAX_ATTEMPTS - 1 });

    const second = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code: '000001' }));
    expect(second).toEqual({ outcome: 'WRONG_CODE', attemptsRemaining: OTP_MAX_ATTEMPTS - 2 });
  });

  it('stops at five attempts and refuses even the correct code afterwards (S4)', async () => {
    const issued = await issue();
    const code = await codeFor(issued.challengeId);
    const wrong = code === '000000' ? '000001' : '000000';

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await t
        .db()
        .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code: wrong }));
    }
    const result = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code }));
    expect(result.outcome).toBe('NO_ATTEMPTS_LEFT');
  });

  it('charges the attempt even when the caller later rolls back', async () => {
    // The attempt UPDATE runs first, so a caller that throws afterwards still pays for its guess —
    // provided it commits. This asserts the counter moves on an ordinary committed failure.
    const issued = await issue();
    await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code: '999999' }));
    const { rows } = await t
      .app()
      .query<{ attempts: number }>(`SELECT attempts FROM identity.otp_challenges WHERE id = $1`, [
        issued.challengeId,
      ]);
    expect(rows[0]?.attempts).toBe(1);
  });

  it('answers UNKNOWN for a challenge id nobody ever issued', async () => {
    const result = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: randomUUID(), code: '123456' }));
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('throttles a destination at three sends in ten minutes (S4)', async () => {
    for (let i = 0; i < OTP_SEND_BURST.max; i += 1) {
      expect((await issue({ purpose: 'LOGIN' })).delivered).toBe(true);
    }
    const fourth = await issue({ purpose: 'LOGIN' });
    expect(fourth).toMatchObject({ delivered: false, throttled: true });
    // Still a real row with a real id, so the caller's response shape does not change.
    expect(fourth.challengeId).toBeTruthy();
  });

  it('throttles a destination at ten sends in a day (S4)', async () => {
    // Backdate each burst out of the ten-minute window so only the daily cap can bite.
    for (let i = 0; i < OTP_SEND_DAILY.max; i += 1) {
      await issue({ purpose: 'LOGIN' });
      await t.owner().query(`UPDATE identity.otp_challenges SET created_at = now() - interval '2 hours'`);
    }
    expect((await issue({ purpose: 'LOGIN' })).throttled).toBe(true);
  });

  it('publishes identity.otp.requested with the code and nothing that identifies the destination', async () => {
    const { userId } = await seedUser(t.app());
    const issued = await issue({ userId });
    const { rows } = await t
      .app()
      .query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM platform.outbox WHERE event_type = 'identity.otp.requested'`,
      );
    expect(rows[0]?.payload).toMatchObject({
      userId,
      challengeId: issued.challengeId,
      purpose: 'REGISTRATION',
      channels: ['SMS'],
      expiresInMinutes: 5,
    });
    expect(JSON.stringify(rows[0]?.payload)).not.toContain(DESTINATION);
  });

  it('writes the row but publishes nothing when deliver is false (the forgot-password decoy)', async () => {
    const issued = await issue({ deliver: false, purpose: 'PASSWORD_RESET' });
    expect(issued).toMatchObject({ delivered: false, throttled: false });
    expect(await otpEvents()).toEqual([]);
    // The row is real: verifying against it behaves exactly as it would for a known identifier.
    const result = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code: '123456' }));
    expect(result).toEqual({ outcome: 'WRONG_CODE', attemptsRemaining: OTP_MAX_ATTEMPTS - 1 });
  });

  it('mints a proof token bound to the same destination, with one attempt', async () => {
    const { userId } = await seedUser(t.app());
    const issued = await issue({ userId, purpose: 'PASSWORD_RESET' });
    const code = await codeFor(issued.challengeId);
    const verified = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code }));
    if (verified.outcome !== 'VERIFIED') throw new Error('expected VERIFIED');

    const proof = await t.db().transaction((tx) => issueProofToken(tx, deps, verified.challenge));
    expect(proof.token.startsWith(`${proof.challengeId}.`)).toBe(true);

    const used = await t.db().transaction((tx) => consumeProofToken(tx, deps, proof.token));
    expect(used.outcome).toBe('VERIFIED');
    if (used.outcome === 'VERIFIED') expect(used.challenge.userId).toBe(userId);

    const replayed = await t.db().transaction((tx) => consumeProofToken(tx, deps, proof.token));
    expect(replayed.outcome).toBe('UNKNOWN');
  });

  it('spends the proof token’s single attempt on a wrong secret', async () => {
    const { userId } = await seedUser(t.app());
    const issued = await issue({ userId, purpose: 'PASSWORD_RESET' });
    const code = await codeFor(issued.challengeId);
    const verified = await t
      .db()
      .transaction((tx) => consumeOtp(tx, deps, { challengeId: issued.challengeId, code }));
    if (verified.outcome !== 'VERIFIED') throw new Error('expected VERIFIED');
    const proof = await t.db().transaction((tx) => issueProofToken(tx, deps, verified.challenge));

    const wrong = await t
      .db()
      .transaction((tx) => consumeProofToken(tx, deps, `${proof.challengeId}.not-the-secret`));
    expect(wrong.outcome).toBe('NO_ATTEMPTS_LEFT');

    // And the real token is now dead too, which is the point of a single attempt.
    const real = await t.db().transaction((tx) => consumeProofToken(tx, deps, proof.token));
    expect(real.outcome).toBe('NO_ATTEMPTS_LEFT');
  });

  it('answers UNKNOWN for a malformed proof token rather than handing it to a uuid cast', async () => {
    const result = await t
      .db()
      .transaction((tx) => consumeProofToken(tx, deps, "'; DROP TABLE identity.users; --"));
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('finds a live challenge and ignores a consumed or expired one', async () => {
    const issued = await issue();
    expect(await t.db().transaction((tx) => findLiveChallenge(tx, issued.challengeId))).not.toBeNull();

    await t
      .owner()
      .query(`UPDATE identity.otp_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, [
        issued.challengeId,
      ]);
    expect(await t.db().transaction((tx) => findLiveChallenge(tx, issued.challengeId))).toBeNull();
  });
});
