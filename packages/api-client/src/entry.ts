// Getting in (T-111): registration, codes, passwords and the Terms. Mirrors the backend's identity
// routes field for field (M1 §10.1, §10.5).
//
// Two calls in this flow are NOT here, on purpose: signing in and proving a code. Both can answer
// with a refresh token, so they go through the app's own route handlers (`authRoutePaths`), which
// keep that token in an httpOnly cookie. Everything below answers with nothing a browser must not
// hold, so it is called straight at the backend like any other endpoint.
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

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
export type NextStep = z.infer<typeof nextStepSchema>;

/** The versions in force. Screen TOS1 sends back exactly what it read here. */
export const getPublishedTerms = defineEndpoint({
  method: 'get',
  path: '/auth/terms',
  scope: 'PUBLIC',
  schema: {
    response: z.object({ termsVersion: z.string().min(1), privacyVersion: z.string().min(1) }),
  },
});

/** The phone path only: a password is set after the number is proved (M1 §9.3). */
export const registerBodySchema = z.object({
  channel: z.literal('PHONE'),
  phone: z.string().min(4).max(32),
  fullName: z.string().min(1).max(120).optional(),
  acceptedTermsVersion: versionSchema,
  acceptedPrivacyVersion: versionSchema,
  marketingOptIn: z.boolean().optional(),
  invitationToken: z.string().min(16).max(128).optional(),
});

export const registerResponseSchema = z.object({
  userId: z.string(),
  publicId: z.string(),
  status: z.string(),
  challengeId: z.string(),
  nextStep: nextStepSchema,
  expiresAt: z.number().int().positive(),
  /** `+23480•••5567`: screen E3 says where the code went without printing the number. */
  maskedDestination: z.string(),
  /** False when the send budget was spent: the account exists but no code went out. */
  delivered: z.boolean(),
});

/** Not retryable: the backend refuses a replay of a response carrying a live challenge. */
export const register = defineEndpoint({
  method: 'post',
  path: '/auth/register',
  scope: 'PUBLIC',
  retryable: false,
  schema: { body: registerBodySchema, response: registerResponseSchema },
});

/** A fresh code. The answer is a NEW challenge id; the old one stops verifying. */
export const resendOtp = defineEndpoint({
  method: 'post',
  path: '/auth/otp/resend',
  scope: 'PUBLIC',
  retryable: false,
  schema: {
    body: z.object({ challengeId: z.string() }),
    response: z.object({ challengeId: z.string(), expiresAt: z.number().int().positive() }),
  },
});

/** The same 202 whether or not the identifier matched an account (M1 §17). */
export const forgotPassword = defineEndpoint({
  method: 'post',
  path: '/auth/password/forgot',
  scope: 'PUBLIC',
  retryable: false,
  schema: {
    body: z.object({ identifier: z.string().min(1).max(254) }),
    response: z.object({
      status: z.literal('SENT'),
      challengeId: z.string(),
      expiresAt: z.number().int().positive(),
      maskedDestination: z.string().nullable(),
    }),
  },
});

const passwordChangedSchema = z.object({ ok: z.literal(true), revokedSessions: z.number().int().min(0) });

/** Screen AC3, with the token `/api/auth/verify` handed back for a reset code. */
export const resetPassword = defineEndpoint({
  method: 'post',
  path: '/auth/password/reset',
  scope: 'PUBLIC',
  retryable: false,
  schema: {
    body: z.object({ resetToken: z.string().min(1).max(512), newPassword: z.string().min(1) }),
    response: passwordChangedSchema,
  },
});

/** Sets the first password on the phone path, where there is no current one to give (M1 §9.3). */
export const changePassword = defineEndpoint({
  method: 'post',
  path: '/auth/password/change',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.object({ currentPassword: z.string().min(1).optional(), newPassword: z.string().min(1) }),
    response: passwordChangedSchema,
  },
});

/** Which Terms are in force and which this person accepted (screen TOS2). */
export const getMyTerms = defineEndpoint({
  method: 'get',
  path: '/me/terms',
  scope: 'CONSUMER',
  schema: {
    response: z.object({
      termsVersion: z.string(),
      privacyVersion: z.string(),
      acceptedTermsVersion: z.string().nullable(),
      acceptedPrivacyVersion: z.string().nullable(),
      upToDate: z.boolean(),
    }),
  },
});

export const acceptTerms = defineEndpoint({
  method: 'post',
  path: '/me/terms/accept',
  scope: 'CONSUMER',
  retryable: false,
  schema: {
    body: z.object({ termsVersion: versionSchema, privacyVersion: versionSchema }),
    response: z.object({ ok: z.literal(true) }),
  },
});
