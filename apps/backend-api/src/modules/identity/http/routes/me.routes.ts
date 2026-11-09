// T-041: the signed-in user's avatar.
//
//   POST   /me/avatar   { fileId }  make an uploaded PROFILE_PHOTO the avatar
//   DELETE /me/avatar               clear it
//
// Both answer `{ avatarUrl }`, signed for that response by M20 (M1 D7).
import { defineRoute, type RouteDefinition } from '../../../../platform/http/route.js';
import { deleteAvatar, postAvatar, type MeControllerDeps } from '../controllers/me.controller.js';
import { avatarResponseSchema, setAvatarBodySchema } from '../validations/avatar.validation.js';

const OWN_BUDGET = { points: 10, durationSeconds: 60, by: ['user', 'ip'] as const };

export function meRoutes(deps: MeControllerDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'post',
      path: '/me/avatar',
      scope: 'CONSUMER',
      summary: 'Set my profile photo from an uploaded file',
      /** Setting the file that is already set changes nothing: nothing to protect with a key. */
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { body: setAvatarBodySchema, response: avatarResponseSchema },
      handler: (ctx) => postAvatar(deps, ctx.req, ctx.actor, ctx.body),
    }),

    defineRoute({
      method: 'delete',
      path: '/me/avatar',
      scope: 'CONSUMER',
      summary: 'Remove my profile photo',
      /** Removing an absent avatar succeeds. */
      retryable: false,
      rateLimit: { ...OWN_BUDGET, by: [...OWN_BUDGET.by] },
      schema: { response: avatarResponseSchema },
      handler: (ctx) => deleteAvatar(deps, ctx.req, ctx.actor),
    }),
  ];
}
