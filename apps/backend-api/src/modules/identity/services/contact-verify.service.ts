// F-081: proving the email or phone on your own account, and adding one you never gave.
//
// Two steps, not F-045's three, because there is no second end to tell. The whole feature rests on one
// rule, enforced in `start`: a channel that is ALREADY VERIFIED is refused. `start` may therefore only
// ever write an UNVERIFIED row, so no request here can move a contact somebody has already proven —
// which is why this flow carries no step-up while `startPhoneChange` must. Changing a proven address
// stays impossible by design (the owner's scope call, 2026-11-18); it is F-045's job for phones and
// nobody's yet for email.
//
// Almost nothing here is new. `attachEmail`/`attachPhone` write the row and normalise the address,
// `markEmailVerified`/`markPhoneVerified` hold the "only one account may prove an address" invariant
// against a live 23505 under a SAVEPOINT, `issueOtp` carries the per-destination send budget, and
// `applyVerificationProgress` owns the level change. This file is the order they go in.
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import type { Tx } from '../../../platform/events/publish.js';
import type { Logger } from '../../../platform/logger.js';
import { maskEmail, maskPhone, normaliseEmail, normalisePhone } from '../../../platform/identifiers.js';
import { userEmails, userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { users } from '../infrastructure/postgres/schema/users.js';
import {
  applyVerificationProgress,
  attachEmail,
  attachPhone,
  ContactInvalidError,
  ContactTakenError,
  markEmailVerified,
  markPhoneVerified,
  type ContactChannel,
} from './contact.service.js';
import { hashDestination } from '../domain/otp/challenge.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import { consumeOtp, issueOtp, type VerifyOutcome } from './otp.service.js';

export type { ContactChannel } from './contact.service.js';

export interface ContactVerifyDeps {
  db: Db;
  logger: Logger;
  otpHasher: HmacHasher;
}

const otpDeps = (deps: ContactVerifyDeps) => ({ hasher: deps.otpHasher, logger: deps.logger });

/** The OTP purpose per channel. Both have been in the enum since T-030 and went unused until F-081. */
const PURPOSE = { EMAIL: 'EMAIL_VERIFICATION', PHONE: 'PHONE_VERIFICATION' } as const;

export type StartContactVerificationResult =
  | {
      outcome: 'STARTED';
      challengeId: string;
      maskedDestination: string;
      expiresAt: Date;
      /** False when §S4's per-destination budget is spent, so nothing was sent. Never dressed up as a send. */
      delivered: boolean;
    }
  /** This channel is already proven. Refused rather than re-sent: see the header. */
  | { outcome: 'ALREADY_VERIFIED' }
  /** Nothing on file and nothing supplied — a phone-first signup asking to verify an email it never gave. */
  | { outcome: 'NO_ADDRESS' }
  | { outcome: 'INVALID_ADDRESS' }
  /** Somebody else has already proven this address. */
  | { outcome: 'TAKEN' };

/**
 * The row this channel would prove: the PROVEN one first, then the primary, then the newest.
 *
 * "Proven first" is spelled as `verified_at IS NULL` ascending and not as `verified_at DESC`,
 * because Postgres sorts `DESC` NULLS FIRST — which would hand back the UNPROVEN row and quietly
 * stop `ALREADY_VERIFIED` from firing, the one rule this feature rests on.
 */
async function currentContact(
  tx: Tx,
  userId: string,
  channel: ContactChannel,
): Promise<{ id: string; address: string; verified: boolean } | undefined> {
  if (channel === 'EMAIL') {
    const [row] = await tx
      .select({ id: userEmails.id, address: userEmails.email, verifiedAt: userEmails.verifiedAt })
      .from(userEmails)
      .where(eq(userEmails.userId, userId))
      .orderBy(sql`${userEmails.verifiedAt} IS NULL`, desc(userEmails.isPrimary), desc(userEmails.createdAt))
      .limit(1);
    return row ? { id: row.id, address: row.address, verified: row.verifiedAt !== null } : undefined;
  }

  const [row] = await tx
    .select({ id: userPhones.id, address: userPhones.phoneE164, verifiedAt: userPhones.verifiedAt })
    .from(userPhones)
    .where(eq(userPhones.userId, userId))
    .orderBy(sql`${userPhones.verifiedAt} IS NULL`, desc(userPhones.isPrimary), desc(userPhones.createdAt))
    .limit(1);
  return row ? { id: row.id, address: row.address, verified: row.verifiedAt !== null } : undefined;
}

const maskFor = (channel: ContactChannel, address: string): string =>
  channel === 'EMAIL' ? maskEmail(address) : maskPhone(address);

/** Canonical form, or undefined when the caller's text cannot be made into an address. */
function canonical(channel: ContactChannel, address: string): string | undefined {
  if (channel === 'EMAIL') {
    try {
      return normaliseEmail(address).emailNormal;
    } catch {
      return undefined;
    }
  }
  return normalisePhone(address)?.phoneE164;
}

/**
 * Somebody else's PROVEN claim on this address.
 *
 * Only a verified row counts: two accounts may each hold the same unproven address, and refusing on
 * one of those would let anyone block a stranger's signup by typing their email first. The partial
 * unique index is the guard that actually holds under a race; this is the early, clean answer.
 */
async function takenByAnother(tx: Tx, channel: ContactChannel, canonicalAddress: string, userId: string) {
  if (channel === 'EMAIL') {
    const [row] = await tx
      .select({ userId: userEmails.userId })
      .from(userEmails)
      .where(and(eq(userEmails.emailNormal, canonicalAddress), isNotNull(userEmails.verifiedAt)))
      .limit(1);
    return row !== undefined && row.userId !== userId;
  }
  const [row] = await tx
    .select({ userId: userPhones.userId })
    .from(userPhones)
    .where(and(eq(userPhones.phoneE164, canonicalAddress), isNotNull(userPhones.verifiedAt)))
    .limit(1);
  return row !== undefined && row.userId !== userId;
}

export async function startContactVerification(
  deps: ContactVerifyDeps,
  input: {
    userId: string;
    channel: ContactChannel;
    /** Required when the account holds no address on this channel; otherwise it REPLACES the unproven one. */
    address?: string;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<StartContactVerificationResult> {
  return deps.db.transaction(async (tx): Promise<StartContactVerificationResult> => {
    // Two starts at once queue here, so the second sees the first's row to replace rather than
    // inserting a second unproven address beside it.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for('update');

    const existing = await currentContact(tx, input.userId, input.channel);

    // Before any write, and before any code: this is the rule the feature rests on.
    if (existing?.verified) return { outcome: 'ALREADY_VERIFIED' };
    if (!existing && input.address === undefined) return { outcome: 'NO_ADDRESS' };

    let target = existing;

    if (input.address !== undefined) {
      const wanted = canonical(input.channel, input.address);
      if (wanted === undefined) return { outcome: 'INVALID_ADDRESS' };
      if (await takenByAnother(tx, input.channel, wanted, input.userId)) return { outcome: 'TAKEN' };

      // An unproven row is replaced rather than added to: the person is correcting a typo, and a
      // second unproven address would leave `/me` and the next start disagreeing about which one
      // the badge means.
      if (existing) await deleteContact(tx, input.channel, existing.id);
      try {
        target =
          input.channel === 'EMAIL'
            ? await attachEmailRow(tx, input.userId, input.address)
            : await attachPhoneRow(tx, input.userId, input.address);
      } catch (error) {
        if (error instanceof ContactInvalidError) return { outcome: 'INVALID_ADDRESS' };
        if (error instanceof ContactTakenError) return { outcome: 'TAKEN' };
        throw error;
      }
    }

    if (!target) return { outcome: 'NO_ADDRESS' };

    const issued = await issueOtp(tx, otpDeps(deps), {
      userId: input.userId,
      purpose: PURPOSE[input.channel],
      channels: [input.channel === 'EMAIL' ? 'EMAIL' : 'SMS'],
      // Canonical, so the budget counts sends to an address and not to the ways of spelling it.
      destination: canonical(input.channel, target.address) ?? target.address,
      ip: input.ip,
    });

    // §S10. This route sends a message to an address the caller named, on the platform's budget and
    // behind nothing but a session — so who asked, for which channel, and whether anything actually
    // went out all belong on the trail. The address itself does not: ids and a reason only.
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.OTP_ISSUED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: {
        challengeId: issued.challengeId,
        channel: input.channel,
        contactId: target.id,
        delivered: issued.delivered,
        replacedAddress: input.address !== undefined,
        via: 'F-081',
      },
    });

    return {
      outcome: 'STARTED',
      challengeId: issued.challengeId,
      maskedDestination: maskFor(input.channel, target.address),
      expiresAt: issued.expiresAt,
      delivered: issued.delivered,
    };
  });
}

/**
 * Does this challenge's destination hash name the address we are about to mark?
 *
 * Hashed with the same pepper `issueOtp` used, over the same canonical form, so the comparison is
 * the one the challenge was created with. `timingSafeEqual` is not needed — both sides are
 * server-derived and neither is a secret the caller is guessing — but a length guard is, because
 * `Buffer.equals` on differing lengths is simply false and a malformed row should not throw.
 */
function destinationMatches(
  deps: ContactVerifyDeps,
  challengeHash: Uint8Array,
  channel: ContactChannel,
  address: string,
): boolean {
  const expected = hashDestination(deps.otpHasher, canonical(channel, address) ?? address);
  return Buffer.from(challengeHash).equals(expected);
}

export type ConfirmContactVerificationResult =
  | { outcome: 'VERIFIED'; verificationLevel: string; maskedDestination: string }
  /** Somebody else proved this address between the start and this confirm. */
  | { outcome: 'TAKEN' }
  | Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;

export async function confirmContactVerification(
  deps: ContactVerifyDeps,
  input: {
    userId: string;
    channel: ContactChannel;
    challengeId: string;
    code: string;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<ConfirmContactVerificationResult> {
  return deps.db.transaction(async (tx): Promise<ConfirmContactVerificationResult> => {
    const target = await currentContact(tx, input.userId, input.channel);

    /** Ids and a reason, never an address or a code — the shape `auditFailure` uses in F-045. */
    const refuse = async (
      result: ConfirmContactVerificationResult,
      reason: string,
    ): Promise<ConfirmContactVerificationResult> => {
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.OTP_FAILED,
        outcome: 'FAILURE',
        actorType: 'USER',
        actorUserId: input.userId,
        subjectUserId: input.userId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: { challengeId: input.challengeId, channel: input.channel, reason },
      });
      return result;
    };

    // `consumeOtp` charges the attempt BEFORE comparing, so this transaction must COMMIT on a wrong
    // code as well as a right one — returning early here is correct, throwing would refund the guess.
    const verified = await consumeOtp(tx, otpDeps(deps), {
      challengeId: input.challengeId,
      code: input.code,
    });
    if (verified.outcome !== 'VERIFIED') return refuse(verified, verified.outcome);

    // The challenge is bound to the caller and the channel. Another account's code, or this
    // account's email code offered as a phone code, proves nothing about the row we are about to
    // mark — and `consumeOtp` alone would have accepted either, because it only knows the id.
    if (verified.challenge.userId !== input.userId || verified.challenge.purpose !== PURPOSE[input.channel]) {
      return refuse({ outcome: 'UNKNOWN' }, 'challenge_not_for_caller_or_channel');
    }

    // A spent code with nothing to mark is not a verification. `start` always leaves a row, so this
    // is the deleted-in-between case rather than anything a caller can arrange.
    if (!target) return refuse({ outcome: 'UNKNOWN' }, 'no_contact_row');

    // And bound to the DESTINATION, which is the one that matters.
    //
    // `start` replaces the unproven row, but `issueOtp` only supersedes challenges with the same
    // destination hash — so starting twice with two addresses leaves the first code live while the
    // row holds the second. Without this, a caller could spend the code delivered to an address
    // they control and have it mark an address they do not: a stranger's email verified on their
    // account, and — because `user_emails_verified_unique` is global — permanently unusable by its
    // real owner, who also loses the login and password-reset paths that resolve through it.
    //
    // Checked AFTER `consumeOtp` on purpose: the attempt is charged either way, so this is not a
    // free oracle for "is this challenge still live".
    if (!destinationMatches(deps, verified.challenge.destinationHash, input.channel, target.address)) {
      return refuse({ outcome: 'UNKNOWN' }, 'code_was_sent_to_a_different_address');
    }

    try {
      if (input.channel === 'EMAIL') {
        await markEmailVerified(tx, {
          userId: input.userId,
          emailId: target.id,
          source: 'OTP',
        });
      } else {
        await markPhoneVerified(tx, { userId: input.userId, phoneId: target.id });
        // Deferred from `start`: `user_phones_change_state_unproven` refuses a primary row that is
        // not yet verified, so the pointer can only move once the code is spent.
        await makePhonePrimary(tx, input.userId, target.id);
      }
    } catch (error) {
      if (error instanceof ContactTakenError) {
        return refuse({ outcome: 'TAKEN' }, 'address_proven_by_another_account');
      }
      throw error;
    }

    // §S10: this route changes `verification_level` and moves `users.primary_phone_id`, so it leaves
    // the same trail the other route that proves a channel does (`auth.service.ts`).
    await writeAudit(tx, {
      action: input.channel === 'EMAIL' ? AUDIT_ACTIONS.EMAIL_VERIFIED : AUDIT_ACTIONS.PHONE_VERIFIED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { challengeId: input.challengeId, contactId: target.id, via: 'F-081' },
    });

    const progress = await applyVerificationProgress(tx, input.userId);

    return {
      outcome: 'VERIFIED',
      verificationLevel: progress.verificationLevel,
      maskedDestination: maskFor(input.channel, target.address),
    };
  });
}

/** One primary per user is a partial unique index, so the old flag is cleared in the same transaction. */
async function makePhonePrimary(tx: Tx, userId: string, phoneId: string): Promise<void> {
  await tx
    .update(userPhones)
    .set({ isPrimary: false })
    .where(and(eq(userPhones.userId, userId), eq(userPhones.isPrimary, true)));
  await tx.update(userPhones).set({ isPrimary: true }).where(eq(userPhones.id, phoneId));
  await tx.update(users).set({ primaryPhoneId: phoneId }).where(eq(users.id, userId));
}

const deleteContact = async (tx: Tx, channel: ContactChannel, id: string): Promise<void> => {
  if (channel === 'EMAIL') {
    await tx.update(users).set({ primaryEmailId: null }).where(eq(users.primaryEmailId, id));
    await tx.delete(userEmails).where(eq(userEmails.id, id));
    return;
  }
  await tx.update(users).set({ primaryPhoneId: null }).where(eq(users.primaryPhoneId, id));
  await tx.delete(userPhones).where(eq(userPhones.id, id));
};

async function attachEmailRow(tx: Tx, userId: string, email: string) {
  const row = await attachEmail(tx, { userId, email, makePrimary: true });
  return { id: row.emailId, address: row.email, verified: false };
}

async function attachPhoneRow(tx: Tx, userId: string, phone: string) {
  // NOT primary: `user_phones_change_state_unproven` refuses a primary row that is not yet verified.
  // The pointer moves when the code is confirmed.
  const row = await attachPhone(tx, { userId, phone, makePrimary: false });
  return { id: row.phoneId, address: row.phoneE164, verified: false };
}
