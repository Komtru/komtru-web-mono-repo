// Request and response shapes for T-041's `/me/avatar` lines: the shared contracts, so the apps and
// this API cannot drift.
import { avatarSchema, setAvatarBodySchema } from '@komtru/shared-types';

export { setAvatarBodySchema };
export const avatarResponseSchema = avatarSchema;
