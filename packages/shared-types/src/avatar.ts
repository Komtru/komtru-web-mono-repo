// The signed-in user's avatar (T-041, M1 D7): a soft reference to an M20 PROFILE_PHOTO file, resolved
// to a signed delivery URL at the moment of reading. Shared by the backend routes and the apps.
import { z } from 'zod';

/** `POST /me/avatar`: the file id the client got from `POST /files/upload-ticket` and finalized. */
export const setAvatarBodySchema = z.object({ fileId: z.uuid() });
export type SetAvatarBody = z.infer<typeof setAvatarBodySchema>;

/**
 * What both avatar calls answer. `avatarUrl` is produced for this response: profile photos are public,
 * so the URL does not expire, but it stops resolving once the avatar is replaced or removed, so the
 * client should not store it beyond the screen showing it. Null means the account has no avatar.
 */
export const avatarSchema = z.object({ avatarUrl: z.string().nullable() });
export type Avatar = z.infer<typeof avatarSchema>;
