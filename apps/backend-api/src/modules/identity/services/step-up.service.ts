// §S7's step-up: proving, a second time and recently, that the holder of a session is the account's
// owner, before an action that would let somebody else keep it.
//
// Why a token and not a claim on the session. `sessions.amr` records how the session was OPENED and
// is true for its whole 30 days, so "this session used MFA" says nothing about whether the person
// at the keyboard right now did. T-031's `Principal` carries no recency and adding one would mean a
// column on `sessions` and a migration. A single-use token with a five-minute life answers the
// actual question — "prove it NOW" — and is an `otp_challenges` row, which is what that table has
// meant since T-032: a short-lived single-use secret with a bounded number of attempts.
//
// Why 403 and not 401. The access token is perfectly valid; nothing about the credential needs
// refreshing. T-031's api-client answers a 401 with a refresh and then, if that fails, a sign-out —
// so a 401 here would end a legitimate session in the middle of the action the user asked for. The
// refusal is conditional, and RFC 9457 extension members are where the condition goes.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { ApiError } from '../../../platform/errors.js';
import { randomToken } from '../../../platform/crypto/random.js';
import type { Tx } from '../../../platform/events/publish.js';
import { MFA_TOKEN_BYTES, STEP_UP_TTL_SECONDS, mfaSubjectHash } from '../domain/mfa/policy.js';
import { hashCode, matchesCode, splitProofToken } from '../domain/otp/challenge.js';
import { otpChallenges } from '../infrastructure/postgres/schema/sessions.js';
import type { MfaDeps } from './mfa.service.js';

/** The purpose that makes a step-up row unusable as anything else, and vice versa. */
const PURPOSE = 'SENSITIVE_ACTION' as const;

export interface StepUpToken {
  token: string;
  expiresAt: Date;
}

/**
 * Mints the proof a §S7 action will ask for.
 *
 * The same shape as `issueProofToken`: `<challengeId>.<secret>`, 256 bits, one attempt. One attempt
 * because the secret is not guessed, so a second try buys the holder nothing and buys an attacker
 * who captured a malformed token a retry.
 */
export async function issueStepUpToken(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; action: string; ip?: string | null },
): Promise<StepUpToken> {
  const secret = randomToken(MFA_TOKEN_BYTES);
  const challengeId = uuidv7();
  const destinationHash = mfaSubjectHash(deps.otpHasher, input.userId);
  const expiresAt = new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000);

  // Any step-up proof this user already holds is superseded. A §S7 action spends one token, and a
  // user who proves themselves twice should not be left holding two live keys to the same door.
  await tx
    .update(otpChallenges)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(otpChallenges.userId, input.userId),
        eq(otpChallenges.purpose, PURPOSE),
        eq(otpChallenges.destinationHash, destinationHash),
        isNull(otpChallenges.consumedAt),
      ),
    );

  await tx.insert(otpChallenges).values({
    id: challengeId,
    userId: input.userId,
    purpose: PURPOSE,
    // The column is NOT NULL and this challenge has no channel: nothing was sent, the holder
    // already proved a factor. EMAIL is the inert choice; `issueOtp` is what sends things.
    channel: 'EMAIL',
    destinationHash,
    codeHash: hashCode(deps.otpHasher, { purpose: PURPOSE, destinationHash, code: secret }),
    maxAttempts: 1,
    expiresAt,
    createdIp: input.ip ?? null,
  });

  return { token: `${challengeId}.${secret}`, expiresAt };
}

/**
 * Spends a step-up token, or refuses without spending anything.
 *
 * The ownership and purpose predicates are in the WHERE clause, not checked after the row comes
 * back. That is the difference between refusing a copied token and BURNING somebody else's: a
 * `consumeOtp`-style read that fetched the row first would charge the attempt — and this row has
 * exactly one — before noticing the holder is not its owner, so anyone who saw a token could
 * destroy it.
 */
export async function consumeStepUpToken(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; token: string },
): Promise<boolean> {
  const parts = splitProofToken(input.token);
  // Malformed is indistinguishable from unknown on purpose: neither tells the holder which half of
  // their token was wrong.
  if (!parts) return false;

  const destinationHash = mfaSubjectHash(deps.otpHasher, input.userId);
  const challenge = (
    await tx
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.id, parts.challengeId),
          eq(otpChallenges.userId, input.userId),
          eq(otpChallenges.purpose, PURPOSE),
          eq(otpChallenges.destinationHash, destinationHash),
          isNull(otpChallenges.consumedAt),
        ),
      )
      .for('update')
  )[0];
  if (!challenge) return false;
  if (challenge.expiresAt.getTime() <= Date.now()) return false;
  if (challenge.attempts >= challenge.maxAttempts) return false;

  const matched = matchesCode(
    deps.otpHasher,
    { purpose: PURPOSE, destinationHash, code: parts.secret },
    Buffer.from(challenge.codeHash),
  );

  // The attempt is charged whether or not it matched, as `consumeOtp` does: an attempt the caller
  // can abandon is an unmetered guess, even against 256 bits.
  await tx
    .update(otpChallenges)
    .set({ attempts: challenge.attempts + 1, ...(matched ? { consumedAt: sql`now()` } : {}) })
    .where(eq(otpChallenges.id, challenge.id));

  return matched;
}

/**
 * The gate a §S7 route puts in front of itself.
 *
 * `acceptedFactors` rides back as an RFC 9457 extension member so the client knows what to offer:
 * the whole point of 403 over 401 is that the body carries the remedy, and a 403 that just said no
 * would leave the app with nothing to show.
 */
export async function requireStepUp(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; token: string | undefined; acceptedFactors: string[] },
): Promise<void> {
  const ok =
    input.token !== undefined &&
    (await consumeStepUpToken(tx, deps, { userId: input.userId, token: input.token }));
  if (ok) return;

  throw new ApiError(
    403,
    'STEP_UP_REQUIRED',
    'Confirm it is you',
    'Complete a step-up challenge and send the stepUpToken with this request',
    undefined,
    { acceptedFactors: input.acceptedFactors },
  );
}
