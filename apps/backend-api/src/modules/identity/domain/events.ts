// M1 §11. Identity's domain events, declared once so publisher and subscriber share a schema.
//
// Only the username events are here; T-031, T-032, T-034 and T-039 add theirs beside them.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';

/** First claim of a handle. Search indexes it; analytics counts it as onboarding completed. */
export const usernameClaimedEvent = defineEvent(
  'identity.username.claimed',
  1,
  z.object({
    userId: z.uuid(),
    username: z.string().min(3).max(30),
  }),
);

/**
 * A handle moved. `from` is carried in the payload because the consumers that matter — search,
 * notifications, trades — need to know what to retire, and M1 §6.4's snapshot rule means nobody may
 * resolve a historical handle at read time to find out.
 */
export const usernameChangedEvent = defineEvent(
  'identity.username.changed',
  1,
  z.object({
    userId: z.uuid(),
    from: z.string().min(3).max(30),
    to: z.string().min(3).max(30),
    reason: z.string().min(1),
    /** True when staff forced it (T-037's `username.force_change`), not the user. */
    forced: z.boolean().default(false),
  }),
);

// ---------------------------------------------------------------------------
// T-032: registration, OTP delivery, channel verification and password login.
// ---------------------------------------------------------------------------

/** M1 §5.1's `otp_purpose`, as a zod enum so an event payload cannot name one that does not exist. */
export const otpPurposeSchema = z.enum([
  'REGISTRATION',
  'LOGIN',
  'PHONE_VERIFICATION',
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'MFA_CHALLENGE',
  'SENSITIVE_ACTION',
  'ACCOUNT_RECOVERY',
]);

/** An account was opened. Risk scores the signup, Analytics counts it, Referral binds an invitation. */
export const identityUserRegisteredEvent = defineEvent(
  'identity.user.registered',
  1,
  z.object({
    userId: z.uuid(),
    publicId: z.string().min(1),
    /** How the account was opened: `register:EMAIL`, `register:PHONE`, later `social:GOOGLE`. */
    registeredVia: z.string().min(1),
    channel: z.enum(['EMAIL', 'PHONE']),
    ip: z.string().nullable().default(null),
    /** The §10.1 `invitationToken` this account was opened from, if any (T-035). Referral attributes
     * the signup on it; the TRADE still binds on claim-on-verify and never on this. */
    invitationId: z.uuid().nullable().default(null),
  }),
);

/**
 * A one-time code was minted and must be delivered. notify's binding (domain/binding.ts) turns this
 * into an SMS or an email.
 *
 * The CODE travels in the payload, which is the one place in this module a secret is written in
 * clear: notify renders `{{code}}` from the template and has no other way to learn it, and the
 * alternative — a second table notify reads out of identity — would be the same secret in a second
 * place plus a cross-module read. The cost is that `platform.outbox` retains it, which is a
 * retention problem this build does not solve (see the ticket's deferred list).
 *
 * `channels` rather than a single channel because `IDENTITY_MIRROR_PHONE_OTP_TO_EMAIL` sends one
 * code on two channels, and because the binding must not have to guess: the challenge decided where
 * this code goes, and the event carries that decision rather than re-deriving it downstream.
 *
 * `userId` is nullable: `/auth/password/forgot` writes a real challenge for an identifier that
 * matches nobody, so its response cannot be told from a hit. That challenge is never delivered, so
 * this event is never published for it — the nullable column is the honest shape, not a live path.
 */
export const identityOtpRequestedEvent = defineEvent(
  'identity.otp.requested',
  1,
  z.object({
    userId: z.uuid().nullable(),
    challengeId: z.uuid(),
    purpose: otpPurposeSchema,
    channels: z.array(z.enum(['SMS', 'EMAIL'])).min(1),
    code: z.string().min(1),
    expiresInMinutes: z.number().int().positive(),
  }),
);

/** A channel was proven. Trust raises what the user may do; Notifications says welcome. */
export const identityEmailVerifiedEvent = defineEvent(
  'identity.email.verified',
  1,
  z.object({ userId: z.uuid(), emailId: z.uuid() }),
);

export const identityPhoneVerifiedEvent = defineEvent(
  'identity.phone.verified',
  1,
  z.object({ userId: z.uuid(), phoneId: z.uuid() }),
);

/**
 * A sign-in attempt failed. Risk counts these per identifier and per IP.
 *
 * `identifierHash` and not the identifier: §S12 forbids an email or a phone in anything we keep, and
 * an outbox row is kept. Risk needs to know that forty failures share a subject, not what the
 * subject was, and a SHA-256 answers that exactly.
 */
export const identityLoginFailedEvent = defineEvent(
  'identity.login.failed',
  1,
  z.object({
    identifierHash: z.string().min(1),
    identifierKind: z.enum(['EMAIL', 'PHONE', 'USERNAME']),
    ip: z.string().nullable().default(null),
    /** Coarse on purpose: `rejected` for everything §S3 makes indistinguishable to the caller. */
    reason: z.string().min(1),
  }),
);

/**
 * A password was set or changed. M1 §11 calls this `identity.credential.password_changed`; this
 * build uses the shorter name because T-045 already seeded a `notification_event_mappings` row for
 * `identity.password.changed`, and a notification that never fires is a worse outcome than a name
 * one character off the spec's table.
 */
export const identityPasswordChangedEvent = defineEvent(
  'identity.password.changed',
  1,
  z.object({
    userId: z.uuid(),
    /** True when a reset token did it, false when the holder proved the old password (§S11). */
    viaRecovery: z.boolean(),
    changedAt: z.iso.datetime(),
    revokedSessions: z.number().int().min(0).default(0),
  }),
);

/**
 * A session was opened on a device this account has not used before (§S11). The template renders
 * `{{deviceLabel}}`, `{{location}}` and `{{signedInAt}}`, so all three are in the payload — there is
 * no geo-IP in this build, and `location` carries the IP or a plain "unrecognised location" rather
 * than a place name the system cannot actually produce.
 */
export const identityDeviceSignedInEvent = defineEvent(
  'identity.device.signed_in',
  1,
  z.object({
    userId: z.uuid(),
    deviceId: z.uuid().nullable().default(null),
    deviceLabel: z.string().min(1),
    location: z.string().min(1),
    signedInAt: z.iso.datetime(),
    ip: z.string().nullable().default(null),
  }),
);

/**
 * `users.status` moved. Trades and Payments gate new activity on it; Audit keeps the trail.
 *
 * Declared here by T-032 because the first transition anything makes is PENDING_VERIFICATION →
 * ACTIVE on the first verified channel (M1 §9.1). T-039 owns the rest of the machine and reuses it.
 */
export const identityUserStatusChangedEvent = defineEvent(
  'identity.user.status_changed',
  1,
  z.object({
    userId: z.uuid(),
    from: z.string().min(1),
    to: z.string().min(1),
    reason: z.string().min(1),
  }),
);

/**
 * `users.verification_level` moved. M1 §2 splits ownership: identity sets levels 0 and 1 from its
 * own channel verification, M6 sets 2–4 and identity never computes them.
 */
export const identityVerificationLevelChangedEvent = defineEvent(
  'identity.user.verification_level_changed',
  1,
  z.object({ userId: z.uuid(), from: z.string().min(1), to: z.string().min(1) }),
);

// ---------------------------------------------------------------------------
// T-035: party lookup and invitations.
// ---------------------------------------------------------------------------

/**
 * Every lookup, hit or miss (§8.3 control 6). Risk is meant to see that a user performed forty email
 * lookups with thirty-eight misses, which is scraping.
 *
 * `subjectHash` and never the subject: §S12 forbids an address in anything we keep, and an outbox
 * row is kept. A SHA-256 of the channel and the canonical value answers "were these forty lookups
 * forty different people or one person forty times", which is the question M13 is asking. The schema
 * is strict so a later call site cannot quietly add the address beside it.
 */
export const identityPartyLookupPerformedEvent = defineEvent(
  'identity.party.lookup_performed',
  1,
  z.strictObject({
    actorUserId: z.uuid(),
    channel: z.enum(['USERNAME', 'EMAIL', 'PHONE']),
    /** False for a genuine miss, a hidden user AND a suspended one — the service cannot tell them
     * apart on purpose, and neither can this. */
    found: z.boolean(),
    subjectHash: z.string().min(1),
  }),
);

/**
 * A party was tagged who has no account (§8.5 step 2).
 *
 * The claim TOKEN is deliberately absent, and so is the destination. notify cannot address a
 * non-user — `NotificationRecipient` is keyed on a `userId` — so a token here would be a bearer
 * secret retained in `platform.outbox` indefinitely for a consumer that cannot use it, which is
 * T-032's deferred retention problem repeated for no gain. The inviter receives the claim URL in the
 * route's response and shares it themselves until a ticket teaches notify to send to a raw address.
 */
export const identityPartyInvitationCreatedEvent = defineEvent(
  'identity.party_invitation.created',
  1,
  z.strictObject({
    invitationId: z.uuid(),
    inviterUserId: z.uuid(),
    channel: z.enum(['EMAIL', 'PHONE']),
    /** `j•••@example.com`: enough for the inviter to confirm they typed the right address. */
    maskedDestination: z.string().min(1),
    intendedRole: z.enum(['BUYER', 'SELLER']),
    contextType: z.string().min(1).nullable().default(null),
    contextId: z.uuid().nullable().default(null),
    expiresAt: z.iso.datetime(),
  }),
);

/**
 * The invited channel was verified by the person who now holds it (§8.5 step 5). **Trades** binds the
 * trade on this; Referral attributes the signup.
 */
export const identityPartyInvitationClaimedEvent = defineEvent(
  'identity.party_invitation.claimed',
  1,
  z.strictObject({
    invitationId: z.uuid(),
    inviterUserId: z.uuid(),
    claimedByUserId: z.uuid(),
    intendedRole: z.enum(['BUYER', 'SELLER']),
    contextType: z.string().min(1).nullable().default(null),
    contextId: z.uuid().nullable().default(null),
  }),
);

/**
 * Unclaimed after fourteen days (§8.5 step 7). **Not optional:** without it M7 has no trigger and the
 * trade hangs in PENDING_COUNTERPARTY forever.
 */
export const identityPartyInvitationExpiredEvent = defineEvent(
  'identity.party_invitation.expired',
  1,
  z.strictObject({
    invitationId: z.uuid(),
    inviterUserId: z.uuid(),
    intendedRole: z.enum(['BUYER', 'SELLER']),
    contextType: z.string().min(1).nullable().default(null),
    contextId: z.uuid().nullable().default(null),
  }),
);

// ---------------------------------------------------------------------------
// T-036: devices, MFA factors and passkeys.
// ---------------------------------------------------------------------------

/**
 * M1 §11's `identity.device.registered`. Risk consumes it; M11 learns there is a push token.
 *
 * `fingerprintHash` and not the fingerprint: §S12 forbids keeping the raw signal in a row that is
 * retained, and what Risk needs is that two accounts share a handset, which a SHA-256 answers
 * exactly. The device id is the join key for anything that needs more.
 */
export const identityDeviceRegisteredEvent = defineEvent(
  'identity.device.registered',
  1,
  z.object({
    userId: z.uuid(),
    deviceId: z.uuid(),
    fingerprintHash: z.string().min(1),
    platform: z.string().min(1),
    hasPushToken: z.boolean().default(false),
  }),
);

export const mfaFactorTypeSchema = z.enum(['TOTP', 'SMS_OTP', 'EMAIL_OTP', 'PASSKEY', 'RECOVERY_CODE']);

/**
 * M1 §11's `identity.mfa.enrolled`. §S11 asks for a notification on every MFA change, and Risk
 * scores an account that just became two-factor differently from one that always was.
 */
export const identityMfaEnrolledEvent = defineEvent(
  'identity.mfa.enrolled',
  1,
  z.object({
    userId: z.uuid(),
    factorId: z.uuid(),
    factorType: mfaFactorTypeSchema,
    /** True when this is the factor that made the account two-factor. */
    isFirstFactor: z.boolean().default(false),
  }),
);

/**
 * M1 §11's `identity.mfa.removed`. The one the user most needs to hear about: removing a factor is
 * the step an account takeover takes before it changes anything else (§S11).
 */
export const identityMfaRemovedEvent = defineEvent(
  'identity.mfa.removed',
  1,
  z.object({
    userId: z.uuid(),
    factorId: z.uuid(),
    factorType: mfaFactorTypeSchema,
    /** True when the account is no longer two-factor at all. */
    lastFactor: z.boolean().default(false),
  }),
);
