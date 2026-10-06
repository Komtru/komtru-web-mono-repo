// Login and the three password routes (M1 §10.1, screens E4, AC2, AC3).
import { sessionScopeSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { MAX_PASSWORD_LENGTH } from '../../domain/credential/policy.js';
import { deviceFingerprintSchema, nextStepSchema, publicUserSchema } from './registration.validation.js';

/**
 * One field for an email, a phone or a handle. M1 §10.1 allows it explicitly, on condition that the
 * failure is uniform — which `login.service.ts` is built around and the response below enforces by
 * having no failure variant at all.
 */
const identifierSchema = z.string().min(1).max(254);

const passwordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

export const loginRequestSchema = z.strictObject({
  identifier: identifierSchema,
  password: passwordSchema,
  deviceFingerprint: deviceFingerprintSchema.optional(),
});

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  scope: sessionScopeSchema,
  expiresIn: z.number().int().positive(),
  /** Epoch milliseconds, so the client can pre-empt the 401 rather than wait for it. */
  expiresAt: z.number().int().positive(),
  nextStep: nextStepSchema,
  user: publicUserSchema,
});

export const forgotPasswordRequestSchema = z.strictObject({
  identifier: identifierSchema,
  deviceFingerprint: deviceFingerprintSchema.optional(),
});

/**
 * 202 and this exact shape whether the identifier matched an account or nothing at all (M1 §17).
 *
 * `challengeId` is real in both cases — `startPasswordReset` writes a challenge with `user_id` NULL
 * for a miss — because a response carrying an id that verifies against nothing would be the oracle
 * the identical body was meant to close.
 */
export const forgotPasswordResponseSchema = z.object({
  status: z.literal('SENT'),
  challengeId: z.uuid(),
  expiresAt: z.number().int().positive(),
  /** A mask of what the CALLER typed, and null for a username. Never of what the account holds. */
  maskedDestination: z.string().nullable(),
});

export const resetPasswordRequestSchema = z.strictObject({
  /** `<challengeId>.<secret>`, minted by `/auth/verify-otp` on a PASSWORD_RESET challenge. */
  resetToken: z.string().min(1).max(512),
  newPassword: passwordSchema,
  deviceFingerprint: deviceFingerprintSchema.optional(),
});

/**
 * `currentPassword` is optional in the SCHEMA and required by the SERVICE whenever the account has
 * one. M1 §9.3's phone path sets a first password after the channel is proven, and there is no
 * older password to produce at that point; `changePassword` refuses an omission in every other
 * case, so the leniency lives where it can see whether a credential row exists.
 */
export const changePasswordRequestSchema = z.strictObject({
  currentPassword: passwordSchema.optional(),
  newPassword: passwordSchema,
});

export const passwordChangedResponseSchema = z.object({
  ok: z.literal(true),
  /** How many other devices were signed out, so the client can say so (M1 §9.2). */
  revokedSessions: z.number().int().min(0),
});
