// Forgot, reset and change password (M1 §10.1, AC2, AC3).
//
// Two rules shape the whole file:
//
//   1. §17: "/auth/password/forgot returns identical response for known and unknown identifiers."
//      Identical has to include the row left behind, or the challenge id in the response becomes
//      the oracle the body avoided being. So the miss writes a REAL challenge with `user_id` NULL
//      and simply never delivers it — `issueOtp({ deliver: false })`.
//   2. §9.2: a reset revokes EVERY session; a change revokes every session EXCEPT the caller's.
//      A recovery means the account may have been in someone else's hands, so everything goes. An
//      ordinary change means the holder is sitting there, and signing them out of the app they are
//      using to change it would be a bug, not a precaution.
import { eq } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import {
  classifyIdentifier,
  maskEmail,
  maskPhone,
  normaliseEmail,
  normalisePhone,
} from '../../../platform/identifiers.js';
import { identityPasswordChangedEvent } from '../domain/events.js';
import type { PasswordRejection } from '../domain/credential/policy.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import type { AccountDeps } from './auth.service.js';
import { findUserByVerifiedEmail, findUserByVerifiedPhone, primaryContacts } from './contact.service.js';
import { hasCredential, setPassword, validatePassword, verifyAndRecord } from './credential.service.js';
import {
  consumeProofToken,
  issueOtp,
  type OtpChannel,
  type OtpDeps,
  type VerifyOutcome,
} from './otp.service.js';
import { bumpSessionsEpoch, revokeAllSessions } from './session.service.js';

const otpDeps = (deps: AccountDeps): OtpDeps => ({ hasher: deps.otpHasher, logger: deps.logger });

/**
 * Thrown rather than returned so the caller's transaction rolls back and the single-use reset token
 * survives a recoverable user mistake.
 */
class PasswordRefusedError extends Error {
  constructor(
    readonly rejection: PasswordRejection,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'PasswordRefusedError';
  }
}

/**
 * What this account is known by, so `CONTAINS_IDENTIFIER` applies to a changed or reset password as
 * well as to the one chosen at registration. Without it a user can reset to `jane@example.com2026`,
 * which no breach corpus catches because it is only weak for Jane.
 */
async function identifiersFor(tx: Tx, userId: string): Promise<string[]> {
  const contacts = await primaryContacts(tx, userId);
  const user = (
    await tx.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  return [contacts.email?.address, contacts.phone?.address, user?.username].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

export interface StartResetInput {
  identifier: string;
  ip: string | null;
  userAgent: string | null;
}

export interface StartedReset {
  challengeId: string;
  expiresAt: Date;
  /**
   * A mask of WHAT THE CALLER TYPED, never of what the account holds, and null for a username.
   *
   * Masking the account's own contact would turn `/auth/password/forgot` into a lookup: type a
   * handle, learn the last four digits of its owner's phone. Masking the caller's own input tells
   * them nothing they did not just write.
   */
  maskedDestination: string | null;
}

/** Always succeeds, and always returns the same shape (M1 §17). */
export async function startPasswordReset(
  db: Db,
  deps: AccountDeps,
  input: StartResetInput,
): Promise<StartedReset> {
  const kind = classifyIdentifier(input.identifier);
  const trimmed = input.identifier.trim();

  return db.transaction(async (tx): Promise<StartedReset> => {
    const resolved = await resolveResetTarget(tx, kind, trimmed);

    const issued = await issueOtp(tx, otpDeps(deps), {
      userId: resolved?.userId ?? null,
      purpose: 'PASSWORD_RESET',
      channels: resolved?.channels ?? ['SMS'],
      // On a miss the destination is whatever the caller typed, canonicalised as far as it can be.
      // That keeps §S4's per-destination budget meaningful for probing: forty attempts against one
      // unknown address are throttled exactly as forty against a real one would be.
      destination: resolved?.destination ?? trimmed.toLowerCase(),
      ip: input.ip,
      deliver: resolved !== null,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
      // SUCCESS either way: from the caller's side nothing failed, and recording FAILURE for a miss
      // would make the audit log the oracle the response is not.
      outcome: 'SUCCESS',
      actorType: resolved ? 'USER' : 'ANONYMOUS',
      actorUserId: resolved?.userId ?? null,
      subjectUserId: resolved?.userId ?? null,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { challengeId: issued.challengeId, identifierKind: kind, resolved: resolved !== null },
    });

    return {
      challengeId: issued.challengeId,
      expiresAt: issued.expiresAt,
      maskedDestination: maskWhatTheyTyped(kind, trimmed),
    };
  });
}

interface ResetTarget {
  userId: string;
  destination: string;
  channels: OtpChannel[];
}

/**
 * Who this identifier names and where to send their code.
 *
 * A verified contact only — a recovery flow that accepted an unproven address would hand the account
 * to whoever claimed it first. A username resolves to the user's primary VERIFIED channel, phone
 * first (M1 D4 makes phone the primary identifier in this market).
 */
async function resolveResetTarget(
  tx: Tx,
  kind: 'EMAIL' | 'PHONE' | 'USERNAME',
  identifier: string,
): Promise<ResetTarget | null> {
  if (kind === 'EMAIL') {
    let emailNormal: string;
    try {
      emailNormal = normaliseEmail(identifier).emailNormal;
    } catch {
      return null;
    }
    const found = await findUserByVerifiedEmail(tx, emailNormal);
    return found ? { userId: found.userId, destination: emailNormal, channels: ['EMAIL'] } : null;
  }

  if (kind === 'PHONE') {
    const normalised = normalisePhone(identifier);
    if (!normalised) return null;
    const found = await findUserByVerifiedPhone(tx, normalised.phoneE164);
    return found ? { userId: found.userId, destination: normalised.phoneE164, channels: ['SMS'] } : null;
  }

  const handle = identifier.replace(/^@/, '').toLowerCase();
  const user = (await tx.select({ id: users.id }).from(users).where(eq(users.username, handle)).limit(1))[0];
  if (!user) return null;

  const contacts = await primaryContacts(tx, user.id);
  if (contacts.phone?.verified) {
    return { userId: user.id, destination: contacts.phone.address, channels: ['SMS'] };
  }
  if (contacts.email?.verified) {
    return {
      userId: user.id,
      destination: normaliseEmail(contacts.email.address).emailNormal,
      channels: ['EMAIL'],
    };
  }
  // A handle with no proven channel has nowhere to recover to. Indistinguishable from a miss, which
  // is correct: the caller learns nothing either way.
  return null;
}

const maskWhatTheyTyped = (kind: 'EMAIL' | 'PHONE' | 'USERNAME', identifier: string): string | null => {
  if (kind === 'EMAIL') return maskEmail(identifier);
  if (kind === 'PHONE') {
    const normalised = normalisePhone(identifier);
    return normalised ? maskPhone(normalised.phoneE164) : null;
  }
  return null;
};

export type ResetResult =
  | { outcome: 'RESET'; revokedSessions: number }
  | { outcome: 'REJECTED'; rejection: PasswordRejection; message: string }
  | Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;

export interface CompleteResetInput {
  resetToken: string;
  newPassword: string;
  ip: string | null;
  userAgent: string | null;
}

export async function completePasswordReset(
  db: Db,
  deps: AccountDeps,
  input: CompleteResetInput,
): Promise<ResetResult> {
  // Outside the transaction: the breach check is a three-second HTTP call, and the transaction
  // below takes an advisory lock on the user's sessions.
  const verdict = await validatePassword(deps, input.newPassword);
  if (!verdict.ok) {
    return { outcome: 'REJECTED', rejection: verdict.rejection, message: verdict.message };
  }

  // Per call, captured by the closure below — never a module-level holder, which two concurrent
  // resets would share and one would read the other's user out of.
  let subject: string | undefined;

  let result: ResetResult;
  try {
    result = await db.transaction(async (tx): Promise<ResetResult> => {
      const used = await consumeProofToken(tx, otpDeps(deps), input.resetToken);
      if (used.outcome !== 'VERIFIED') return used;

      const userId = used.challenge.userId;
      // A proof token minted from a decoy challenge has no user. It cannot happen — a decoy is never
      // delivered, so nobody can verify it to mint one — but a reset that reached here without a
      // subject would be a reset of nothing, reported as success.
      if (!userId) return { outcome: 'UNKNOWN' };
      subject = userId;

      const written = await setPassword(tx, deps, {
        userId,
        password: input.newPassword,
        identifiers: await identifiersFor(tx, userId),
      });
      if (!written.ok) {
        // THROWN, not returned. `consumeProofToken` has already spent the token's single attempt, and
        // returning would commit that — so a user who typed a password they had used before would be
        // told to pick another one and then find the token dead, with `/auth/password/forgot` three
        // an hour away. REUSED is the one rejection that survives `validatePassword`, and it is
        // exactly the one a real person hits.
        throw new PasswordRefusedError(written.rejection, written.message);
      }

      // §9.2's full kill. No `exceptSessionId`: a recovery means the account may have been in
      // somebody else's hands, and the one session we would be sparing could be theirs.
      await bumpSessionsEpoch(tx, userId);
      const revokedSessions = await revokeAllSessions(tx, { userId, reason: 'password_reset' });

      await writeAudit(tx, {
        action: AUDIT_ACTIONS.PASSWORD_RESET,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: userId,
        subjectUserId: userId,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { revokedSessions, viaRecovery: true },
      });

      await publish(tx, identityPasswordChangedEvent, {
        payload: {
          userId,
          viaRecovery: true,
          changedAt: new Date().toISOString(),
          revokedSessions,
        },
        aggregateType: 'identity.user',
        aggregateId: userId,
        actor: { type: 'CONSUMER', id: userId },
      });

      return { outcome: 'RESET', revokedSessions };
    });
  } catch (error) {
    if (error instanceof PasswordRefusedError) {
      return { outcome: 'REJECTED', rejection: error.rejection, message: error.detail };
    }
    throw error;
  }

  // After the commit, and best-effort: a missed invalidation costs one cache hit and nothing more,
  // because `resolvePrincipal` compares the token's epoch against the row it just read (T-031).
  if (result.outcome === 'RESET' && subject) await deps.epochs.invalidate(subject);
  return result;
}

export type ChangeResult =
  | { outcome: 'CHANGED'; revokedSessions: number }
  | { outcome: 'WRONG_PASSWORD' }
  /** The account has a password and the caller did not send the current one. */
  | { outcome: 'CURRENT_REQUIRED' }
  | { outcome: 'REJECTED'; rejection: PasswordRejection; message: string };

export interface ChangePasswordInput {
  userId: string;
  /** The caller's own session, which §9.2 keeps alive while every other one is revoked. */
  sessionId: string;
  currentPassword?: string;
  newPassword: string;
  ip: string | null;
  userAgent: string | null;
}

export async function changePassword(
  db: Db,
  deps: AccountDeps,
  input: ChangePasswordInput,
): Promise<ChangeResult> {
  const verdict = await validatePassword(deps, input.newPassword);
  if (!verdict.ok) {
    return { outcome: 'REJECTED', rejection: verdict.rejection, message: verdict.message };
  }

  return db.transaction(async (tx): Promise<ChangeResult> => {
    const existing = await hasCredential(tx, input.userId);

    if (existing) {
      // §S7 asks for step-up on a password change. The current password IS the step-up here; a
      // second factor is T-036's. Omitting it when one exists must be a refusal, not a shrug — a
      // stolen session would otherwise be enough to lock the real owner out.
      if (input.currentPassword === undefined) return { outcome: 'CURRENT_REQUIRED' };
      const verified = await verifyAndRecord(tx, deps, {
        userId: input.userId,
        password: input.currentPassword,
      });
      if (verified.outcome !== 'OK') return { outcome: 'WRONG_PASSWORD' };
    }
    // No credential row: this is M1 §9.3's "phone path, set a password after the channel is
    // proven". The session itself is the proof — it was minted by `verify-otp` against a code we
    // sent to a number the user demonstrably holds — and there is no older password to produce.

    const written = await setPassword(tx, deps, {
      userId: input.userId,
      password: input.newPassword,
      identifiers: await identifiersFor(tx, input.userId),
    });
    if (!written.ok) {
      return { outcome: 'REJECTED', rejection: written.rejection, message: written.message };
    }

    // §9.2: every OTHER session. The epoch is deliberately NOT bumped — that would kill the
    // caller's own access token too, and the sibling sessions are already revoked row by row.
    const revokedSessions = await revokeAllSessions(tx, {
      userId: input.userId,
      reason: 'password_changed',
      exceptSessionId: input.sessionId,
    });

    await writeAudit(tx, {
      action: existing ? AUDIT_ACTIONS.PASSWORD_CHANGED : AUDIT_ACTIONS.PASSWORD_SET,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      sessionId: input.sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { revokedSessions, viaRecovery: false, firstPassword: !existing },
    });

    await publish(tx, identityPasswordChangedEvent, {
      payload: {
        userId: input.userId,
        viaRecovery: false,
        changedAt: new Date().toISOString(),
        revokedSessions,
      },
      aggregateType: 'identity.user',
      aggregateId: input.userId,
      actor: { type: 'CONSUMER', id: input.userId },
    });

    return { outcome: 'CHANGED', revokedSessions };
  });
}
