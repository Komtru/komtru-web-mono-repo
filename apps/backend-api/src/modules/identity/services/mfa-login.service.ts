// §10.1's `{ mfaRequired: true, mfaToken, factors }` branch, and `POST /auth/mfa/verify`.
//
// T-032 left this unbuilt and named the hazard: `LoginResult` has exactly ONE failure variant, by
// design, for the §17 enumeration property, and an MFA branch must not become a second signal that
// distinguishes a real account from a decoy.
//
// It does not, and the reason is structural rather than careful. `mfaRequired` is a SECOND SUCCESS,
// not a second failure: it is reachable only after `verifyAndRecord` returned OK and the status
// check passed, which is to say only for somebody who already holds the account's password. An
// attacker who can see this branch has already won the thing enumeration is the first step towards.
// What that costs is one rule, enforced by where the code sits rather than by anyone remembering
// it: NOTHING that depends on whether an account has a factor may run above `login`'s single
// `return { outcome: 'REJECTED' }`. `login.service.ts` says so at the line, and the §17 suite holds
// it with a statement count as well as a stopwatch — a timing test alone can be passed by an
// implementation that reads the factors early and throws the answer away.
//
// The `mfaToken` is an `otp_challenges` row: a 256-bit secret with a five-minute life and five
// attempts, which is what that table has meant since T-032 and is exactly the shape needed. Its
// `destination_hash` is the user id under `MFA_SUBJECT_DOMAIN` rather than an address, so it cannot
// collide with a real destination's send budget or supersede.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { randomToken } from '../../../platform/crypto/random.js';
import { maskPhone } from '../../../platform/identifiers.js';
import {
  MFA_MAX_ATTEMPTS,
  MFA_TOKEN_BYTES,
  MFA_TOKEN_TTL_SECONDS,
  factorAmr,
  mfaSubjectHash,
  type MfaFactorType,
} from '../domain/mfa/policy.js';
import { hashCode, matchesCode, splitProofToken } from '../domain/otp/challenge.js';
import { identityDeviceSignedInEvent } from '../domain/events.js';
import { nextStep, type NextStep } from '../domain/registration.js';
import { sessionUsableUnder } from '../domain/session/status.js';
import { otpChallenges } from '../infrastructure/postgres/schema/sessions.js';
import { userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import { onboarding, type PublicUser } from './auth.service.js';
import { deviceLabel, signInLocation, upsertDevice } from './device.service.js';
import { activeFactors, findOwnFactor, verifyFactor, type FactorRow, type MfaDeps } from './mfa.service.js';
import { createSession, type IssuedSession } from './session.service.js';

const PURPOSE = 'MFA_CHALLENGE' as const;

/** What a factor is called when the user never named one — the same copy `factorView` uses. */
const HINT: Record<MfaFactorType, string> = {
  TOTP: 'Authenticator app',
  SMS_OTP: 'Text message',
  EMAIL_OTP: 'Email code',
  PASSKEY: 'Passkey',
  RECOVERY_CODE: 'Backup codes',
};

/**
 * What §10.1 calls `{ "id", "type", "hint" }`.
 *
 * The hint is a label, never a destination — for SMS it is the masked number, which the holder of
 * the password already knows, and for everything else it is the factor's name. No secret, no seed,
 * no credential id.
 */
export interface MfaChallengeView {
  id: string;
  type: MfaFactorType;
  hint: string | null;
  isDefault: boolean;
}

export interface IssuedMfaToken {
  mfaToken: string;
  challengeId: string;
  expiresAt: Date;
  factors: MfaChallengeView[];
}

const challengeViews = async (tx: Tx, factors: FactorRow[]): Promise<MfaChallengeView[]> => {
  const views: MfaChallengeView[] = [];
  for (const factor of factors) {
    let hint = factor.label ?? HINT[factor.factorType];
    if (factor.factorType === 'SMS_OTP' && factor.phoneId) {
      const phone = (
        await tx
          .select({ phoneE164: userPhones.phoneE164 })
          .from(userPhones)
          .where(eq(userPhones.id, factor.phoneId))
      )[0];
      if (phone) hint = maskPhone(phone.phoneE164);
    }
    views.push({ id: factor.id, type: factor.factorType, hint, isDefault: factor.isDefault });
  }
  return views;
};

/**
 * Writes the challenge the password step is exchanged for.
 *
 * Written directly rather than through `issueOtp`, the way `issueProofToken` is: nothing is sent,
 * nothing is rendered, and routing it through the send path would charge the user's SMS budget for
 * opening an authenticator app.
 */
export async function issueMfaToken(
  tx: Tx,
  deps: MfaDeps,
  input: { userId: string; factors: FactorRow[]; ip?: string | null },
): Promise<IssuedMfaToken> {
  const secret = randomToken(MFA_TOKEN_BYTES);
  const challengeId = uuidv7();
  const destinationHash = mfaSubjectHash(deps.otpHasher, input.userId);
  const expiresAt = new Date(Date.now() + MFA_TOKEN_TTL_SECONDS * 1000);

  // One live challenge per account. A user who tried to sign in twice should not be left holding
  // two keys, and the newest attempt is the one in front of them.
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
    // NOT NULL, and this challenge has no channel: nothing is sent here. The factor the user picks
    // is what sends anything, through `issueFactorChallenge`.
    channel: 'EMAIL',
    destinationHash,
    codeHash: hashCode(deps.otpHasher, { purpose: PURPOSE, destinationHash, code: secret }),
    maxAttempts: MFA_MAX_ATTEMPTS,
    expiresAt,
    createdIp: input.ip ?? null,
  });

  return {
    mfaToken: `${challengeId}.${secret}`,
    challengeId,
    expiresAt,
    factors: await challengeViews(tx, input.factors),
  };
}

export type MfaLoginResult =
  | { outcome: 'SESSION'; session: IssuedSession; user: PublicUser; nextStep: NextStep }
  /** The factor was wrong but the token was right, so the holder has already proved the password. */
  | { outcome: 'WRONG_CODE'; attemptsRemaining: number }
  /**
   * The only other failure. Unknown, expired, spent, foreign or wrong-purpose token; a factor that
   * is not the token owner's. One variant, for §S3's reason: a union with more members is a union
   * somebody eventually maps onto several status codes.
   */
  | { outcome: 'REJECTED' };

export interface CompleteMfaLoginInput {
  mfaToken: string;
  factorId: string;
  code?: string;
  assertion?: unknown;
  deviceFingerprint?: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Spends the `mfaToken` and, if the factor answers, opens the session the password step did not.
 *
 * Everything is one transaction: the device row, the session, the audit row and the outbox events
 * commit together or not at all, which is the same guarantee `login` gives on the path with no MFA.
 */
export async function completeMfaLogin(
  db: Db,
  deps: MfaDeps,
  input: CompleteMfaLoginInput,
): Promise<MfaLoginResult> {
  const parts = splitProofToken(input.mfaToken);
  // Malformed is indistinguishable from unknown on purpose.
  if (!parts) return { outcome: 'REJECTED' };

  return db.transaction(async (tx): Promise<MfaLoginResult> => {
    // Purpose and `consumed_at` are in the WHERE clause, not checked afterwards: a reset token has
    // the same shape, and a read-then-check would CHARGE an attempt against somebody else's
    // challenge before noticing it was not an MFA one.
    const challenge = (
      await tx
        .select()
        .from(otpChallenges)
        .where(
          and(
            eq(otpChallenges.id, parts.challengeId),
            eq(otpChallenges.purpose, PURPOSE),
            isNull(otpChallenges.consumedAt),
          ),
        )
        .for('update')
    )[0];
    if (!challenge?.userId) return { outcome: 'REJECTED' };
    if (challenge.expiresAt.getTime() <= Date.now()) return { outcome: 'REJECTED' };
    if (challenge.attempts >= challenge.maxAttempts) return { outcome: 'REJECTED' };

    const userId = challenge.userId;
    const destinationHash = mfaSubjectHash(deps.otpHasher, userId);
    // The `destination_hash` is derived from the OWNER of the row, so a challenge whose id was
    // guessed still has to carry the matching subject hash — one more thing a forged token cannot
    // supply, and free.
    if (!Buffer.from(challenge.destinationHash).equals(destinationHash)) return { outcome: 'REJECTED' };

    // Charged BEFORE the comparison and the transaction commits either way, for `consumeOtp`'s
    // reason: an attempt the caller can abandon by cutting the connection is an unmetered guess.
    const attempts = challenge.attempts + 1;
    await tx.update(otpChallenges).set({ attempts }).where(eq(otpChallenges.id, challenge.id));

    const tokenMatched = matchesCode(
      deps.otpHasher,
      { purpose: PURPOSE, destinationHash, code: parts.secret },
      Buffer.from(challenge.codeHash),
    );
    // No `attemptsRemaining` here. The counter is only reachable once the TOKEN has matched;
    // attaching it to an unrecognised token would make this endpoint a token-validity oracle.
    if (!tokenMatched) return { outcome: 'REJECTED' };

    const factor = await findOwnFactor(tx, { userId, factorId: input.factorId });
    if (!factor) return { outcome: 'REJECTED' };

    const presented = await verifyFactor(tx, deps, {
      userId,
      factor,
      proof: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.assertion !== undefined ? { assertion: input.assertion } : {}),
      },
      // The ceremony is scoped to this challenge, so a passkey assertion begun under one mfa token
      // cannot be finished under another.
      ceremonyKey: `mfa:${challenge.id}`,
    });

    if (!presented) {
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.MFA_FAILED,
        outcome: 'FAILURE',
        actorType: 'USER',
        actorUserId: userId,
        subjectUserId: userId,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { factorId: factor.id, factorType: factor.factorType, attempts },
      });
      return { outcome: 'WRONG_CODE', attemptsRemaining: challenge.maxAttempts - attempts };
    }

    // Re-read, and AFTER the factor was proved: a status that changed between the password step and
    // this one must stop the login, and checking it earlier would be work on the rejected path.
    const user = (await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)))[0];
    if (!user || !sessionUsableUnder(user.status)) return { outcome: 'REJECTED' };

    await tx
      .update(otpChallenges)
      .set({ consumedAt: sql`now()` })
      .where(eq(otpChallenges.id, challenge.id));

    // The device row belongs HERE and not in the password step: it must be written in the same
    // transaction as the session (T-031), and writing it at the challenge would make `isNewDevice`
    // false by the time the session actually opens — so §S11's new-device notification would never
    // fire for anybody using MFA.
    const device = await upsertDevice(tx, {
      userId,
      fingerprint: input.deviceFingerprint ?? null,
      ip: input.ip,
    });

    const session = await createSession(tx, deps, {
      userId,
      // CONSUMER and only CONSUMER, as `login` does. Staff and logistics sign in through their own
      // routes (T-037, T-086); the scope is chosen where the session is created and a refresh can
      // never change it.
      scope: 'CONSUMER',
      amr: ['pwd', factorAmr(factor.factorType)],
      deviceId: device.deviceId,
      ip: input.ip,
      userAgent: input.userAgent,
      isNewDevice: device.isNewDevice,
    });

    if (device.isNewDevice) {
      await publish(tx, identityDeviceSignedInEvent, {
        payload: {
          userId,
          deviceId: device.deviceId,
          deviceLabel: deviceLabel(input.userAgent),
          location: signInLocation(input.ip),
          signedInAt: new Date().toISOString(),
          ip: input.ip,
        },
        aggregateType: 'identity.user',
        aggregateId: userId,
        actor: { type: 'CONSUMER', id: userId },
      });
    }

    await tx
      .update(users)
      .set({ lastLoginAt: sql`now()` })
      .where(eq(users.id, userId));

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.LOGIN,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: userId,
      subjectUserId: userId,
      ip: input.ip,
      userAgent: input.userAgent,
      sessionId: session.sessionId,
      deviceId: device.deviceId,
      metadata: {
        amr: ['pwd', factorAmr(factor.factorType)],
        factorId: factor.id,
        factorType: factor.factorType,
        isNewDevice: device.isNewDevice,
      },
    });

    const { user: publicUser, state } = await onboarding(tx, deps, userId);
    return { outcome: 'SESSION', session, user: publicUser, nextStep: nextStep(state) };
  });
}

/**
 * The live challenge behind an `mfaToken`, for `POST /auth/mfa/challenge` to send a code against.
 *
 * Does NOT charge an attempt: asking for the SMS to be sent is not a guess, and metering it here
 * would let a user who taps "resend" twice lock themselves out of their own sign-in.
 */
export async function resolveMfaToken(
  tx: Tx,
  deps: MfaDeps,
  mfaToken: string,
): Promise<{ challengeId: string; userId: string } | null> {
  const parts = splitProofToken(mfaToken);
  if (!parts) return null;

  const challenge = (
    await tx
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.id, parts.challengeId),
          eq(otpChallenges.purpose, PURPOSE),
          isNull(otpChallenges.consumedAt),
        ),
      )
  )[0];
  if (!challenge?.userId) return null;
  if (challenge.expiresAt.getTime() <= Date.now()) return null;
  if (challenge.attempts >= challenge.maxAttempts) return null;

  const destinationHash = mfaSubjectHash(deps.otpHasher, challenge.userId);
  if (!Buffer.from(challenge.destinationHash).equals(destinationHash)) return null;
  const matched = matchesCode(
    deps.otpHasher,
    { purpose: PURPOSE, destinationHash, code: parts.secret },
    Buffer.from(challenge.codeHash),
  );
  return matched ? { challengeId: challenge.id, userId: challenge.userId } : null;
}

/** The ACTIVE factors behind an `mfaToken`, for the challenge endpoint. */
export const factorsFor = (tx: Tx, userId: string): Promise<FactorRow[]> => activeFactors(tx, userId);
