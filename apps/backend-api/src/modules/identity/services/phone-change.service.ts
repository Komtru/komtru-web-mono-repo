// Moving an account to a new phone number (F-045, screen SP-M05).
//
// Three steps, because "your phone number is your Komtru ID" means both ends are proven and the old one is told:
//   1. `startPhoneChange`    names the new number and sends a code to the CURRENT one (it is you).
//   2. `confirmCurrentPhone` takes that code and sends a code to the NEW one (it is yours).
//   3. `confirmNewPhone`     takes that code and swaps the numbers; Notify then tells the old number.
//
// How the pending number is held. There is no table for a change in flight and this ticket adds none: the new number is
// a `user_phones` row that is NOT primary and NOT verified, and the account has at most one such row. `startPhoneChange`
// clears any other (an abandoned attempt, or the old number of an earlier change) before it adds its own. A completed
// change leaves the old number in the same shape — not primary, not verified — so it can be told and so it no longer
// claims anything (`user_phones_verified_unique` is on verified numbers only) and can no longer sign anyone in. Notify finds
// the pending number and the retired one by that shape (`phoneTargetFor` in notify's binding). The honest cost: a second
// change started within the seconds before the notice is sent clears the old number first, and that notice has nowhere
// to go. A status column on `user_phones` would say this directly; it is a migration, and was not added.
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import { DEFAULT_COUNTRY, maskPhone, normalisePhone } from '../../../platform/identifiers.js';
import type { Logger } from '../../../platform/logger.js';
import { identityPhoneChangedEvent } from '../domain/events.js';
import { phoneChangeDestinationHash, type PhoneChangeEnd } from '../domain/phone-change.js';
import { mfaFactors } from '../infrastructure/postgres/schema/sessions.js';
import { userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import { ContactTakenError, markPhoneVerified, primaryContacts } from './contact.service.js';
import { consumeOtp, findLiveChallenge, issueOtp, type VerifyOutcome } from './otp.service.js';

export interface PhoneChangeDeps {
  db: Db;
  hasher: HmacHasher;
  logger: Logger;
}

const otpDeps = (deps: PhoneChangeDeps) => ({ hasher: deps.hasher, logger: deps.logger });

type Failure = Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;

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
  | { outcome: 'SAME_PHONE' };

export async function startPhoneChange(
  deps: PhoneChangeDeps,
  input: { userId: string; newPhone: string; ip: string | null; userAgent: string | null },
): Promise<StartPhoneChangeResult> {
  return deps.db.transaction(async (tx): Promise<StartPhoneChangeResult> => {
    const current = (await primaryContacts(tx, input.userId)).phone;
    if (!current?.verified) return { outcome: 'NO_CURRENT_PHONE' };

    const normalised = normalisePhone(input.newPhone);
    if (!normalised) return { outcome: 'INVALID_PHONE' };
    if (normalised.phoneE164 === current.address) return { outcome: 'SAME_PHONE' };

    // One pending number at a time: see the file header.
    await tx
      .delete(userPhones)
      .where(
        and(
          eq(userPhones.userId, input.userId),
          eq(userPhones.isPrimary, false),
          isNull(userPhones.verifiedAt),
        ),
      );
    const pending = (
      await tx
        .insert(userPhones)
        .values({
          userId: input.userId,
          phoneE164: normalised.phoneE164,
          countryCode: normalised.countryCode ?? DEFAULT_COUNTRY,
          isPrimary: false,
        })
        .returning({ id: userPhones.id })
    )[0];
    if (!pending) throw new Error('startPhoneChange: the insert returned no row');

    // Delivered by the ordinary OTP event to the account's proven number, which is the current one.
    const issued = await issueOtp(tx, otpDeps(deps), {
      userId: input.userId,
      purpose: 'SENSITIVE_ACTION',
      channels: ['SMS'],
      destinationHash: phoneChangeDestinationHash(deps.hasher, {
        userId: input.userId,
        pendingPhoneId: pending.id,
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
      metadata: { pendingPhoneId: pending.id, challengeId: issued.challengeId },
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
          eq(userPhones.isPrimary, false),
          isNull(userPhones.verifiedAt),
        ),
      )
      .for('update')
  )[0];

/**
 * The challenge must be this user's, for this purpose and for THIS end of THIS change, checked before an attempt is
 * spent: a code that was sent for something else (a step-up, the other number's code) proves nothing here.
 */
async function ownChallenge(
  tx: Tx,
  deps: PhoneChangeDeps,
  input: { userId: string; changeId: string; challengeId: string; end: PhoneChangeEnd },
): Promise<boolean> {
  const challenge = await findLiveChallenge(tx, input.challengeId);
  return (
    challenge !== null &&
    challenge.userId === input.userId &&
    challenge.purpose === 'SENSITIVE_ACTION' &&
    Buffer.from(challenge.destinationHash).equals(
      phoneChangeDestinationHash(deps.hasher, {
        userId: input.userId,
        pendingPhoneId: input.changeId,
        end: input.end,
      }),
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
  input: { userId: string; changeId: string; challengeId: string; code: string; ip: string | null },
): Promise<ConfirmCurrentPhoneResult> {
  return deps.db.transaction(async (tx): Promise<ConfirmCurrentPhoneResult> => {
    const pending = await pendingPhone(tx, input.userId, input.changeId);
    if (!pending || !(await ownChallenge(tx, deps, { ...input, end: 'CURRENT' }))) {
      return { outcome: 'UNKNOWN' };
    }

    const verified = await consumeOtp(tx, otpDeps(deps), {
      challengeId: input.challengeId,
      code: input.code,
    });
    if (verified.outcome !== 'VERIFIED') return verified;

    const issued = await issueOtp(tx, otpDeps(deps), {
      userId: input.userId,
      purpose: 'SENSITIVE_ACTION',
      channels: ['SMS'],
      destinationHash: phoneChangeDestinationHash(deps.hasher, {
        userId: input.userId,
        pendingPhoneId: pending.id,
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
  /** Somebody else has already proven this number. The change is not made and the codes are not spent. */
  | { outcome: 'TAKEN' }
  | { outcome: 'NO_CURRENT_PHONE' }
  | Failure;

/**
 * Step three: the swap. The old number stops being primary and verified (so it claims nothing and cannot sign in), the new
 * one becomes both, an SMS second factor follows the person to the new number, and Notify is told so it can tell the old.
 */
export async function confirmNewPhone(
  deps: PhoneChangeDeps,
  input: {
    userId: string;
    changeId: string;
    challengeId: string;
    code: string;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<ConfirmNewPhoneResult> {
  try {
    return await deps.db.transaction(async (tx): Promise<ConfirmNewPhoneResult> => {
      const pending = await pendingPhone(tx, input.userId, input.changeId);
      if (!pending || !(await ownChallenge(tx, deps, { ...input, end: 'NEW' }))) {
        return { outcome: 'UNKNOWN' };
      }

      const verified = await consumeOtp(tx, otpDeps(deps), {
        challengeId: input.challengeId,
        code: input.code,
      });
      if (verified.outcome !== 'VERIFIED') return verified;

      const old = (await primaryContacts(tx, input.userId)).phone;
      if (!old?.verified) return { outcome: 'NO_CURRENT_PHONE' };

      // The old number first, so the new one's verified claim and primary flag never collide with it.
      await tx
        .update(userPhones)
        .set({ isPrimary: false, verifiedAt: null })
        .where(eq(userPhones.id, old.id));
      await markPhoneVerified(tx, { userId: input.userId, phoneId: pending.id });
      await tx.update(userPhones).set({ isPrimary: true }).where(eq(userPhones.id, pending.id));
      await tx.update(users).set({ primaryPhoneId: pending.id }).where(eq(users.id, input.userId));
      // An SMS second factor is "a code to my phone": it moves with the phone.
      await tx.update(mfaFactors).set({ phoneId: pending.id }).where(eq(mfaFactors.phoneId, old.id));
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
        payload: {
          userId: input.userId,
          newPhoneMasked: maskedPhone,
          changedAt: new Date().toISOString(),
        },
        aggregateType: 'identity.user',
        aggregateId: input.userId,
        actor: { type: 'CONSUMER', id: input.userId },
      });
      return { outcome: 'CHANGED', maskedPhone };
    });
  } catch (error) {
    if (error instanceof ContactTakenError) return { outcome: 'TAKEN' };
    throw error;
  }
}
