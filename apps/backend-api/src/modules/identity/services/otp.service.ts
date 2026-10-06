// `identity.otp_challenges`, which this build uses for two things that look different and are not.
//
// A six-digit OTP and a password-reset token are both "a short-lived single-use secret, bound to a
// destination, with a bounded number of attempts". That is this table. The reset token is the same
// row with 256 bits instead of twenty and `max_attempts = 1`, which is why §10.1's `resetToken`
// needs no second table, no Redis key and no migration — and why it inherits the expiry, the single
// use and the attempt cap that are already tested here.
//
// Everything takes the caller's `Tx`. A registration writes a user, a contact, an audit row and a
// challenge, and either all of them happen or none do.
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../../platform/events/publish.js';
import { publish } from '../../../platform/events/publish.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import type { Logger } from '../../../platform/logger.js';
import { randomNumericCode, randomToken } from '../../../platform/crypto/random.js';
import {
  OTP_CODE_DIGITS,
  OTP_MAX_ATTEMPTS,
  OTP_SEND_BURST,
  OTP_SEND_DAILY,
  OTP_TTL_SECONDS,
  PROOF_TOKEN_BYTES,
  hashCode,
  hashDestination,
  matchesCode,
  otpExpiry,
  proofTokenExpiry,
  splitProofToken,
  type OtpPurpose,
} from '../domain/otp/challenge.js';
import { identityOtpRequestedEvent } from '../domain/events.js';
import { otpChallenges } from '../infrastructure/postgres/schema/sessions.js';

export interface OtpDeps {
  hasher: HmacHasher;
  logger: Logger;
}

export type OtpRow = typeof otpChallenges.$inferSelect;

export type OtpChannel = 'SMS' | 'EMAIL';

export interface IssueOtpInput {
  /** Null for a challenge that resolves to nobody — see `deliver` and `/auth/password/forgot`. */
  userId: string | null;
  purpose: OtpPurpose;
  /** Where the code goes. More than one only when a phone OTP is mirrored to email in development. */
  channels: OtpChannel[];
  /** Already canonical: `normaliseEmail().emailNormal` or `normalisePhone().phoneE164`. */
  destination: string;
  ip?: string | null;
  /**
   * False writes the row and publishes nothing.
   *
   * `/auth/password/forgot` must answer identically for an identifier that matches an account and
   * one that matches nobody, and "identically" has to include the row it leaves behind: a response
   * carrying a challenge id that verifies against nothing is distinguishable the moment the caller
   * tries it. So the miss writes a real challenge with a real code and `user_id` NULL, and simply
   * never delivers it. Defaults to true.
   */
  deliver?: boolean;
}

export interface IssuedOtp {
  challengeId: string;
  expiresAt: Date;
  /** False when `deliver` was false, or when §S4's per-destination budget is spent. */
  delivered: boolean;
  /** True when the budget is what stopped it. The caller decides whether the user may be told. */
  throttled: boolean;
}

const WINDOWS = [OTP_SEND_BURST, OTP_SEND_DAILY];

/**
 * How many challenges this destination has had in each §S4 window.
 *
 * Counted against the rows rather than against a Redis budget on the route because the limit M1
 * names is per DESTINATION, and a destination is not something a route key can see: a username
 * identifier, a resend keyed on a challenge id and a fresh registration all resolve to the same
 * phone number, and only this table knows that.
 */
async function sendBudgetSpent(tx: Tx, destinationHash: Buffer, now: Date): Promise<boolean> {
  for (const window of WINDOWS) {
    const since = new Date(now.getTime() - window.windowSeconds * 1000);
    const rows = await tx
      .select({ count: sql<string>`count(*)` })
      .from(otpChallenges)
      .where(and(eq(otpChallenges.destinationHash, destinationHash), gte(otpChallenges.createdAt, since)));
    if (Number(rows[0]?.count ?? 0) >= window.max) return true;
  }
  return false;
}

export async function issueOtp(tx: Tx, deps: OtpDeps, input: IssueOtpInput): Promise<IssuedOtp> {
  const now = new Date();
  const destinationHash = hashDestination(deps.hasher, input.destination);

  // Before the invalidation below, never after: superseding the previous rows would hide the very
  // evidence the budget is counted from, and a caller could then resend without limit.
  const throttled = await sendBudgetSpent(tx, destinationHash, now);
  const deliver = (input.deliver ?? true) && !throttled;

  // §S6's "invalidated on new issuance for the same purpose+destination". Without it the old code
  // keeps working for its remaining five minutes, which is five minutes of two live codes on one
  // channel — and the user, who is looking at the newest SMS, cannot tell which is which.
  await tx
    .update(otpChallenges)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(otpChallenges.destinationHash, destinationHash),
        eq(otpChallenges.purpose, input.purpose),
        isNull(otpChallenges.consumedAt),
      ),
    );

  const code = randomNumericCode(OTP_CODE_DIGITS);
  const expiresAt = otpExpiry(now);
  const row = (
    await tx
      .insert(otpChallenges)
      .values({
        userId: input.userId,
        purpose: input.purpose,
        // One row, one `channel` column, but a mirrored code goes out on two. The column records
        // the channel the challenge is FOR; the event carries where it was actually sent.
        channel: input.channels[0] ?? 'SMS',
        destinationHash,
        codeHash: hashCode(deps.hasher, { purpose: input.purpose, destinationHash, code }),
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt,
        createdIp: input.ip ?? null,
      })
      .returning({ id: otpChallenges.id })
  )[0];
  if (!row) throw new Error('issueOtp: the insert returned no row');

  if (deliver) {
    await publish(tx, identityOtpRequestedEvent, {
      payload: {
        userId: input.userId,
        challengeId: row.id,
        purpose: input.purpose,
        channels: input.channels,
        code,
        expiresInMinutes: Math.round(OTP_TTL_SECONDS / 60),
      },
      aggregateType: 'identity.otp',
      aggregateId: row.id,
      ...(input.userId ? { actor: { type: 'CONSUMER' as const, id: input.userId } } : {}),
    });
  } else if (throttled) {
    // The destination is never logged, only the challenge: §S12 is absolute, and the challenge id
    // is enough to find the row an operator is asking about.
    deps.logger.warn(
      { challengeId: row.id, purpose: input.purpose },
      'identity: otp send budget spent for this destination, nothing delivered',
    );
  }

  return { challengeId: row.id, expiresAt, delivered: deliver, throttled };
}

export type VerifyOutcome =
  | { outcome: 'VERIFIED'; challenge: OtpRow }
  | { outcome: 'WRONG_CODE'; attemptsRemaining: number }
  | { outcome: 'NO_ATTEMPTS_LEFT' }
  | { outcome: 'EXPIRED' }
  /** No live challenge has this id — never issued, already used, or someone else's guess. */
  | { outcome: 'UNKNOWN' };

/**
 * Spends one attempt and, if the code matches, consumes the challenge.
 *
 * The attempt is charged BEFORE the comparison, so a caller cannot buy an unmetered guess by
 * cutting the connection. That means the caller's transaction must COMMIT on a wrong code as well
 * as on a right one: `auth.service.ts` returns the failure rather than throwing inside the
 * transaction, and the controller raises the 422 afterwards.
 */
export async function consumeOtp(
  tx: Tx,
  deps: OtpDeps,
  input: { challengeId: string; code: string },
): Promise<VerifyOutcome> {
  // `FOR UPDATE` is the whole concurrency story: two requests presenting the same challenge both
  // reach it, the second blocks, and under READ COMMITTED re-reads the row once the first commits —
  // so it sees the spent attempt, or the consumed flag, rather than racing it.
  const challenge = (
    await tx.select().from(otpChallenges).where(eq(otpChallenges.id, input.challengeId)).for('update')
  )[0];

  if (!challenge || challenge.consumedAt !== null) return { outcome: 'UNKNOWN' };
  if (challenge.expiresAt.getTime() <= Date.now()) return { outcome: 'EXPIRED' };
  if (challenge.attempts >= challenge.maxAttempts) return { outcome: 'NO_ATTEMPTS_LEFT' };

  const attempts = challenge.attempts + 1;
  const matched = matchesCode(
    deps.hasher,
    {
      purpose: challenge.purpose,
      destinationHash: Buffer.from(challenge.destinationHash),
      code: input.code,
    },
    Buffer.from(challenge.codeHash),
  );

  await tx
    .update(otpChallenges)
    .set({ attempts, ...(matched ? { consumedAt: sql`now()` } : {}) })
    .where(eq(otpChallenges.id, challenge.id));

  if (matched) return { outcome: 'VERIFIED', challenge: { ...challenge, attempts } };

  const attemptsRemaining = challenge.maxAttempts - attempts;
  return attemptsRemaining > 0
    ? { outcome: 'WRONG_CODE', attemptsRemaining }
    : { outcome: 'NO_ATTEMPTS_LEFT' };
}

export interface ProofToken {
  token: string;
  challengeId: string;
  expiresAt: Date;
}

/**
 * Exchanges a verified challenge for the single-use token §10.1 calls `resetToken`.
 *
 * It is a challenge row, with the same destination and purpose as the one it came from, a 256-bit
 * secret in place of the code, and one attempt. The id has to be known before the insert so it can
 * be half of the returned token, which is what `uuidv7` is for here.
 */
export async function issueProofToken(tx: Tx, deps: OtpDeps, from: OtpRow): Promise<ProofToken> {
  const secret = randomToken(PROOF_TOKEN_BYTES);
  const challengeId = uuidv7();
  const destinationHash = Buffer.from(from.destinationHash);
  const expiresAt = proofTokenExpiry(new Date());

  await tx.insert(otpChallenges).values({
    id: challengeId,
    userId: from.userId,
    purpose: from.purpose,
    channel: from.channel,
    destinationHash,
    codeHash: hashCode(deps.hasher, { purpose: from.purpose, destinationHash, code: secret }),
    // One. A 256-bit secret is not guessed, so a second attempt buys the holder nothing and buys an
    // attacker who captured a malformed token a retry.
    maxAttempts: 1,
    expiresAt,
    createdIp: from.createdIp,
  });

  return { token: `${challengeId}.${secret}`, challengeId, expiresAt };
}

/** The same machinery as `consumeOtp`, over a token that carries its own challenge id. */
export async function consumeProofToken(tx: Tx, deps: OtpDeps, token: string): Promise<VerifyOutcome> {
  const parts = splitProofToken(token);
  // Malformed is indistinguishable from unknown on purpose: neither tells the holder which half of
  // their token was wrong.
  if (!parts) return { outcome: 'UNKNOWN' };
  return consumeOtp(tx, deps, { challengeId: parts.challengeId, code: parts.secret });
}

/** The live challenge behind an id, for a resend. Null when there is nothing to resend. */
export async function findLiveChallenge(tx: Tx, challengeId: string): Promise<OtpRow | null> {
  const row = (
    await tx
      .select()
      .from(otpChallenges)
      .where(and(eq(otpChallenges.id, challengeId), isNull(otpChallenges.consumedAt)))
  )[0];
  return row && row.expiresAt.getTime() > Date.now() ? row : null;
}
