// T-041's `/me/avatar`, as HTTP. A thin layer: the ownership checks, the swap, the audit row and the
// event are in `avatar.service.ts`; this file resolves who is calling and where from.
import type { Request } from 'express';
import type { z } from 'zod';
import { requireUserId, type Actor } from '../../../../platform/http/principal.js';
import {
  removeAvatar,
  setAvatar,
  type AvatarDeps,
  type AvatarRequestContext,
} from '../../services/avatar.service.js';
import type { setAvatarBodySchema } from '../validations/avatar.validation.js';
import { callerAgent, callerIp } from './request.js';

export type MeControllerDeps = AvatarDeps;

const SIGN_IN = 'Sign in to change your profile photo';

const requestContext = (req: Request, actor: Actor): AvatarRequestContext => ({
  ip: callerIp(req),
  userAgent: callerAgent(req),
  sessionId: actor.principal?.sessionId ?? null,
});

export function postAvatar(
  deps: MeControllerDeps,
  req: Request,
  actor: Actor,
  body: z.output<typeof setAvatarBodySchema>,
) {
  return setAvatar(deps, {
    userId: requireUserId(actor, SIGN_IN),
    fileId: body.fileId,
    request: requestContext(req, actor),
  });
}

export function deleteAvatar(deps: MeControllerDeps, req: Request, actor: Actor) {
  return removeAvatar(deps, {
    userId: requireUserId(actor, SIGN_IN),
    request: requestContext(req, actor),
  });
}
