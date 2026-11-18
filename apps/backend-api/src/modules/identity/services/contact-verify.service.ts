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
import { and, desc, eq, isNotNull } from 'drizzle-orm';
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

/** The row this channel would prove: the primary first, then the newest, mirroring what `/me` reports. */
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
      .orderBy(desc(userEmails.isPrimary), desc(userEmails.verifiedAt))
      .limit(1);
    return row ? { id: row.id, address: row.address, verified: row.verifiedAt !== null } : undefined;
  }

  const [row] = await tx
    .select({ id: userPhones.id, address: userPhones.phoneE164, verifiedAt: userPhones.verifiedAt })
    .from(userPhones)
    .where(eq(userPhones.userId, userId))
    .orderBy(desc(userPhones.isPrimary), desc(userPhones.verifiedAt))
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

    return {
      outcome: 'STARTED',
      challengeId: issued.challengeId,
      maskedDestination: maskFor(input.channel, target.address),
      expiresAt: issued.expiresAt,
      delivered: issued.delivered,
    };
  });
}

export type ConfirmContactVerificationResult =
  | { outcome: 'VERIFIED'; verificationLevel: string; maskedDestination: string }
  /** Somebody else proved this address between the start and this confirm. */
  | { outcome: 'TAKEN' }
  | Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;

export async function confirmContactVerification(
  deps: ContactVerifyDeps,
  input: { userId: string; channel: ContactChannel; challengeId: string; code: string },
): Promise<ConfirmContactVerificationResult> {
  return deps.db.transaction(async (tx): Promise<ConfirmContactVerificationResult> => {
    const target = await currentContact(tx, input.userId, input.channel);

    // `consumeOtp` charges the attempt BEFORE comparing, so this transaction must COMMIT on a wrong
    // code as well as a right one — returning early here is correct, throwing would refund the guess.
    const verified = await consumeOtp(tx, otpDeps(deps), {
      challengeId: input.challengeId,
      code: input.code,
    });
    if (verified.outcome !== 'VERIFIED') return verified;

    // The challenge is bound to BOTH the caller and the channel. Another account's code, or this
    // account's email code offered as a phone code, proves nothing about the row we are about to
    // mark — and `consumeOtp` alone would have accepted either, because it only knows the id.
    if (verified.challenge.userId !== input.userId || verified.challenge.purpose !== PURPOSE[input.channel]) {
      return { outcome: 'UNKNOWN' };
    }

    // A spent code with nothing to mark is not a verification. `start` always leaves a row, so this
    // is the deleted-in-between case rather than anything a caller can arrange.
    if (!target) return { outcome: 'UNKNOWN' };

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
      if (error instanceof ContactTakenError) return { outcome: 'TAKEN' };
      throw error;
    }

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
