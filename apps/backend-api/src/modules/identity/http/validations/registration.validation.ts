// Request and response shapes for registration, OTP verification and terms (M1 §10.1, §10.5).
//
// Every body is `strictObject`, for the reason T-031 gives on `/auth/refresh`: a field the server
// ignores is a field a client believes in. `scope`, `role`, `status` and friends are rejected here
// rather than silently dropped, so nobody ever ships a client that thinks it can ask for one.
import { sessionScopeSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { MAX_PASSWORD_LENGTH } from '../../domain/credential/policy.js';
import { OTP_CODE_DIGITS } from '../../domain/otp/challenge.js';

/**
 * The fingerprint every auth body may carry.
 *
 * It is a rate-limit key and a device record, never an authenticator (§S15). Optional because the
 * web client has nothing meaningful to put here and must still be able to sign in.
 */
export const deviceFingerprintSchema = z.string().min(8).max(128);

const versionSchema = z.string().min(1).max(32);

export const NEXT_STEPS = [
  'ACCEPT_TERMS',
  'VERIFY_EMAIL',
  'VERIFY_PHONE',
  'SET_PASSWORD',
  'CHOOSE_USERNAME',
  'ADD_EMAIL',
  'ADD_PHONE',
  'DONE',
] as const;

export const nextStepSchema = z.enum(NEXT_STEPS);

/**
 * `POST /auth/register`.
 *
 * `.check()` rather than two optional fields and a prayer: M1 §10.1 makes `password` optional on the
 * PHONE path and required on the EMAIL one (§9.3 — the phone path sets a password after the channel
 * is proven), and a body naming one channel while carrying the other's field is a client bug worth
 * a 422 rather than a silent choice about which field wins.
 */
export const registerRequestSchema = z
  .strictObject({
    channel: z.enum(['EMAIL', 'PHONE']),
    email: z.string().min(3).max(254).optional(),
    phone: z.string().min(4).max(32).optional(),
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH).optional(),
    /** Screen E2 asks for it; §5.3 is clear it is self-declared and never a legal name. */
    fullName: z.string().min(1).max(120).optional(),
    acceptedTermsVersion: versionSchema,
    /** Absent means "the same version as the Terms", which is what screen TOS1 presents. */
    acceptedPrivacyVersion: versionSchema.optional(),
    marketingOptIn: z.boolean().default(false),
    deviceFingerprint: deviceFingerprintSchema.optional(),
  })
  .check((ctx) => {
    const body = ctx.value;
    if (body.channel === 'EMAIL') {
      if (!body.email) {
        ctx.issues.push({
          code: 'custom',
          message: 'email is required on the EMAIL channel',
          input: body,
          path: ['email'],
        });
      }
      if (body.phone) {
        ctx.issues.push({
          code: 'custom',
          message: 'phone does not belong on the EMAIL channel',
          input: body,
          path: ['phone'],
        });
      }
      if (!body.password) {
        ctx.issues.push({
          code: 'custom',
          message: 'password is required on the EMAIL channel',
          input: body,
          path: ['password'],
        });
      }
      return;
    }
    if (!body.phone) {
      ctx.issues.push({
        code: 'custom',
        message: 'phone is required on the PHONE channel',
        input: body,
        path: ['phone'],
      });
    }
    if (body.email) {
      ctx.issues.push({
        code: 'custom',
        message: 'email does not belong on the PHONE channel',
        input: body,
        path: ['email'],
      });
    }
  });

export const registerResponseSchema = z.object({
  userId: z.uuid(),
  publicId: z.string().min(1),
  status: z.string().min(1),
  challengeId: z.uuid(),
  nextStep: nextStepSchema,
  /** Epoch milliseconds: the client counts down "Resend in 0:24" against it (screen E3). */
  expiresAt: z.number().int().positive(),
  /** `+23480•••5567`, so screen E3 can say where it went without printing the number. */
  maskedDestination: z.string().min(1),
});

export const resendOtpRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  deviceFingerprint: deviceFingerprintSchema.optional(),
});

export const resendOtpResponseSchema = z.object({
  /** A NEW id: issuing a code invalidates the previous challenge for the same destination (§S6). */
  challengeId: z.uuid(),
  expiresAt: z.number().int().positive(),
  maskedDestination: z.string().min(1),
});

export const verifyOtpRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  code: z
    .string()
    .regex(new RegExp(`^\\d{${String(OTP_CODE_DIGITS)}}$`), `the code is ${String(OTP_CODE_DIGITS)} digits`),
  deviceFingerprint: deviceFingerprintSchema.optional(),
});

export const publicUserSchema = z.object({
  id: z.uuid(),
  publicId: z.string().min(1),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  status: z.string().min(1),
  verificationLevel: z.string().min(1),
});

/**
 * Two shapes, because a verified challenge means two different things.
 *
 * A channel verification signs the user in. A password reset does NOT — it returns the token that
 * authorises the next call, and nothing else. Minting a session there would turn "I received the
 * SMS" into "I am signed in" without a password ever being involved, which is a different and much
 * larger grant than the one the user asked for.
 */
export const verifyOtpResponseSchema = z.union([
  z.object({
    verified: z.literal(true),
    nextStep: nextStepSchema,
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    scope: sessionScopeSchema,
    expiresIn: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    user: publicUserSchema,
  }),
  z.object({
    verified: z.literal(true),
    nextStep: z.literal('SET_PASSWORD'),
    resetToken: z.string().min(1),
    expiresAt: z.number().int().positive(),
  }),
]);

export const termsResponseSchema = z.object({
  termsVersion: z.string().min(1),
  privacyVersion: z.string().min(1),
  acceptedTermsVersion: z.string().nullable(),
  acceptedPrivacyVersion: z.string().nullable(),
  upToDate: z.boolean(),
});

export const acceptTermsRequestSchema = z.strictObject({
  termsVersion: versionSchema,
  privacyVersion: versionSchema,
});

export const okResponseSchema = z.object({ ok: z.literal(true) });
