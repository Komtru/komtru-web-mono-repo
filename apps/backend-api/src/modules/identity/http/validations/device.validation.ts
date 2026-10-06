// Request and response shapes for §10.5's device and session lines.
import { pagedSchema, sessionScopeSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { DEVICE_PLATFORMS } from '../../services/device.service.js';

const uuidParam = z.object({ id: z.uuid() });

export const deviceIdParamSchema = uuidParam;
export const sessionIdParamSchema = uuidParam;

/**
 * Bounded on every field, because all of it comes from a client app and all of it lands in a `text`
 * column. The push token is the long one — FCM registration tokens run to a few hundred characters
 * and APNs device tokens are shorter, so 4096 is generous and still a bound.
 */
export const registerDeviceRequestSchema = z.strictObject({
  deviceFingerprint: z.string().trim().min(1).max(256),
  platform: z.enum(DEVICE_PLATFORMS).optional(),
  osVersion: z.string().trim().max(64).optional(),
  appVersion: z.string().trim().max(64).optional(),
  model: z.string().trim().max(128).optional(),
  pushToken: z.string().trim().min(1).max(4096).optional(),
});

export const deviceSchema = z.object({
  id: z.uuid(),
  /** The last six characters. The fingerprint itself never comes back out (§S12). */
  fingerprintHint: z.string(),
  platform: z.string(),
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string(),
  trustedAt: z.date().nullable(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  hasPushToken: z.boolean(),
});

export const deviceListResponseSchema = pagedSchema(deviceSchema);
export const deviceResponseSchema = deviceSchema;

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  scope: sessionScopeSchema,
  amr: z.array(z.string()),
  deviceId: z.uuid().nullable(),
  deviceLabel: z.string(),
  ip: z.string().nullable(),
  issuedAt: z.date(),
  lastUsedAt: z.date(),
  idleExpiresAt: z.date(),
  current: z.boolean(),
});

export const sessionListResponseSchema = pagedSchema(sessionSummarySchema);

export const okResponseSchema = z.object({ ok: z.literal(true) });
