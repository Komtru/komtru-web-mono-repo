// F-081 regression: a code proves the address it was SENT to, and nothing else.
//
// The hole this closes. `start` replaces an unproven row, and `issueOtp` only supersedes challenges
// with the SAME destination hash — so starting twice with two addresses leaves the FIRST code live
// while the row now holds the SECOND address. Without binding the confirm to the destination, a
// caller could spend the code delivered to an address they control and have it mark an address they
// do not: a stranger's email or phone, verified on the attacker's account, and (because
// `user_emails_verified_unique` is global) permanently unusable by its real owner.
//
// The same shape has been fixed three times in this codebase already — `mfa.service.ts`,
// `staff-invitation.service.ts` and `phone-change.service.ts` all compare the destination before
// trusting a code.
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

describe.runIf(infraEnabled)('a verification code is bound to its destination (F-081)', () => {
  const t = useTestDatabase();

  const deps = () => ({ db: t.db(), logger: testLogger, otpHasher: hasher });

  const start = async (userId: string, channel: 'EMAIL' | 'PHONE', address: string) => {
    const started = await startContactVerification(deps(), {
      userId,
      channel,
      address,
      ip: null,
      userAgent: null,
    });
    if (started.outcome !== 'STARTED') throw new Error(`start was ${started.outcome}`);
    return started;
  };

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

  const emailsOf = async (userId: string) =>
    (
      await t.owner().query<{ email_normal: string; verified: boolean }>(
        `SELECT email_normal, verified_at IS NOT NULL AS verified
           FROM identity.user_emails WHERE user_id = $1`,
        [userId],
      )
    ).rows;

  it('refuses a code that was sent to a DIFFERENT email than the one now on the account', async () => {
    const { userId } = await seedUser(t.app());

    // 1. A code to an address the caller controls.
    const mine = await start(userId, 'EMAIL', 'attacker@example.test');
    const myCode = await codeFor(mine.challengeId);

    // 2. Point the account at somebody else's address. The first code is NOT superseded: a
    //    different destination means a different hash.
    await start(userId, 'EMAIL', 'victim@example.test');

    // 3. Spend the first code. It proves 'attacker@example.test' and must prove nothing else.
    const result = await confirmContactVerification(deps(), {
      userId,
      channel: 'EMAIL',
      challengeId: mine.challengeId,
      code: myCode,
    });

    expect(result).toEqual({ outcome: 'UNKNOWN' });
    expect(await emailsOf(userId)).toEqual([
      expect.objectContaining({ email_normal: 'victim@example.test', verified: false }),
    ]);
  });

  it('refuses a code that was sent to a DIFFERENT phone than the one now on the account', async () => {
    const { userId } = await seedUser(t.app());
    const mine = await start(userId, 'PHONE', '+2348100000901');
    const myCode = await codeFor(mine.challengeId);
    await start(userId, 'PHONE', '+2348100000902');

    const result = await confirmContactVerification(deps(), {
      userId,
      channel: 'PHONE',
      challengeId: mine.challengeId,
      code: myCode,
    });

    expect(result).toEqual({ outcome: 'UNKNOWN' });
    const { rows } = await t.owner().query<{ verified: boolean; is_primary: boolean }>(
      `SELECT verified_at IS NOT NULL AS verified, is_primary
           FROM identity.user_phones WHERE user_id = $1`,
      [userId],
    );
    expect(rows).toEqual([expect.objectContaining({ verified: false, is_primary: false })]);
  });

  it('leaves an audit trail: the send, the refusal and the proof', async () => {
    const { userId } = await seedUser(t.app());
    const mine = await start(userId, 'EMAIL', 'audited@example.test');

    await confirmContactVerification(deps(), {
      userId,
      channel: 'EMAIL',
      challengeId: mine.challengeId,
      code: '000000',
      ip: null,
      userAgent: 'probe/1.0',
    });
    await confirmContactVerification(deps(), {
      userId,
      channel: 'EMAIL',
      challengeId: mine.challengeId,
      code: await codeFor(mine.challengeId),
      ip: null,
      userAgent: 'probe/1.0',
    });

    const { rows } = await t
      .owner()
      .query<{ action: string }>(
        `SELECT action FROM identity.identity_audit_log WHERE actor_user_id = $1 ORDER BY occurred_at`,
        [userId],
      );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('OTP_ISSUED');
    expect(actions).toContain('OTP_FAILED');
    expect(actions).toContain('EMAIL_VERIFIED');
  });

  it('still accepts the code for the address actually on the account', async () => {
    const { userId } = await seedUser(t.app());
    await start(userId, 'EMAIL', 'first@example.test');
    const second = await start(userId, 'EMAIL', 'second@example.test');

    const result = await confirmContactVerification(deps(), {
      userId,
      channel: 'EMAIL',
      challengeId: second.challengeId,
      code: await codeFor(second.challengeId),
    });

    expect(result).toMatchObject({ outcome: 'VERIFIED' });
  });
});
