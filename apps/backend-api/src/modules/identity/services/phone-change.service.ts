// Moving an account to a new phone number (F-045, screen SP-M05).
//
// Three steps, because "your phone number is your Komtru ID" means both ends are proven and the old one is told:
//   1. `startPhoneChange`    behind a step-up, names the new number and sends a code to the CURRENT one (it is you).
//   2. `confirmCurrentPhone` takes that code and sends a code to the NEW one (it is yours). A start supersedes any
//      earlier NEW-end code for the same number, so step 3 can only be reached through this change's step 2.
//   3. `confirmNewPhone`     takes that code and swaps the numbers; Notify then tells the old number.
//
// How a change in flight is held. A number in a change carries `user_phones.change_state`: `PENDING` for the new number being
// proven, `RETIRED` for the one just replaced (migration 0052). Both are stated and not inferred from the shape of a row,
// and each is unique per user by a partial index: the database is what holds "one pending number" under concurrency, with a
// lock on the user's row as a second belt. That matters because Notify finds the number a code or a notice goes to by that
// state, so a state a session alone could forge or duplicate would be a way to aim a security message at somebody else's
// handset. Only a completed change writes `RETIRED`, and it needs both codes.
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { isUniqueViolation } from '../../../db/errors.js';
import type { Db } from '../../../db/index.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { DEFAULT_COUNTRY, maskPhone, normalisePhone } from '../../../platform/identifiers.js';
import { identityPhoneChangedEvent } from '../domain/events.js';
import {
  PHONE_CHANGE_COOLDOWN_MS,
  phoneChangeDestinationHash,
  type PhoneChangeEnd,
} from '../domain/phone-change.js';
import { identityAuditLog } from '../infrastructure/postgres/schema/audit.js';
import { otpChallenges } from '../infrastructure/postgres/schema/sessions.js';
import { mfaFactors } from '../infrastructure/postgres/schema/sessions.js';
import { userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import { ContactTakenError, markPhoneVerified, primaryContacts } from './contact.service.js';
import { activeFactors, type MfaDeps } from './mfa.service.js';
import { consumeOtp, findLiveChallenge, issueOtp, type VerifyOutcome } from './otp.service.js';
import { requireStepUp } from './step-up.service.js';

export interface PhoneChangeDeps extends MfaDeps {
  db: Db;
}

const otpDeps = (deps: PhoneChangeDeps) => ({ hasher: deps.otpHasher, logger: deps.logger });

type Failure = Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;

interface Caller {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

/** A failure is on the audit trail as it is for step-up: ids and a reason, never a number or a code. */
async function auditFailure(tx: Tx, caller: Caller, reason: string, metadata: Record<string, unknown> = {}) {
  await writeAudit(tx, {
    action: AUDIT_ACTIONS.PHONE_CHANGE_FAILED,
    outcome: 'FAILURE',
    actorType: 'USER',
    actorUserId: caller.userId,
    subjectUserId: caller.userId,
    ip: caller.ip,
    userAgent: caller.userAgent,
    metadata: { reason, ...metadata },
  });
}

export type StartPhoneChangeResult =
  | {
      outcome: 'STARTED';
      /** The pending number's row id: the handle the next two steps carry. */
      changeId: string;
      challengeId: string;
      maskedDestination: string;
      expiresAt: Date;
      delivered: boolean;
    }
  /** No verified number on the account to confirm with. */
  | { outcome: 'NO_CURRENT_PHONE' }
  | { outcome: 'INVALID_PHONE' }
  | { outcome: 'SAME_PHONE' }
  /** A change was completed less than the cooldown ago. `retryAt` is when the next one may start. */
  | { outcome: 'COOLDOWN'; retryAt: Date };

export async function startPhoneChange(
  deps: PhoneChangeDeps,
  input: {
    userId: string;
    newPhone: string;
    stepUpToken: string | undefined;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<StartPhoneChangeResult> {
  return deps.db.transaction(async (tx): Promise<StartPhoneChangeResult> => {
    // §S7: any factor the account holds may prove it (the owner chose not to demand the strongest), or the password for an
    // account that has none. Spent here, in the transaction, so a refusal further down does not burn it.
    const factors = await activeFactors(tx, input.userId);
    await requireStepUp(tx, deps, {
      userId: input.userId,
      token: input.stepUpToken,
      acceptedFactors: factors.length > 0 ? factors.map((factor) => factor.factorType) : ['PASSWORD'],
    });

    // Two starts at once queue here, so each sees the other's pending number to replace. The unique index on `PENDING` is
    // what holds if this lock is ever lost; this is what makes the loser's start succeed instead of failing.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for('update');

    // A change that just completed holds the next one off (see `PHONE_CHANGE_COOLDOWN_MS`). Read under the user lock, so two starts
    // cannot both pass it, and from the audit row the swap wrote in its own transaction: an abandoned start writes only
    // PHONE_CHANGE_STARTED and so never counts against the person.
    const lastChange = (
      await tx
        .select({ at: identityAuditLog.occurredAt })
        .from(identityAuditLog)
        .where(
          and(
            eq(identityAuditLog.subjectUserId, input.userId),
            eq(identityAuditLog.action, AUDIT_ACTIONS.PHONE_CHANGED),
            gt(identityAuditLog.occurredAt, new Date(Date.now() - PHONE_CHANGE_COOLDOWN_MS)),
          ),
        )
        .orderBy(desc(identityAuditLog.occurredAt))
        .limit(1)
    )[0];
    if (lastChange) {
      return { outcome: 'COOLDOWN', retryAt: new Date(lastChange.at.getTime() + PHONE_CHANGE_COOLDOWN_MS) };
    }

    const current = (await primaryContacts(tx, input.userId)).phone;
    if (!current?.verified) return { outcome: 'NO_CURRENT_PHONE' };

    const normalised = normalisePhone(input.newPhone);
    if (!normalised) return { outcome: 'INVALID_PHONE' };
    if (normalised.phoneE164 === current.address) return { outcome: 'SAME_PHONE' };

    // A proof for the new number belongs to the change that minted it. Starting again to the same number must not leave the
    // earlier change's NEW-end code live, or it would complete this change without the current number's code ever being
    // given (the hash is per number and end, so the database cannot tell the two changes apart; this does).
    await tx
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(otpChallenges.userId, input.userId),
          eq(otpChallenges.purpose, 'SENSITIVE_ACTION'),
          isNull(otpChallenges.consumedAt),
          eq(
            otpChallenges.destinationHash,
            phoneChangeDestinationHash(deps.otpHasher, { phoneE164: normalised.phoneE164, end: 'NEW' }),
          ),
        ),
      );

    // One pending number at a time. Only the pending one: a retired number is the notice's address and is not this
    // flow's to touch, and any other unverified number on the account belongs to another flow.
    await tx
      .delete(userPhones)
      .where(and(eq(userPhones.userId, input.userId), eq(userPhones.changeState, 'PENDING')));
    const pending = (
      await tx
        .insert(userPhones)
        .values({
          userId: input.userId,
          phoneE164: normalised.phoneE164,
          countryCode: normalised.countryCode ?? DEFAULT_COUNTRY,
          isPrimary: false,
          changeState: 'PENDING',
        })
        .returning({ id: userPhones.id })
    )[0];
    if (!pending) throw new Error('startPhoneChange: the insert returned no row');

    // Delivered by the ordinary OTP event to the account's proven number, which is the current one. Budgeted per number.
    const issued = await issueOtp(tx, otpDeps(deps), {
      userId: input.userId,
      purpose: 'SENSITIVE_ACTION',
      channels: ['SMS'],
      destinationHash: phoneChangeDestinationHash(deps.otpHasher, {
        phoneE164: current.address,
        end: 'CURRENT',
      }),
      ip: input.ip,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PHONE_CHANGE_STARTED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      // Ids only (§S12): never either number.
      metadata: { pendingPhoneId: pending.id, challengeId: issued.challengeId, delivered: issued.delivered },
    });

    return {
      outcome: 'STARTED',
      changeId: pending.id,
      challengeId: issued.challengeId,
      maskedDestination: maskPhone(current.address),
      expiresAt: issued.expiresAt,
      delivered: issued.delivered,
    };
  });
}

const pendingPhone = async (tx: Tx, userId: string, changeId: string) =>
  (
    await tx
      .select({ id: userPhones.id, phoneE164: userPhones.phoneE164 })
      .from(userPhones)
      .where(
        and(
          eq(userPhones.id, changeId),
          eq(userPhones.userId, userId),
          eq(userPhones.changeState, 'PENDING'),
        ),
      )
      .for('update')
  )[0];

/**
 * The challenge must be this user's, for this purpose and for THIS number at THIS end of the change, checked before an
 * attempt is spent: a code that was sent for something else (a step-up, the other number's code) proves nothing here.
 */
async function ownChallenge(
  tx: Tx,
  deps: PhoneChangeDeps,
  input: { userId: string; phoneE164: string; challengeId: string; end: PhoneChangeEnd },
): Promise<boolean> {
  const challenge = await findLiveChallenge(tx, input.challengeId);
  return (
    challenge !== null &&
    challenge.userId === input.userId &&
    challenge.purpose === 'SENSITIVE_ACTION' &&
    Buffer.from(challenge.destinationHash).equals(
      phoneChangeDestinationHash(deps.otpHasher, { phoneE164: input.phoneE164, end: input.end }),
    )
  );
}

export type ConfirmCurrentPhoneResult =
  | {
      outcome: 'CODE_SENT';
      challengeId: string;
      maskedDestination: string;
      expiresAt: Date;
      delivered: boolean;
    }
  | Failure;

/** Step two. The transaction commits on a wrong code as well as a right one: the attempt is charged first. */
export async function confirmCurrentPhone(
  deps: PhoneChangeDeps,
  input: Caller & { changeId: string; challengeId: string; code: string },
): Promise<ConfirmCurrentPhoneResult> {
  return deps.db.transaction(async (tx): Promise<ConfirmCurrentPhoneResult> => {
    const pending = await pendingPhone(tx, input.userId, input.changeId);
    const current = (await primaryContacts(tx, input.userId)).phone;
    if (
      !pending ||
      !current?.verified ||
      !(await ownChallenge(tx, deps, {
        userId: input.userId,
        phoneE164: current.address,
        challengeId: input.challengeId,
        end: 'CURRENT',
      }))
    ) {
      await auditFailure(tx, input, 'UNKNOWN_CHANGE', { step: 'CURRENT', changeId: input.changeId });
      return { outcome: 'UNKNOWN' };
    }

    const verified = await consumeOtp(tx, otpDeps(deps), {
      challengeId: input.challengeId,
      code: input.code,
    });
    if (verified.outcome !== 'VERIFIED') {
      await auditFailure(tx, input, verified.outcome, { step: 'CURRENT', changeId: pending.id });
      return verified;
    }

    const issued = await issueOtp(tx, otpDeps(deps), {
      userId: input.userId,
      purpose: 'SENSITIVE_ACTION',
      channels: ['SMS'],
      // Budgeted per number, so a stranger's number cannot be sent codes without limit by starting changes to it.
      destinationHash: phoneChangeDestinationHash(deps.otpHasher, {
        phoneE164: pending.phoneE164,
        end: 'NEW',
      }),
      delivery: 'PHONE_CHANGE',
      ip: input.ip,
    });
    return {
      outcome: 'CODE_SENT',
      challengeId: issued.challengeId,
      maskedDestination: maskPhone(pending.phoneE164),
      expiresAt: issued.expiresAt,
      delivered: issued.delivered,
    };
  });
}

export type ConfirmNewPhoneResult =
  | { outcome: 'CHANGED'; maskedPhone: string }
  /** Somebody else has already proven this number. The change is not made; the code is spent. */
  | { outcome: 'TAKEN' }
  | { outcome: 'NO_CURRENT_PHONE' }
  | Failure;

/**
 * Step three: the swap, in a savepoint so that a number somebody else has proven undoes the swap and nothing else (the
 * spent code and the audit row stay, so a loser cannot replay the code). The old number stops being primary and verified
 * (so it claims nothing and cannot sign in) and becomes `RETIRED`; the new one becomes both primary and verified. An SMS
 * second factor does NOT follow the person to the new number: it is revoked, and they set it up again on the new one, so a
 * SIM-swap that reaches this far does not also hand over a live, pre-verified factor.
 */
export async function confirmNewPhone(
  deps: PhoneChangeDeps,
  input: Caller & { changeId: string; challengeId: string; code: string },
): Promise<ConfirmNewPhoneResult> {
  return deps.db.transaction(async (tx): Promise<ConfirmNewPhoneResult> => {
    const pending = await pendingPhone(tx, input.userId, input.changeId);
    if (
      !pending ||
      !(await ownChallenge(tx, deps, {
        userId: input.userId,
        phoneE164: pending.phoneE164,
        challengeId: input.challengeId,
        end: 'NEW',
      }))
    ) {
      await auditFailure(tx, input, 'UNKNOWN_CHANGE', { step: 'NEW', changeId: input.changeId });
      return { outcome: 'UNKNOWN' };
    }

    const verified = await consumeOtp(tx, otpDeps(deps), {
      challengeId: input.challengeId,
      code: input.code,
    });
    if (verified.outcome !== 'VERIFIED') {
      await auditFailure(tx, input, verified.outcome, { step: 'NEW', changeId: pending.id });
      return verified;
    }

    const old = (await primaryContacts(tx, input.userId)).phone;
    if (!old?.verified) {
      await auditFailure(tx, input, 'NO_CURRENT_PHONE', { step: 'NEW', changeId: pending.id });
      return { outcome: 'NO_CURRENT_PHONE' };
    }

    try {
      await tx.transaction(async (sp) => {
        // Only the latest retired number is kept: it is the address of the notice, and there is one per user.
        await sp
          .delete(userPhones)
          .where(and(eq(userPhones.userId, input.userId), eq(userPhones.changeState, 'RETIRED')));
        // The old number first, so the new one's verified claim and primary flag never collide with it.
        await sp
          .update(userPhones)
          .set({ isPrimary: false, verifiedAt: null, changeState: 'RETIRED' })
          .where(eq(userPhones.id, old.id));
        await sp.update(userPhones).set({ changeState: 'NONE' }).where(eq(userPhones.id, pending.id));
        await markPhoneVerified(sp, { userId: input.userId, phoneId: pending.id });
        await sp.update(userPhones).set({ isPrimary: true }).where(eq(userPhones.id, pending.id));
        await sp.update(users).set({ primaryPhoneId: pending.id }).where(eq(users.id, input.userId));
        await retireSmsFactors(sp, input.userId, old.id);
      });
    } catch (error) {
      if (error instanceof ContactTakenError || isUniqueViolation(error, 'user_phones_verified_unique')) {
        await auditFailure(tx, input, 'NUMBER_TAKEN', { step: 'NEW', changeId: pending.id });
        return { outcome: 'TAKEN' };
      }
      throw error;
    }

    const maskedPhone = maskPhone(pending.phoneE164);
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.PHONE_CHANGED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { previousPhoneId: old.id, phoneId: pending.id },
    });
    await publish(tx, identityPhoneChangedEvent, {
      payload: { userId: input.userId, newPhoneMasked: maskedPhone, changedAt: new Date().toISOString() },
      aggregateType: 'identity.user',
      aggregateId: input.userId,
      actor: { type: 'CONSUMER', id: input.userId },
    });
    return { outcome: 'CHANGED', maskedPhone };
  });
}

/**
 * Revokes the text-message factors on the number that was replaced. If that leaves the account with no second factor, the
 * sheet of printed codes goes with it (ten printed codes are not a second factor, `removeFactor`'s rule), and a default is
 * handed to a factor that survives.
 */
async function retireSmsFactors(tx: Tx, userId: string, oldPhoneId: string): Promise<void> {
  await tx
    .update(mfaFactors)
    .set({ revokedAt: new Date(), status: 'REVOKED', isDefault: false })
    .where(
      and(
        eq(mfaFactors.userId, userId),
        eq(mfaFactors.phoneId, oldPhoneId),
        eq(mfaFactors.factorType, 'SMS_OTP'),
        isNull(mfaFactors.revokedAt),
      ),
    );

  const live = await activeFactors(tx, userId);
  const second = live.filter(
    (f) => f.factorType === 'TOTP' || f.factorType === 'SMS_OTP' || f.factorType === 'PASSKEY',
  );
  if (second.length === 0) {
    await tx
      .update(mfaFactors)
      .set({ revokedAt: new Date(), status: 'REVOKED', isDefault: false })
      .where(
        and(
          eq(mfaFactors.userId, userId),
          eq(mfaFactors.factorType, 'RECOVERY_CODE'),
          isNull(mfaFactors.revokedAt),
        ),
      );
  } else if (!live.some((f) => f.isDefault)) {
    const next = second[0];
    if (next) await tx.update(mfaFactors).set({ isDefault: true }).where(eq(mfaFactors.id, next.id));
  }
}
