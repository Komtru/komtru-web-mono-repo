// F-045: the phone-number change, as HTTP. See `services/phone-change.service.ts` for the three steps.
import type { Request } from 'express';
import type { z } from 'zod';
import { ApiError } from '../../../../platform/errors.js';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import {
  confirmCurrentPhone,
  confirmNewPhone,
  startPhoneChange,
  type PhoneChangeDeps,
} from '../../services/phone-change.service.js';
import type {
  confirmCurrentPhoneBody,
  confirmNewPhoneBody,
  startPhoneChangeBody,
} from '../validations/phone-change.validation.js';
import { callerAgent, callerIp } from './request.js';

export type PhoneChangeControllerDeps = PhoneChangeDeps;

const SIGN_IN = 'Sign in to change your phone number';

const wrongCode = (attemptsRemaining: number): ApiError =>
  new ApiError(
    422,
    'OTP_INVALID',
    "That code doesn't match",
    'Check the message and try again',
    undefined,
    attemptsRemaining > 0 ? { attemptsRemaining } : undefined,
  );

/** An exhausted, expired, unknown or someone-else's challenge look the same, as on `/auth/verify-otp`. */
const unusable = (): ApiError =>
  new ApiError(422, 'OTP_INVALID', 'That code is no longer usable', 'Start the change again');

export async function postStartPhoneChange(
  deps: PhoneChangeControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof startPhoneChangeBody>,
) {
  const result = await startPhoneChange(deps, {
    userId: requireUserId(actor, SIGN_IN),
    newPhone: body.newPhone,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });
  switch (result.outcome) {
    case 'STARTED':
      return {
        changeId: result.changeId,
        challengeId: result.challengeId,
        maskedDestination: result.maskedDestination,
        expiresAt: result.expiresAt.toISOString(),
        delivered: result.delivered,
      };
    case 'INVALID_PHONE':
      throw new ApiError(422, 'VALIDATION_FAILED', 'That is not a phone number we can use', undefined, [
        { path: 'newPhone', message: 'Enter a valid mobile number' },
      ]);
    case 'SAME_PHONE':
      throw new ApiError(422, 'VALIDATION_FAILED', 'That is already your number', undefined, [
        { path: 'newPhone', message: 'Enter a different number' },
      ]);
    case 'NO_CURRENT_PHONE':
      throw new ApiError(
        409,
        'CONFLICT',
        'There is no verified phone number on this account to change',
        'Add and verify a phone number first',
      );
  }
}

export async function postConfirmCurrentPhone(
  deps: PhoneChangeControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof confirmCurrentPhoneBody>,
) {
  const result = await confirmCurrentPhone(deps, {
    userId: requireUserId(actor, SIGN_IN),
    changeId: body.changeId,
    challengeId: body.challengeId,
    code: body.code,
    ip: callerIp(req),
  });
  if (result.outcome === 'CODE_SENT') {
    return {
      challengeId: result.challengeId,
      maskedDestination: result.maskedDestination,
      expiresAt: result.expiresAt.toISOString(),
      delivered: result.delivered,
    };
  }
  if (result.outcome === 'WRONG_CODE') throw wrongCode(result.attemptsRemaining);
  throw unusable();
}

export async function postConfirmNewPhone(
  deps: PhoneChangeControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof confirmNewPhoneBody>,
) {
  const result = await confirmNewPhone(deps, {
    userId: requireUserId(actor, SIGN_IN),
    changeId: body.changeId,
    challengeId: body.challengeId,
    code: body.code,
    ip: callerIp(req),
    userAgent: callerAgent(req),
  });
  switch (result.outcome) {
    case 'CHANGED':
      return { status: 'CHANGED' as const, maskedPhone: result.maskedPhone };
    case 'TAKEN':
      throw new ApiError(
        409,
        'CONFLICT',
        'That number can’t be used',
        'It is already in use on another account. Start again with a different number.',
      );
    case 'WRONG_CODE':
      throw wrongCode(result.attemptsRemaining);
    default:
      throw unusable();
  }
}
