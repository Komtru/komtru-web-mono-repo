// The signed-in user's avatar (T-041). Mirrors the backend's `/me/avatar` routes.
import { avatarSchema, setAvatarBodySchema } from '@komtru/shared-types';
import { defineEndpoint } from './contracts.js';

/** Not retryable: a repeat sets the same file, so there is nothing for an idempotency key to protect. */
export const setAvatar = defineEndpoint({
  method: 'post',
  path: '/me/avatar',
  scope: 'CONSUMER',
  retryable: false,
  schema: { body: setAvatarBodySchema, response: avatarSchema },
});

export const removeAvatar = defineEndpoint({
  method: 'delete',
  path: '/me/avatar',
  scope: 'CONSUMER',
  retryable: false,
  schema: { response: avatarSchema },
});
