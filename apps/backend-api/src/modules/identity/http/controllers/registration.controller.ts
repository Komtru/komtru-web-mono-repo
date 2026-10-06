// Registration, OTP verification and terms, as HTTP.
//
// There is no logic here beyond turning a service outcome into a status code. The services decide;
// this file decides only what the client is told, which is a separate question and the one place
// §S3's "same body for every failure" is actually enforced.
import type { Request } from 'express';
import type { z } from 'zod';
import type { Db } from '../../../../db/index.js';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import { termsUpToDate } from '../../domain/terms.js';
import {
  acceptTerms,
  register,
  resendOtp,
  termsStateFor,
  verifyChallenge,
  type AccountDeps,
  type ChallengeResult,
} from '../../services/auth.service.js';
import type { IssuedSession } from '../../services/session.service.js';
import type {
  acceptTermsRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  verifyOtpRequestSchema,
} from '../validations/registration.validation.js';
import { callerAgent, callerIp } from './request.js';

export interface RegistrationControllerDeps extends AccountDeps {
  db: Db;
}

export async function registerUser(
  deps: RegistrationControllerDeps,
  req: Request,
  body: z.output<typeof registerRequestSchema>,
) {
  const result = await register(deps.db, deps, {
    channel: body.channel,
    ...(body.email ? { email: body.email } : {}),
    ...(body.phone ? { phone: body.phone } : {}),
    ...(body.password ? { password: body.password } : {}),
    ...(body.fullName ? { fullName: body.fullName } : {}),
    acceptedTermsVersion: body.acceptedTermsVersion,
    ...(body.acceptedPrivacyVersion ? { acceptedPrivacyVersion: body.acceptedPrivacyVersion } : {}),
    marketingOptIn: body.marketingOptIn,
    ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  switch (result.outcome) {
    case 'REGISTERED':
      return {
        userId: result.userId,
        publicId: result.publicId,
        status: result.status,
        challengeId: result.challengeId,
        nextStep: result.nextStep,
        expiresAt: result.expiresAt.getTime(),
        maskedDestination: result.maskedDestination,
      };
    case 'TAKEN':
      // A deliberate enumeration trade-off, recorded in the ticket: a duplicate must be
      // distinguishable or the client cannot send the user to sign in instead, and only a VERIFIED
      // address conflicts — an unproven one may coexist on two accounts, as the partial unique
      // index allows. The route's per-identifier and per-IP budgets are what bound probing it.
      throw new ApiError(
        409,
        'CONFLICT',
        'That contact is already in use',
        'Sign in instead, or use the forgotten-password flow',
      );
    case 'INVALID_CONTACT':
      throw new ApiError(422, 'VALIDATION_FAILED', 'That contact is not valid', undefined, [
        {
          path: result.channel === 'EMAIL' ? 'email' : 'phone',
          message:
            result.channel === 'EMAIL'
              ? 'Enter a deliverable email address'
              : 'Enter a valid phone number, for example 0802 341 5567',
        },
      ]);
    case 'REJECTED':
      throw new ApiError(422, 'VALIDATION_FAILED', 'That password cannot be used', undefined, [
        { path: 'password', message: result.message },
      ]);
    case 'STALE_TERMS':
      throw new ApiError(
        409,
        'CONFLICT',
        'The Terms have changed',
        'Fetch the current Terms and Privacy Policy and accept those',
      );
  }
}

const sessionBody = (session: IssuedSession) => ({
  accessToken: session.accessToken,
  refreshToken: session.refreshToken,
  scope: session.scope,
  expiresIn: session.expiresIn,
  expiresAt: Date.now() + session.expiresIn * 1000,
});

/**
 * Every unsuccessful verification is one 422 with the code `OTP_INVALID`.
 *
 * `attemptsRemaining` rides along as an RFC 9457 extension member when there are attempts left,
 * which is what screen E3b renders ("2 attempts remaining before we ask you to request a fresh
 * code"). When there are none, the field is ABSENT rather than zero: an exhausted challenge, an
 * expired one and an id nobody ever issued must look the same, or the endpoint tells a guesser
 * which of their two mistakes to fix.
 */
function otpFailure(result: Exclude<ChallengeResult, { outcome: 'SESSION' } | { outcome: 'RESET_TOKEN' }>) {
  if (result.outcome === 'WRONG_CODE' && result.attemptsRemaining > 0) {
    return new ApiError(
      422,
      'OTP_INVALID',
      "That code doesn't match",
      'Check the message and try again',
      undefined,
      { attemptsRemaining: result.attemptsRemaining },
    );
  }
  if (result.outcome === 'TAKEN') {
    return new ApiError(
      409,
      'CONFLICT',
      'That contact is already in use',
      'Another account verified it first; sign in with that account instead',
    );
  }
  return new ApiError(
    422,
    'OTP_INVALID',
    'That code is no longer usable',
    'Request a new code and try again',
  );
}

export async function verifyOtp(
  deps: RegistrationControllerDeps,
  req: Request,
  body: z.output<typeof verifyOtpRequestSchema>,
) {
  const result = await verifyChallenge(deps.db, deps, {
    challengeId: body.challengeId,
    code: body.code,
    ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  if (result.outcome === 'SESSION') {
    return {
      verified: true as const,
      nextStep: result.nextStep,
      ...sessionBody(result.session),
      user: result.user,
    };
  }
  if (result.outcome === 'RESET_TOKEN') {
    return {
      verified: true as const,
      nextStep: 'SET_PASSWORD' as const,
      resetToken: result.resetToken,
      expiresAt: result.expiresAt.getTime(),
    };
  }
  throw otpFailure(result);
}

export async function resendCode(
  deps: RegistrationControllerDeps,
  req: Request,
  body: z.output<typeof resendOtpRequestSchema>,
) {
  const result = await resendOtp(deps.db, deps, {
    challengeId: body.challengeId,
    ip: callerIp(req),
  });

  if (result.outcome === 'ISSUED') {
    return {
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.getTime(),
      maskedDestination: result.maskedDestination,
    };
  }
  if (result.outcome === 'THROTTLED') {
    throw new ApiError(
      429,
      'RATE_LIMITED',
      'Too many codes requested',
      'Wait a few minutes before asking for another code',
    );
  }
  // An unknown or expired challenge, and a decoy one from `/auth/password/forgot`, answer alike:
  // a resend that distinguished them would undo the uniform forgot-password response one endpoint
  // later.
  throw new ApiError(
    422,
    'OTP_INVALID',
    'That code is no longer usable',
    'Start again to receive a new code',
  );
}

export async function getTerms(deps: RegistrationControllerDeps, actor: Actor) {
  const userId = requireUserId(actor, 'Sign in to see which Terms you have accepted');
  const state = await termsStateFor(deps.db, deps, userId);
  return { ...state, upToDate: termsUpToDate(state) };
}

export async function postAcceptTerms(
  deps: RegistrationControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof acceptTermsRequestSchema>,
) {
  const userId = requireUserId(actor, 'Sign in to accept the Terms');
  const result = await acceptTerms(deps.db, deps, {
    userId,
    termsVersion: body.termsVersion,
    privacyVersion: body.privacyVersion,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  if (result.outcome === 'STALE_TERMS') {
    throw new ApiError(
      409,
      'CONFLICT',
      'Those are not the current Terms',
      'Fetch the current Terms and Privacy Policy and accept those',
    );
  }
  return { ok: true as const };
}
