// Request and response shapes for §10.5's `/me/mfa/*` and `/me/step-up` lines.
import { pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { mfaFactorHintSchema } from './password.validation.js';

export const factorIdParamSchema = z.object({ id: z.uuid() });

/** A label the user types, bounded: it lands in `mfa_factors.label` and is shown back to them. */
const labelSchema = z.string().trim().min(1).max(64);

/** A TOTP code, an SMS code or a recovery code. One field, because the user types one thing. */
const presentedCodeSchema = z.string().trim().min(1).max(64);

/** `<challengeId>.<secret>`. The same shape as a reset token; the purpose is what separates them. */
const tokenSchema = z.string().min(1).max(512);

export const factorSchema = z.object({
  id: z.uuid(),
  type: z.enum(['TOTP', 'SMS_OTP', 'EMAIL_OTP', 'PASSKEY', 'RECOVERY_CODE']),
  label: z.string(),
  isDefault: z.boolean(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  /** SMS only. */
  maskedDestination: z.string().optional(),
  /** Recovery codes only. */
  remaining: z.number().int().min(0).optional(),
});

export const factorListResponseSchema = pagedSchema(factorSchema);

export const enrolTotpResponseSchema = z.object({
  factorId: z.uuid(),
  /**
   * Returned ONCE, on the response to the enrolment that created it, exactly as screen TF1 needs:
   * the user has to get it into their authenticator, and after that it is sealed and unreadable.
   */
  secret: z.string().min(1),
  otpauthUri: z.string().min(1),
});

export const activateTotpRequestSchema = z.strictObject({
  factorId: z.uuid(),
  code: presentedCodeSchema,
});

export const enrolSmsResponseSchema = z.object({
  factorId: z.uuid(),
  challengeId: z.uuid(),
  maskedDestination: z.string(),
  expiresAt: z.number().int().positive(),
  /** False when §S4's per-destination budget was spent, so nothing was sent. */
  delivered: z.boolean(),
});

export const activateSmsRequestSchema = z.strictObject({
  factorId: z.uuid(),
  challengeId: z.uuid(),
  code: presentedCodeSchema,
});

/**
 * Screen TF2's codes, shown once.
 *
 * `null` on the activation of a SECOND factor: the sheet is minted at the moment the account
 * becomes two-factor, and reissuing it on every subsequent enrolment would silently invalidate the
 * one the user already wrote down.
 */
export const activatedResponseSchema = z.object({
  factorId: z.uuid(),
  recoveryCodes: z.array(z.string()).nullable(),
});

export const recoveryCodesResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

export const passkeyOptionsResponseSchema = z.object({
  options: z.record(z.string(), z.unknown()),
});

export const passkeyRegisterRequestSchema = z.strictObject({
  /** The browser's `startRegistration()` result. Its shape is the relying party's to check. */
  response: z.unknown(),
  label: labelSchema.optional(),
});

/**
 * Every §S7 action takes this field. Optional in the SCHEMA and required by the gate, so the
 * refusal is a 403 naming the remedy rather than a 422 about a missing field.
 */
export const stepUpTokenSchema = tokenSchema.optional();

export const removeFactorRequestSchema = z.strictObject({ stepUpToken: stepUpTokenSchema });

export const regenerateRecoveryCodesRequestSchema = z.strictObject({
  stepUpToken: stepUpTokenSchema,
});

export const stepUpChallengeRequestSchema = z.strictObject({ factorId: z.uuid() });

export const stepUpRequestSchema = z
  .strictObject({
    /** Absent only when the account holds no factor at all and the password is the proof. */
    factorId: z.uuid().optional(),
    code: presentedCodeSchema.optional(),
    assertion: z.unknown().optional(),
    password: z.string().min(1).max(1024).optional(),
  })
  .refine(
    (body) =>
      [body.code !== undefined, body.assertion !== undefined, body.password !== undefined].filter(Boolean)
        .length === 1,
    { message: 'Send exactly one of code, assertion and password', path: ['code'] },
  );

export const stepUpResponseSchema = z.object({
  stepUpToken: z.string().min(1),
  expiresAt: z.number().int().positive(),
});

export const okResponseSchema = z.object({ ok: z.literal(true) });

export { mfaFactorHintSchema };
