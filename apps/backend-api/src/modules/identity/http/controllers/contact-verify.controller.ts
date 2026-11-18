// F-081 as HTTP. The rules are in `services/contact-verify.service.ts`; this file resolves who is
// calling and turns an outcome into a status code.
import type { Request } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import {
  confirmContactVerification,
  startContactVerification,
  type ContactChannel,
  type ContactVerifyDeps,
} from '../../services/contact-verify.service.js';
import type {
  confirmContactVerificationBody,
  startEmailVerificationBody,
} from '../validations/contact-verify.validation.js';
import { callerAgent, callerIp } from './request.js';

export type ContactVerifyControllerDeps = ContactVerifyDeps;

const SIGN_IN = 'Sign in to verify your contact details';

const CHANNEL_WORD: Record<ContactChannel, string> = { EMAIL: 'email address', PHONE: 'phone number' };

/** Exhausted, expired, unknown and someone-else's all look the same, as they do on `/auth/verify-otp`. */
const unusable = (): ApiError =>
  new ApiError(422, 'OTP_INVALID', 'That code is no longer usable', 'Ask for a new one');

export async function postStartContactVerification(
  deps: ContactVerifyControllerDeps,
  req: Request,
  actor: Actor,
  channel: ContactChannel,
  body: z.output<typeof startEmailVerificationBody>,
) {
  const result = await startContactVerification(deps, {
    userId: requireUserId(actor, SIGN_IN),
    channel,
    ...(body.address === undefined ? {} : { address: body.address }),
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  switch (result.outcome) {
    case 'STARTED':
      return {
        challengeId: result.challengeId,
        maskedDestination: result.maskedDestination,
        expiresAt: result.expiresAt.toISOString(),
        delivered: result.delivered,
      };
    case 'ALREADY_VERIFIED':
      // Not an error the person can act on, and deliberately not a re-send: a proven address is out
      // of this feature's reach entirely (F-081 scope: add + verify only).
      throw new ApiError(
        409,
        'ALREADY_VERIFIED',
        `Your ${CHANNEL_WORD[channel]} is already verified`,
        'There is nothing left to confirm here',
      );
    case 'TAKEN':
      throw new ApiError(
        409,
        'CONTACT_TAKEN',
        `That ${CHANNEL_WORD[channel]} belongs to another account`,
        'Use a different one, or get in touch if it is yours',
      );
    case 'NO_ADDRESS':
      throw new ApiError(
        422,
        'CONTACT_REQUIRED',
        `Tell us the ${CHANNEL_WORD[channel]} to verify`,
        'Your account does not have one yet',
      );
    case 'INVALID_ADDRESS':
      throw new ApiError(422, 'VALIDATION_FAILED', `That is not an ${CHANNEL_WORD[channel]} we can use`);
  }
}

export async function postConfirmContactVerification(
  deps: ContactVerifyControllerDeps,
  req: Request,
  actor: Actor,
  channel: ContactChannel,
  body: z.output<typeof confirmContactVerificationBody>,
) {
  const result = await confirmContactVerification(deps, {
    userId: requireUserId(actor, SIGN_IN),
    channel,
    challengeId: body.challengeId,
    code: body.code,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });

  switch (result.outcome) {
    case 'VERIFIED':
      return {
        status: 'VERIFIED' as const,
        verificationLevel: result.verificationLevel,
        maskedDestination: result.maskedDestination,
      };
    case 'WRONG_CODE':
      throw new ApiError(
        422,
        'OTP_INVALID',
        "That code doesn't match",
        'Check it and try again',
        undefined,
        result.attemptsRemaining > 0 ? { attemptsRemaining: result.attemptsRemaining } : undefined,
      );
    case 'TAKEN':
      throw new ApiError(
        409,
        'CONTACT_TAKEN',
        `That ${CHANNEL_WORD[channel]} belongs to another account`,
        'Somebody confirmed it first',
      );
    case 'NO_ATTEMPTS_LEFT':
    case 'EXPIRED':
    case 'UNKNOWN':
      throw unusable();
  }
}
