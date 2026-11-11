// The device a person is signed in on, and the push token it can be reached at (M1, T-045's recipient source).
// Mirrors the backend's `POST /me/devices`.
import { z } from 'zod';
import { defineEndpoint } from './contracts.js';

export const registerDeviceBodySchema = z.strictObject({
  deviceFingerprint: z.string().trim().min(1).max(256),
  platform: z.enum(['IOS', 'ANDROID', 'WEB', 'unknown']).optional(),
  osVersion: z.string().trim().max(64).optional(),
  appVersion: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional(),
  pushToken: z.string().trim().min(1).max(4096).optional(),
});
export type RegisterDeviceBody = z.infer<typeof registerDeviceBodySchema>;

export const deviceSchema = z.looseObject({
  id: z.uuid(),
  /** The last six characters; the fingerprint itself never comes back. */
  fingerprintHint: z.string(),
  platform: z.string(),
  status: z.string(),
  hasPushToken: z.boolean(),
});
export type Device = z.infer<typeof deviceSchema>;

/**
 * Not retryable: the platform upserts on `(user, fingerprint)`, so a repeat writes the same row and there is
 * nothing for an idempotency key to protect.
 */
export const registerDevice = defineEndpoint({
  method: 'post',
  path: '/me/devices',
  scope: 'CONSUMER',
  retryable: false,
  schema: { body: registerDeviceBodySchema, response: deviceSchema },
});
