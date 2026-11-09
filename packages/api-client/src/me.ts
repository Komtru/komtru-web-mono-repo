// Who the signed-in person is, for the things a device keeps per person. Mirrors `GET /me`, of which
// only the identity is read: the rest of the summary belongs to the account screens.
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

export const meSchema = z.looseObject({ id: z.uuid(), publicId: z.string() });
export type Me = z.infer<typeof meSchema>;

export const getMe = defineEndpoint({
  method: 'get',
  path: '/me',
  scope: 'CONSUMER',
  schema: { response: meSchema },
});
