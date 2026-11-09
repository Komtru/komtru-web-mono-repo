// The signed-in user's avatar (T-041, M1 D7): a soft reference to an M20 PROFILE_PHOTO file, resolved
// to a short-lived signed URL at the moment of reading. Shared by the backend routes and the apps.
import { z } from 'zod';

/** `POST /me/avatar`: the file id the client got from `POST /files/upload-ticket` and finalized. */
export const setAvatarBodySchema = z.object({ fileId: z.uuid() });
export type SetAvatarBody = z.infer<typeof setAvatarBodySchema>;

/**
 * What both avatar calls answer. `avatarUrl` is signed for this response and must not be stored by
 * the client beyond the screen showing it; null means the account has no avatar.
 */
export const avatarSchema = z.object({ avatarUrl: z.string().nullable() });
export type Avatar = z.infer<typeof avatarSchema>;
