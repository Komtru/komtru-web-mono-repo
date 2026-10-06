// Email and phone rows, and the two status machines a verified channel drives (M1 §2, §5.4, §9.1).
//
// T-030 left this module one standing rule and this file is where it is kept: `user_emails.email`
// and `user_emails.email_normal` are written from ONE `normaliseEmail()` call, and
// `user_phones.phone_e164` from `normalisePhone()`. The database enforces E.164 with a CHECK but
// cannot recompute `email_normal`, so a caller that writes an unnormalised value silently defeats
// `user_emails_verified_unique` — and two people then both "own" one inbox.
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../../platform/events/publish.js';
import { publish } from '../../../platform/events/publish.js';
import {
  DEFAULT_COUNTRY,
  normaliseEmail,
  normalisePhone,
  phoneReverifyAfter,
} from '../../../platform/identifiers.js';
import {
  identityEmailVerifiedEvent,
  identityPhoneVerifiedEvent,
  identityUserStatusChangedEvent,
  identityVerificationLevelChangedEvent,
} from '../domain/events.js';
import { userEmails, userPhones } from '../infrastructure/postgres/schema/contacts.js';
import { users } from '../infrastructure/postgres/schema/users.js';

export type ContactChannel = 'EMAIL' | 'PHONE';

/**
 * Somebody else has already PROVEN they control this address.
 *
 * Raised from the 23505 on the partial unique index rather than from a read-then-write check: the
 * index is the only thing that holds under two concurrent verifications of the same address, and a
 * service that looked first would hand one of them a 500 instead of an answer.
 */
export class ContactTakenError extends Error {
  constructor(readonly channel: ContactChannel) {
    super(`This ${channel.toLowerCase()} is already verified on another account`);
    this.name = 'ContactTakenError';
  }
}

/** The caller gave something `normalisePhone` or `normaliseEmail` cannot make canonical. */
export class ContactInvalidError extends Error {
  constructor(readonly channel: ContactChannel) {
    super(`This ${channel.toLowerCase()} is not a valid address`);
    this.name = 'ContactInvalidError';
  }
}

const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === UNIQUE_VIOLATION &&
  String((error as { constraint?: string }).constraint ?? '').includes(constraint);

export interface AttachedEmail {
  emailId: string;
  email: string;
  emailNormal: string;
}

export interface AttachedPhone {
  phoneId: string;
  phoneE164: string;
}

/**
 * Adds an email row. `makePrimary` also moves `users.primary_email_id`, which T-030 deferred here:
 * the pointer and the `is_primary` flag must name the same row, and the only way to guarantee that
 * is for one function to set both.
 */
export async function attachEmail(
  tx: Tx,
  input: { userId: string; email: string; makePrimary?: boolean },
): Promise<AttachedEmail> {
  let normalised;
  try {
    normalised = normaliseEmail(input.email);
  } catch {
    throw new ContactInvalidError('EMAIL');
  }

  const makePrimary = input.makePrimary ?? false;
  if (makePrimary) {
    // One primary per user is a partial unique index; clear the old one in the same transaction or
    // the insert below trips it.
    await tx
      .update(userEmails)
      .set({ isPrimary: false })
      .where(and(eq(userEmails.userId, input.userId), eq(userEmails.isPrimary, true)));
  }

  const row = (
    await tx
      .insert(userEmails)
      .values({
        userId: input.userId,
        email: normalised.email,
        emailNormal: normalised.emailNormal,
        isPrimary: makePrimary,
      })
      .returning({ id: userEmails.id })
  )[0];
  if (!row) throw new Error('attachEmail: the insert returned no row');

  if (makePrimary) {
    await tx
      .update(users)
      .set({ primaryEmailId: row.id, updatedAt: sql`now()` })
      .where(eq(users.id, input.userId));
  }

  return { emailId: row.id, email: normalised.email, emailNormal: normalised.emailNormal };
}

export async function attachPhone(
  tx: Tx,
  input: { userId: string; phone: string; makePrimary?: boolean },
): Promise<AttachedPhone> {
  const normalised = normalisePhone(input.phone);
  if (!normalised) throw new ContactInvalidError('PHONE');

  const makePrimary = input.makePrimary ?? false;
  if (makePrimary) {
    await tx
      .update(userPhones)
      .set({ isPrimary: false })
      .where(and(eq(userPhones.userId, input.userId), eq(userPhones.isPrimary, true)));
  }

  const row = (
    await tx
      .insert(userPhones)
      .values({
        userId: input.userId,
        phoneE164: normalised.phoneE164,
        // `country_code` is NOT NULL while `normalisePhone` leaves it off a non-geographic number
        // (+800 and friends). Defaulting to NG is wrong for those, and they cannot receive an SMS
        // OTP in the first place, so the column records the only answer we have (T-030's deferral).
        countryCode: normalised.countryCode ?? DEFAULT_COUNTRY,
        isPrimary: makePrimary,
      })
      .returning({ id: userPhones.id })
  )[0];
  if (!row) throw new Error('attachPhone: the insert returned no row');

  if (makePrimary) {
    await tx
      .update(users)
      .set({ primaryPhoneId: row.id, updatedAt: sql`now()` })
      .where(eq(users.id, input.userId));
  }

  return { phoneId: row.id, phoneE164: normalised.phoneE164 };
}

/**
 * Who provably owns this address. VERIFIED only, and that is the whole point: an unverified row is
 * not unique — two accounts may each claim the same unproven address — so resolving a login or a
 * password reset through one would be ambiguous at best and an account takeover at worst.
 */
export async function findUserByVerifiedEmail(
  tx: Tx,
  emailNormal: string,
): Promise<{ userId: string; emailId: string } | null> {
  const row = (
    await tx
      .select({ userId: userEmails.userId, emailId: userEmails.id })
      .from(userEmails)
      .where(and(eq(userEmails.emailNormal, emailNormal), isNotNull(userEmails.verifiedAt)))
      .limit(1)
  )[0];
  return row ?? null;
}

export async function findUserByVerifiedPhone(
  tx: Tx,
  phoneE164: string,
): Promise<{ userId: string; phoneId: string } | null> {
  const row = (
    await tx
      .select({ userId: userPhones.userId, phoneId: userPhones.id })
      .from(userPhones)
      .where(and(eq(userPhones.phoneE164, phoneE164), isNotNull(userPhones.verifiedAt)))
      .limit(1)
  )[0];
  return row ?? null;
}

export interface PrimaryContact {
  id: string;
  /** The deliverable form: `user_emails.email`, not `email_normal`, and `phone_e164`. */
  address: string;
  verified: boolean;
}

export interface PrimaryContacts {
  email: PrimaryContact | null;
  phone: PrimaryContact | null;
}

/**
 * The primary contact of each channel, verified or not. Unverified is included because the OTP that
 * makes an address verified has to be sent TO it — demanding verification first is a cycle no user
 * can break.
 */
export async function primaryContacts(tx: Tx, userId: string): Promise<PrimaryContacts> {
  const emails = await tx
    .select({ id: userEmails.id, address: userEmails.email, verifiedAt: userEmails.verifiedAt })
    .from(userEmails)
    .where(and(eq(userEmails.userId, userId), eq(userEmails.isPrimary, true)))
    .limit(1);
  const phones = await tx
    .select({ id: userPhones.id, address: userPhones.phoneE164, verifiedAt: userPhones.verifiedAt })
    .from(userPhones)
    .where(and(eq(userPhones.userId, userId), eq(userPhones.isPrimary, true)))
    .limit(1);

  const shape = (row?: { id: string; address: string; verifiedAt: Date | null }): PrimaryContact | null =>
    row ? { id: row.id, address: row.address, verified: row.verifiedAt !== null } : null;

  return { email: shape(emails[0]), phone: shape(phones[0]) };
}

export async function markEmailVerified(
  tx: Tx,
  input: { userId: string; emailId: string; source: string },
): Promise<void> {
  let updated: { id: string }[];
  try {
    // A SAVEPOINT, because the 23505 below is a LIVE constraint violation and one of those aborts
    // the whole Postgres transaction. Without it the caller's "clean 409" would arrive on a
    // transaction whose COMMIT is silently a ROLLBACK: the OTP attempt charged a moment earlier
    // would be refunded — so the loser could replay the same code without limit — and the §S10
    // audit row for the conflict would never be written.
    updated = await tx.transaction((sp) =>
      sp
        .update(userEmails)
        .set({ verifiedAt: sql`now()`, verificationSource: input.source })
        .where(
          and(
            eq(userEmails.id, input.emailId),
            eq(userEmails.userId, input.userId),
            isNull(userEmails.verifiedAt),
          ),
        )
        .returning({ id: userEmails.id }),
    );
    // Nothing updated means it was already verified (a replayed verify), which is not an error.
    if (!updated.length) return;
  } catch (error) {
    if (isUniqueViolation(error, 'user_emails_verified_unique')) throw new ContactTakenError('EMAIL');
    throw error;
  }

  await publish(tx, identityEmailVerifiedEvent, {
    payload: { userId: input.userId, emailId: input.emailId },
    aggregateType: 'identity.user',
    aggregateId: input.userId,
    actor: { type: 'CONSUMER', id: input.userId },
  });
}

export async function markPhoneVerified(tx: Tx, input: { userId: string; phoneId: string }): Promise<void> {
  try {
    const updated = await tx
      .update(userPhones)
      .set({
        verifiedAt: sql`now()`,
        // M1 D4: SIM recycling in Nigeria is real, so a verified number has a shelf life.
        reverifyAfter: phoneReverifyAfter(new Date()),
      })
      .where(
        and(
          eq(userPhones.id, input.phoneId),
          eq(userPhones.userId, input.userId),
          isNull(userPhones.verifiedAt),
        ),
      )
      .returning({ id: userPhones.id });
    if (!updated.length) return;
  } catch (error) {
    if (isUniqueViolation(error, 'user_phones_verified_unique')) throw new ContactTakenError('PHONE');
    throw error;
  }

  await publish(tx, identityPhoneVerifiedEvent, {
    payload: { userId: input.userId, phoneId: input.phoneId },
    aggregateType: 'identity.user',
    aggregateId: input.userId,
    actor: { type: 'CONSUMER', id: input.userId },
  });
}

/**
 * M1 §9.1 and §2, which are two different thresholds and are constantly confused:
 *
 *   - `status` reaches ACTIVE on the FIRST verified channel. A phone-first user should be able to
 *     browse and be tagged immediately.
 *   - `verification_level` reaches CONTACT_VERIFIED only when BOTH are verified. That is what
 *     unlocks funding a trade.
 *
 * Levels 2–4 are M6's and are never computed here (§2's ownership split), so a user already past
 * CONTACT_VERIFIED is left alone.
 */
export async function applyVerificationProgress(
  tx: Tx,
  userId: string,
): Promise<{ status: string; verificationLevel: string }> {
  const user = (
    await tx
      .select({ status: users.status, verificationLevel: users.verificationLevel })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
  )[0];
  if (!user) throw new Error(`applyVerificationProgress: no user ${userId}`);

  const verified = await tx
    .select({ emailAt: userEmails.verifiedAt })
    .from(userEmails)
    .where(and(eq(userEmails.userId, userId), isNotNull(userEmails.verifiedAt)))
    .limit(1);
  const verifiedPhone = await tx
    .select({ phoneAt: userPhones.verifiedAt })
    .from(userPhones)
    .where(and(eq(userPhones.userId, userId), isNotNull(userPhones.verifiedAt)))
    .limit(1);

  const hasEmail = verified.length > 0;
  const hasPhone = verifiedPhone.length > 0;

  let status = user.status;
  let verificationLevel = user.verificationLevel;

  if (status === 'PENDING_VERIFICATION' && (hasEmail || hasPhone)) {
    status = 'ACTIVE';
    await tx
      .update(users)
      .set({ status: 'ACTIVE', statusChangedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, userId));
    await publish(tx, identityUserStatusChangedEvent, {
      payload: {
        userId,
        from: user.status,
        to: 'ACTIVE',
        reason: hasPhone ? 'phone_verified' : 'email_verified',
      },
      aggregateType: 'identity.user',
      aggregateId: userId,
      actor: { type: 'CONSUMER', id: userId },
    });
  }

  if (hasEmail && hasPhone && verificationLevel === 'UNVERIFIED') {
    verificationLevel = 'CONTACT_VERIFIED';
    await tx
      .update(users)
      .set({ verificationLevel: 'CONTACT_VERIFIED', updatedAt: sql`now()` })
      .where(eq(users.id, userId));
    await publish(tx, identityVerificationLevelChangedEvent, {
      payload: { userId, from: 'UNVERIFIED', to: 'CONTACT_VERIFIED' },
      aggregateType: 'identity.user',
      aggregateId: userId,
      actor: { type: 'CONSUMER', id: userId },
    });
  }

  return { status, verificationLevel };
}
