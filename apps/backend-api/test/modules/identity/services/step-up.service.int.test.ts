// §S7's step-up proof, against a real database. Skipped unless KOMTRU_INFRA_TESTS=1.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  consumeStepUpToken,
  issueStepUpToken,
  requireStepUp,
} from '../../../../src/modules/identity/services/step-up.service.js';
import { issueOtp, issueProofToken } from '../../../../src/modules/identity/services/otp.service.js';
import { ApiError } from '../../../../src/platform/errors.js';
import { STEP_UP_TTL_SECONDS } from '../../../../src/modules/identity/domain/mfa/policy.js';
import { otpChallenges } from '../../../../src/modules/identity/infrastructure/postgres/schema/sessions.js';
import { infraEnabled } from '../../../support/db-urls.js';
import { useTestDatabase } from '../../../support/db.js';
import { mfaDeps, seedUser } from '../support.js';

describe.runIf(infraEnabled)('step-up tokens (§S7)', () => {
  const t = useTestDatabase();
  const deps = mfaDeps();

  const issue = async (userId: string) =>
    t.db().transaction((tx) => issueStepUpToken(tx, deps, { userId, action: 'mfa.remove' }));

  it('writes a single-use SENSITIVE_ACTION row with a five-minute life', async () => {
    const { userId } = await seedUser(t.app());
    const { token, expiresAt } = await issue(userId);

    const { rows } = await t
      .app()
      .query(`SELECT purpose, max_attempts, attempts, consumed_at, user_id FROM identity.otp_challenges`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: 'SENSITIVE_ACTION',
      max_attempts: 1,
      attempts: 0,
      consumed_at: null,
      user_id: userId,
    });
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(STEP_UP_TTL_SECONDS * 1000);
    expect(token.split('.')).toHaveLength(2);
  });

  it('spends once and never again', async () => {
    const { userId } = await seedUser(t.app());
    const { token } = await issue(userId);

    expect(await t.db().transaction((tx) => consumeStepUpToken(tx, deps, { userId, token }))).toBe(true);
    expect(await t.db().transaction((tx) => consumeStepUpToken(tx, deps, { userId, token }))).toBe(false);
  });

  /**
   * The predicate is in the WHERE clause, not checked after the row comes back — which is the
   * difference between refusing a copied token and BURNING somebody else's. This row has exactly
   * one attempt, so a read-then-check would let anyone who saw a token destroy it.
   */
  it('refuses another user’s token without spending it', async () => {
    const owner = await seedUser(t.app());
    const stranger = await seedUser(t.app());
    const { token } = await issue(owner.userId);

    expect(
      await t.db().transaction((tx) => consumeStepUpToken(tx, deps, { userId: stranger.userId, token })),
    ).toBe(false);

    // Still the owner's to spend.
    expect(
      await t.db().transaction((tx) => consumeStepUpToken(tx, deps, { userId: owner.userId, token })),
    ).toBe(true);
  });

  /** A proof token minted for a password reset is not a step-up proof, and the reverse. */
  it('refuses a PASSWORD_RESET proof token and leaves it spendable', async () => {
    const { userId } = await seedUser(t.app());
    const otpDeps = { hasher: deps.otpHasher, logger: deps.logger };

    const reset = await t.db().transaction(async (tx) => {
      const issued = await issueOtp(tx, otpDeps, {
        userId,
        purpose: 'PASSWORD_RESET',
        channels: ['EMAIL'],
        destination: 'jane@example.com',
      });
      const row = (await tx.select().from(otpChallenges).where(eq(otpChallenges.id, issued.challengeId)))[0];
      if (!row) throw new Error('no reset challenge');
      return issueProofToken(tx, otpDeps, row);
    });

    expect(
      await t.db().transaction((tx) => consumeStepUpToken(tx, deps, { userId, token: reset.token })),
    ).toBe(false);

    const { rows } = await t
      .app()
      .query(`SELECT attempts, consumed_at FROM identity.otp_challenges WHERE id = $1`, [reset.challengeId]);
    expect(rows[0]).toMatchObject({ attempts: 0, consumed_at: null });
  });

  it('refuses an expired token', async () => {
    const { userId } = await seedUser(t.app());
    const { token } = await issue(userId);
    await t.owner().query(`UPDATE identity.otp_challenges SET expires_at = now() - interval '1 second'`);

    expect(await t.db().transaction((tx) => consumeStepUpToken(tx, deps, { userId, token }))).toBe(false);
  });

  it('refuses a malformed token the same way as an unknown one', async () => {
    const { userId } = await seedUser(t.app());
    for (const token of ['', 'nope', 'not-a-uuid.secret', `${randomUUID()}.`]) {
      expect(await t.db().transaction((tx) => consumeStepUpToken(tx, deps, { userId, token }))).toBe(false);
    }
  });

  it('supersedes a proof the user already held, so one person never holds two keys', async () => {
    const { userId } = await seedUser(t.app());
    const first = await issue(userId);
    await issue(userId);

    expect(
      await t.db().transaction((tx) => consumeStepUpToken(tx, deps, { userId, token: first.token })),
    ).toBe(false);
  });
});

describe.runIf(infraEnabled)('requireStepUp', () => {
  const t = useTestDatabase();
  const deps = mfaDeps();

  const expectStepUp = async (token: string | undefined) => {
    const { userId } = await seedUser(t.app());
    try {
      await t
        .db()
        .transaction((tx) =>
          requireStepUp(tx, deps, { userId, token, acceptedFactors: ['TOTP', 'PASSKEY'] }),
        );
    } catch (error) {
      return error as ApiError;
    }
    throw new Error('expected requireStepUp to throw');
  };

  /**
   * 403 and not 401. The access token is fine; nothing needs refreshing. The api-client answers a
   * 401 with a refresh and then a sign-out, which would end a legitimate session mid-action.
   */
  it('throws a 403 STEP_UP_REQUIRED naming the factors the client may offer', async () => {
    const error = await expectStepUp(undefined);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('STEP_UP_REQUIRED');
    expect(error.extensions).toEqual({ acceptedFactors: ['TOTP', 'PASSKEY'] });
  });

  it('throws the same 403 for a token that does not verify', async () => {
    expect((await expectStepUp(`${randomUUID()}.wrong`)).code).toBe('STEP_UP_REQUIRED');
  });

  it('returns quietly for a token the caller legitimately holds', async () => {
    const { userId } = await seedUser(t.app());
    const { token } = await t
      .db()
      .transaction((tx) => issueStepUpToken(tx, deps, { userId, action: 'mfa.remove' }));

    await expect(
      t.db().transaction((tx) => requireStepUp(tx, deps, { userId, token, acceptedFactors: [] })),
    ).resolves.toBeUndefined();
  });
});
