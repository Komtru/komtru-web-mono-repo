// Registration, challenge verification and terms acceptance: the orchestration M1 §9.3 draws.
//
// Every one of these is a single transaction, because every one of them is several rows plus an
// audit row plus an outbox event, and a partial result is always worse than none: a user with a
// contact row and no account, an account with no audit trail, an OTP whose event never went out.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/index.js';
import { isUniqueViolation } from '../../../db/errors.js';
import { publish, type Tx } from '../../../platform/events/publish.js';
import {
  generatePublicId,
  maskEmail,
  maskPhone,
  normaliseEmail,
  normalisePhone,
} from '../../../platform/identifiers.js';
import type { Logger } from '../../../platform/logger.js';
import type { HmacHasher } from '../../../platform/crypto/hmac.js';
import { identityDeviceSignedInEvent, identityUserRegisteredEvent } from '../domain/events.js';
import { OTP_DESTINATION_DOMAIN } from '../domain/otp/challenge.js';
import { nextStep, type NextStep, type OnboardingState } from '../domain/registration.js';
import { termsUpToDate, type TermsState } from '../domain/terms.js';
import { users, userProfiles } from '../infrastructure/postgres/schema/users.js';
import { userCredentials } from '../infrastructure/postgres/schema/credentials.js';
import { AUDIT_ACTIONS, writeAudit } from './audit.service.js';
import {
  ContactInvalidError,
  ContactTakenError,
  applyVerificationProgress,
  attachEmail,
  attachPhone,
  findUserByVerifiedEmail,
  findUserByVerifiedPhone,
  markEmailVerified,
  markPhoneVerified,
  primaryContacts,
} from './contact.service.js';
import type { CredentialDeps } from './credential.service.js';
import { setPassword, validatePassword } from './credential.service.js';
import { deviceLabel, signInLocation, upsertDevice } from './device.service.js';
import {
  consumeOtp,
  findLiveChallenge,
  issueOtp,
  issueProofToken,
  type OtpChannel,
  type OtpDeps,
  type VerifyOutcome,
} from './otp.service.js';
import { claimInvitationsForDestination, resolveInvitationToken } from './invitation.service.js';
import { createSession, type IssuedSession, type SessionDeps } from './session.service.js';
import type { PasswordRejection } from '../domain/credential/policy.js';

/**
 * Everything the three controllers need, assembled once in `createIdentityAuth`.
 *
 * `OtpDeps.hasher` is an `HmacHasher` and `CredentialDeps.hasher` is a `PasswordHasher`, so they
 * cannot share a field name — the OTP one is `otpHasher` here and the password one keeps `hasher`,
 * which is what `verifyAndRecord` and `setPassword` already expect.
 */
export interface AccountDeps extends SessionDeps, CredentialDeps {
  otpHasher: HmacHasher;
  logger: Logger;
  terms: { termsVersion: string; privacyVersion: string };
  /** `IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL`: also email a phone OTP, never instead of the SMS. */
  mirrorPhoneOtpToEmail: boolean;
}

const otpDeps = (deps: AccountDeps): OtpDeps => ({ hasher: deps.otpHasher, logger: deps.logger });

export interface PublicUser {
  id: string;
  publicId: string;
  username: string | null;
  displayName: string | null;
  status: string;
  verificationLevel: string;
}

export interface RegisterInput {
  channel: 'EMAIL' | 'PHONE';
  email?: string;
  phone?: string;
  password?: string;
  fullName?: string;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion?: string;
  marketingOptIn: boolean;
  /** §10.1, T-035. Binds the signup to a party invitation; the TRADE binds on claim-on-verify. */
  invitationToken?: string;
  deviceFingerprint?: string;
  ip: string | null;
  userAgent: string | null;
}

export type RegisterResult =
  | {
      outcome: 'REGISTERED';
      userId: string;
      publicId: string;
      status: string;
      challengeId: string;
      expiresAt: Date;
      nextStep: NextStep;
      maskedDestination: string;
      /**
       * False when §S4's per-destination budget was already spent, so nothing was sent. The account
       * exists and the challenge is real; the client must say "we could not send a code right now"
       * rather than "check your messages", or the user waits for an SMS that never comes.
       */
      delivered: boolean;
    }
  /** Somebody has already PROVEN they control this address. */
  | { outcome: 'TAKEN' }
  | { outcome: 'INVALID_CONTACT'; channel: 'EMAIL' | 'PHONE' }
  | { outcome: 'REJECTED'; rejection: PasswordRejection; message: string }
  | { outcome: 'STALE_TERMS' }
  /** The `invitationToken` names nothing live. Answered rather than ignored: a client that sent a
   * stale link and got a plain 201 would have an account that never binds to the trade it was
   * invited to, and no way to find out. */
  | { outcome: 'INVALID_INVITATION' };

/** A display name is what the user typed; the split is a convenience, never a legal name (§5.3). */
const splitName = (fullName: string): { firstName: string; lastName: string | null } => {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? fullName.trim();
  return { firstName, lastName: parts.length > 1 ? parts.slice(1).join(' ') : null };
};

/**
 * `users.public_id` is six random characters, so a collision is rare and not impossible, and T-030
 * left the retry to whoever first inserted one. Three attempts over ~30 bits is generous.
 */
const PUBLIC_ID_ATTEMPTS = 3;

export async function register(db: Db, deps: AccountDeps, input: RegisterInput): Promise<RegisterResult> {
  // Before anything is written: a client that accepted last year's Terms has not given a lawful
  // basis for this year's processing, and silently recording the version it sent would make the
  // NDPA §15 column a record of what the client claimed rather than of what we published.
  if (
    input.acceptedTermsVersion !== deps.terms.termsVersion ||
    (input.acceptedPrivacyVersion ?? input.acceptedTermsVersion) !== deps.terms.privacyVersion
  ) {
    return { outcome: 'STALE_TERMS' };
  }

  // Canonicalise outside the transaction: a malformed address is a 422 with nothing written, and
  // there is no reason to open a transaction to find that out.
  const contact = resolveRegistrationContact(input);
  if (!contact) {
    return { outcome: 'INVALID_CONTACT', channel: input.channel };
  }

  // The breach check is a three-second HTTP call. Running it here rather than inside the
  // transaction is what stops a Postgres connection, and the row locks it holds, from waiting on a
  // third party's availability.
  if (input.password !== undefined) {
    const verdict = await validatePassword(deps, input.password, [contact.destination, contact.raw]);
    if (!verdict.ok) {
      return { outcome: 'REJECTED', rejection: verdict.rejection, message: verdict.message };
    }
  }

  return db.transaction(async (tx): Promise<RegisterResult> => {
    // Inside the transaction, so the check and the insert cannot be separated by somebody else's
    // verification. It is not the real guard — `user_emails_verified_unique` is, and
    // `markEmailVerified` turns its 23505 into a 409 — but it is what makes the common case a
    // clean answer rather than a constraint violation.
    const owner =
      contact.channel === 'EMAIL'
        ? await findUserByVerifiedEmail(tx, contact.destination)
        : await findUserByVerifiedPhone(tx, contact.destination);
    if (owner) return { outcome: 'TAKEN' };

    // Resolved before anything is written, so a dead link costs a 422 and no row. Note what it does
    // NOT do: it does not pre-claim, and it does not restrict which channel may be registered. §8.5
    // rule 6 is that the invitation binds only to the channel actually verified, and a token that
    // could override that would be the link-forwarding attack the rule exists to stop.
    const invitation = input.invitationToken ? await resolveInvitationToken(tx, input.invitationToken) : null;
    if (input.invitationToken && !invitation) return { outcome: 'INVALID_INVITATION' };

    const user = await insertUser(tx, input);

    try {
      if (contact.channel === 'EMAIL') {
        await attachEmail(tx, { userId: user.id, email: contact.raw, makePrimary: true });
      } else {
        await attachPhone(tx, { userId: user.id, phone: contact.raw, makePrimary: true });
      }
    } catch (error) {
      if (error instanceof ContactInvalidError) {
        return { outcome: 'INVALID_CONTACT', channel: error.channel };
      }
      throw error;
    }

    if (input.fullName) {
      const { firstName, lastName } = splitName(input.fullName);
      await tx
        .insert(userProfiles)
        .values({ userId: user.id, displayName: input.fullName.trim(), firstName, lastName });
    }

    if (input.password !== undefined) {
      const result = await setPassword(tx, deps, { userId: user.id, password: input.password });
      // `validatePassword` already passed and the account is seconds old, so REUSED is impossible
      // and the policy cannot have changed its mind. Reaching here is a bug, not a user error.
      if (!result.ok)
        throw new Error(`register: setPassword refused a validated password (${result.rejection})`);
    }

    const challenge = await issueOtp(tx, otpDeps(deps), {
      userId: user.id,
      purpose: 'REGISTRATION',
      channels: contact.channel === 'EMAIL' ? ['EMAIL'] : await registrationChannels(deps),
      destination: contact.destination,
      ip: input.ip,
    });

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.REGISTERED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: user.id,
      subjectUserId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: {
        channel: input.channel,
        challengeId: challenge.challengeId,
        termsVersion: deps.terms.termsVersion,
        ...(invitation ? { invitationId: invitation.id } : {}),
      },
    });

    await publish(tx, identityUserRegisteredEvent, {
      payload: {
        userId: user.id,
        publicId: user.publicId,
        registeredVia: `register:${input.channel}`,
        channel: input.channel,
        ip: input.ip,
        invitationId: invitation?.id ?? null,
      },
      aggregateType: 'identity.user',
      aggregateId: user.id,
      actor: { type: 'CONSUMER', id: user.id },
    });

    return {
      outcome: 'REGISTERED',
      userId: user.id,
      publicId: user.publicId,
      status: 'PENDING_VERIFICATION',
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      nextStep: contact.channel === 'EMAIL' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE',
      maskedDestination: contact.masked,
      delivered: challenge.delivered,
    };
  });
}

interface RegistrationContact {
  channel: 'EMAIL' | 'PHONE';
  /** What the user typed, for `attachEmail`/`attachPhone` to normalise once and once only. */
  raw: string;
  /** The canonical form the OTP challenge is keyed on. */
  destination: string;
  masked: string;
}

/** Null when the address is not one `normaliseEmail`/`normalisePhone` can make canonical. */
function resolveRegistrationContact(input: RegisterInput): RegistrationContact | null {
  if (input.channel === 'EMAIL') {
    if (!input.email) return null;
    try {
      const normalised = normaliseEmail(input.email);
      return {
        channel: 'EMAIL',
        raw: input.email,
        destination: normalised.emailNormal,
        masked: maskEmail(normalised.email),
      };
    } catch {
      return null;
    }
  }

  if (!input.phone) return null;
  const normalised = normalisePhone(input.phone);
  if (!normalised) return null;
  return {
    channel: 'PHONE',
    raw: input.phone,
    destination: normalised.phoneE164,
    masked: maskPhone(normalised.phoneE164),
  };
}

/**
 * A registration phone code has nowhere to be mirrored — the account has no email yet — so this is
 * always `['SMS']`. It is a function so the mirror flag has one place to be read from, beside
 * `deliveryChannels` below, rather than two literals that drift apart.
 */
function registrationChannels(_deps: AccountDeps): Promise<OtpChannel[]> {
  return Promise.resolve(['SMS']);
}

async function insertUser(tx: Tx, input: RegisterInput): Promise<{ id: string; publicId: string }> {
  for (let attempt = 0; attempt < PUBLIC_ID_ATTEMPTS; attempt += 1) {
    const publicId = generatePublicId();
    try {
      // A SAVEPOINT, not a bare try/catch. A constraint violation puts the whole Postgres
      // transaction in the aborted state, so a retry INSERT issued after one fails with 25P02
      // ("current transaction is aborted") rather than with another 23505 — the retry would be
      // dead code and a collision would be a 500. drizzle's nested `transaction` emits the
      // savepoint and rolls back to it.
      return await tx.transaction(async (sp) => {
        const row = (
          await sp
            .insert(users)
            .values({
              publicId,
              status: 'PENDING_VERIFICATION',
              registeredVia: `register:${input.channel}`,
              registrationIp: input.ip,
              // NDPA §15: the version, the moment and the address it was given from.
              termsVersion: input.acceptedTermsVersion,
              privacyVersion: input.acceptedPrivacyVersion ?? input.acceptedTermsVersion,
              consentRecordedAt: sql`now()`,
              consentIp: input.ip,
              marketingOptIn: input.marketingOptIn,
              ...(input.marketingOptIn ? { marketingOptInAt: sql`now()` } : {}),
            })
            .returning({ id: users.id, publicId: users.publicId })
        )[0];
        if (!row) throw new Error('register: the insert returned no row');
        return row;
      });
    } catch (error) {
      // Through `pgErrorIn`, not off the top-level object: drizzle wraps the driver's error, so a
      // direct `error.code` read here saw undefined and this retry never ran (db/errors.ts).
      if (!isUniqueViolation(error, 'public_id')) throw error;
      // Six characters of Crockford base32 is ~30 bits, so birthday collisions start showing up in
      // the tens of thousands of accounts. T-030 left the retry to the first inserter; this is it.
    }
  }
  throw new Error('register: could not allocate a unique public id');
}

export interface VerifyChallengeInput {
  challengeId: string;
  code: string;
  deviceFingerprint?: string;
  ip: string | null;
  userAgent: string | null;
}

export type ChallengeResult =
  | { outcome: 'SESSION'; session: IssuedSession; nextStep: NextStep; user: PublicUser }
  | { outcome: 'RESET_TOKEN'; resetToken: string; expiresAt: Date }
  | { outcome: 'TAKEN' }
  | Exclude<VerifyOutcome, { outcome: 'VERIFIED' }>;

/**
 * Verifies an OTP and does whatever the challenge's purpose says next.
 *
 * The transaction COMMITS on a wrong code as well as on a right one — `consumeOtp` charges the
 * attempt before it compares, and rolling that back would hand a caller unlimited free guesses by
 * cutting the connection. The controller raises the 422 from the returned outcome, outside the
 * transaction.
 */
export async function verifyChallenge(
  db: Db,
  deps: AccountDeps,
  input: VerifyChallengeInput,
): Promise<ChallengeResult> {
  return db.transaction(async (tx): Promise<ChallengeResult> => {
    const verified = await consumeOtp(tx, otpDeps(deps), {
      challengeId: input.challengeId,
      code: input.code,
    });

    if (verified.outcome !== 'VERIFIED') {
      // Worth recording: a burst of these on one challenge is what Risk wants to see.
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.OTP_FAILED,
        outcome: 'FAILURE',
        actorType: 'ANONYMOUS',
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { challengeId: input.challengeId, reason: verified.outcome },
      });
      return verified;
    }

    const { challenge } = verified;

    // A password reset stops here: the OTP proved the channel, and the caller now exchanges the
    // token it returns for a new password. It must NOT mint a session — a reset flow that signs the
    // holder in would turn "I know the code" into "I am signed in" without a password at all.
    if (challenge.purpose === 'PASSWORD_RESET') {
      const proof = await issueProofToken(tx, otpDeps(deps), challenge);
      await writeAudit(tx, {
        action: AUDIT_ACTIONS.OTP_VERIFIED,
        outcome: 'SUCCESS',
        actorType: challenge.userId ? 'USER' : 'ANONYMOUS',
        actorUserId: challenge.userId,
        subjectUserId: challenge.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { challengeId: challenge.id, purpose: challenge.purpose },
      });
      return { outcome: 'RESET_TOKEN', resetToken: proof.token, expiresAt: proof.expiresAt };
    }

    // Every other purpose proves a channel. A challenge with no user cannot: it is the
    // forgot-password decoy, and it should look to the caller exactly like a wrong code.
    if (!challenge.userId) return { outcome: 'WRONG_CODE', attemptsRemaining: 0 };
    const userId = challenge.userId;

    const contacts = await primaryContacts(tx, userId);
    // The challenge names a CHANNEL, so the contact it proves is that channel's primary — and
    // nothing else. There is deliberately no fallback between the two: an `else if (contacts.phone)`
    // on an EMAIL challenge would mark a phone number verified on the strength of a code sent to an
    // inbox, which proves nothing about the phone.
    const contact = challenge.channel === 'EMAIL' ? contacts.email : contacts.phone;
    if (!contact) return { outcome: 'UNKNOWN' };

    // And it must be the SAME contact the code was sent to. `destination_hash` is an HMAC, so it
    // cannot be read back — but it can be recomputed from the row we are about to mark verified and
    // compared. Without this, a challenge issued for contact A verifies whichever contact is
    // primary at the moment the code is presented, which is a verification bypass as soon as a
    // later ticket adds a route that changes the primary (T-036, T-039).
    const canonical =
      challenge.channel === 'EMAIL' ? normaliseEmail(contact.address).emailNormal : contact.address;
    if (!deps.otpHasher.matches(OTP_DESTINATION_DOMAIN, canonical, Buffer.from(challenge.destinationHash))) {
      deps.logger.warn(
        { userId, challengeId: challenge.id },
        'identity: the verified code was issued for a different contact than the current primary',
      );
      return { outcome: 'UNKNOWN' };
    }

    try {
      if (challenge.channel === 'EMAIL') {
        await markEmailVerified(tx, { userId, emailId: contact.id, source: 'otp' });
      } else {
        await markPhoneVerified(tx, { userId, phoneId: contact.id });
      }
    } catch (error) {
      if (error instanceof ContactTakenError) return { outcome: 'TAKEN' };
      throw error;
    }

    await applyVerificationProgress(tx, userId);

    // §8.5 steps 5–6. `canonical` is the value the destination_hash comparison above was made from,
    // so the claim matches on exactly the address this code proved — not on the token, which anyone
    // can forward, and not on whatever contact happens to be primary.
    await claimInvitationsForDestination(
      tx,
      { hasher: deps.otpHasher },
      { userId, channel: challenge.channel === 'EMAIL' ? 'EMAIL' : 'PHONE', canonical },
    );

    const device = await upsertDevice(tx, {
      userId,
      fingerprint: input.deviceFingerprint ?? null,
      ip: input.ip,
    });

    const session = await createSession(tx, deps, {
      userId,
      // The only scope this ticket ever opens. A staff or logistics session is T-037's and T-086's,
      // and T-031's rule is that the scope is chosen here and can never change on a refresh.
      scope: 'CONSUMER',
      amr: ['otp'],
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

    await writeAudit(tx, {
      action: challenge.channel === 'EMAIL' ? AUDIT_ACTIONS.EMAIL_VERIFIED : AUDIT_ACTIONS.PHONE_VERIFIED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: userId,
      subjectUserId: userId,
      ip: input.ip,
      userAgent: input.userAgent,
      sessionId: session.sessionId,
      deviceId: device.deviceId,
      metadata: { challengeId: challenge.id, purpose: challenge.purpose },
    });

    const { user, state } = await onboarding(tx, deps, userId);
    return { outcome: 'SESSION', session, nextStep: nextStep(state), user };
  });
}

export type ResendResult =
  | { outcome: 'ISSUED'; challengeId: string; expiresAt: Date }
  | { outcome: 'THROTTLED' }
  | { outcome: 'UNKNOWN' };

/**
 * E3's "Didn't get a code?".
 *
 * The destination is re-read from the user's primary contact rather than recovered from the
 * challenge: `destination_hash` is an HMAC and there is nothing to recover. That is a real
 * limitation — a challenge for a non-primary contact cannot be resent — and it is honest for this
 * ticket, where every challenge is for the primary one.
 *
 * **A challenge with no user is NOT rejected.** `/auth/password/forgot` answers identically for an
 * identifier that matches an account and one that matches nobody, and it does that by writing a
 * real, undelivered challenge for the miss (M1 §17). If this endpoint then answered 200 for the
 * real one and 422 for the decoy, one extra unauthenticated request would undo the whole thing: the
 * caller takes the challenge id the forgot response just gave them and asks for a resend. So the
 * decoy is re-issued against its own stored hash and answers exactly as a real one does.
 *
 * `maskedDestination` is deliberately NOT in the response for the same reason: the client already
 * has it from the call that created the challenge, and returning the account's one here would be
 * the oracle the status code no longer is.
 */
export async function resendOtp(
  db: Db,
  deps: AccountDeps,
  input: { challengeId: string; ip: string | null },
): Promise<ResendResult> {
  return db.transaction(async (tx): Promise<ResendResult> => {
    const challenge = await findLiveChallenge(tx, input.challengeId);
    if (!challenge) return { outcome: 'UNKNOWN' };

    // The decoy: re-issue against the hash the original was made from, deliver nothing.
    if (!challenge.userId) {
      const issued = await issueOtp(tx, otpDeps(deps), {
        userId: null,
        purpose: challenge.purpose,
        channels: [challenge.channel === 'EMAIL' ? 'EMAIL' : 'SMS'],
        destinationHash: Buffer.from(challenge.destinationHash),
        ip: input.ip,
        deliver: false,
      });
      return issued.throttled
        ? { outcome: 'THROTTLED' }
        : { outcome: 'ISSUED', challengeId: issued.challengeId, expiresAt: issued.expiresAt };
    }

    const contacts = await primaryContacts(tx, challenge.userId);
    const contact = challenge.channel === 'EMAIL' ? contacts.email : contacts.phone;
    if (!contact) return { outcome: 'UNKNOWN' };

    const destination =
      challenge.channel === 'EMAIL' ? normaliseEmail(contact.address).emailNormal : contact.address;

    const issued = await issueOtp(tx, otpDeps(deps), {
      userId: challenge.userId,
      purpose: challenge.purpose,
      channels: await deliveryChannels(tx, deps, challenge.userId, challenge.channel),
      destination,
      ip: input.ip,
    });

    // `throttled`, not `!delivered`: a decoy is never delivered and must still answer ISSUED, or
    // the distinction this function exists to remove comes back through the status code.
    return issued.throttled
      ? { outcome: 'THROTTLED' }
      : { outcome: 'ISSUED', challengeId: issued.challengeId, expiresAt: issued.expiresAt };
  });
}

/**
 * Which channels one code goes out on. Normally exactly the challenge's own; with
 * `IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL` a phone code is ALSO emailed, because SMS runs dry outside
 * production and a developer would otherwise never see one. Never instead of the SMS.
 */
async function deliveryChannels(
  tx: Tx,
  deps: AccountDeps,
  userId: string,
  channel: string,
): Promise<OtpChannel[]> {
  if (channel !== 'SMS' || !deps.mirrorPhoneOtpToEmail) {
    return [channel === 'EMAIL' ? 'EMAIL' : 'SMS'];
  }
  const contacts = await primaryContacts(tx, userId);
  return contacts.email ? ['SMS', 'EMAIL'] : ['SMS'];
}

export interface AcceptTermsInput {
  userId: string;
  termsVersion: string;
  privacyVersion: string;
  ip: string | null;
  userAgent: string | null;
}

export type AcceptTermsResult = { outcome: 'ACCEPTED' } | { outcome: 'STALE_TERMS' };

/** Screen TOS2: an existing user re-accepting updated documents. */
export async function acceptTerms(
  db: Db,
  deps: AccountDeps,
  input: AcceptTermsInput,
): Promise<AcceptTermsResult> {
  if (input.termsVersion !== deps.terms.termsVersion || input.privacyVersion !== deps.terms.privacyVersion) {
    return { outcome: 'STALE_TERMS' };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        termsVersion: input.termsVersion,
        privacyVersion: input.privacyVersion,
        consentRecordedAt: sql`now()`,
        consentIp: input.ip,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, input.userId));
    await writeAudit(tx, {
      action: AUDIT_ACTIONS.TERMS_ACCEPTED,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.userId,
      subjectUserId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { termsVersion: input.termsVersion, privacyVersion: input.privacyVersion },
    });
  });

  return { outcome: 'ACCEPTED' };
}

export async function termsStateFor(db: Db, deps: AccountDeps, userId: string): Promise<TermsState> {
  const row = (
    await db
      .select({ terms: users.termsVersion, privacy: users.privacyVersion })
      .from(users)
      .where(eq(users.id, userId))
  )[0];
  return {
    termsVersion: deps.terms.termsVersion,
    privacyVersion: deps.terms.privacyVersion,
    acceptedTermsVersion: row?.terms ?? null,
    acceptedPrivacyVersion: row?.privacy ?? null,
  };
}

/** The account's state, as both the public shape a client renders and the input to `nextStep`. */
export async function onboarding(
  tx: Tx,
  deps: AccountDeps,
  userId: string,
): Promise<{ user: PublicUser; state: OnboardingState }> {
  const row = (
    await tx
      .select({
        id: users.id,
        publicId: users.publicId,
        username: users.username,
        status: users.status,
        verificationLevel: users.verificationLevel,
        termsVersion: users.termsVersion,
        privacyVersion: users.privacyVersion,
        displayName: userProfiles.displayName,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(users.id, userId))
  )[0];
  if (!row) throw new Error(`onboarding: no user ${userId}`);

  const contacts = await primaryContacts(tx, userId);
  const credential = await tx
    .select({ userId: userCredentials.userId })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);

  return {
    user: {
      id: row.id,
      publicId: row.publicId,
      username: row.username,
      displayName: row.displayName,
      status: row.status,
      verificationLevel: row.verificationLevel,
    },
    state: {
      hasEmail: contacts.email !== null,
      hasPhone: contacts.phone !== null,
      emailVerified: contacts.email?.verified ?? false,
      phoneVerified: contacts.phone?.verified ?? false,
      hasPassword: credential.length > 0,
      hasUsername: row.username !== null,
      termsUpToDate: termsUpToDate({
        termsVersion: deps.terms.termsVersion,
        privacyVersion: deps.terms.privacyVersion,
        acceptedTermsVersion: row.termsVersion,
        acceptedPrivacyVersion: row.privacyVersion,
      }),
    },
  };
}
