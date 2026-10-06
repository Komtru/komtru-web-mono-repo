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
