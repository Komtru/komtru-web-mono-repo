// M17 section 6's schemas. `reason` is optional here ON PURPOSE, as it is in identity's admin schemas:
// a schema failure is a 422 and the admin surface answers a missing reason with a 400, so the
// controller owns that check.
import { pageRequestSchema, pagedSchema } from '@komtru/shared-types';
import { z } from 'zod';
import { FLAG_CODE_PATTERN, SETTING_KEY_PATTERN, VALUE_TYPES } from '../domain/settings.js';

const reason = z.string().max(1000).optional();
const code = z.string().regex(FLAG_CODE_PATTERN);

export const namespaceParams = z.object({ namespace: z.string().regex(SETTING_KEY_PATTERN) });
export const settingParams = namespaceParams.extend({ key: z.string().regex(SETTING_KEY_PATTERN) });
export const flagParams = z.object({ code });

export const listQuery = pageRequestSchema;
export const changeLogQuery = pageRequestSchema.extend({
  target: z.enum(['SETTING', 'FLAG']).optional(),
  /** A namespace, or a flag code. */
  subject: z.string().min(1).max(200).optional(),
});

export const settingBody = z.strictObject({
  value: z.union([z.number(), z.boolean(), z.string().max(2000)]),
  reason,
});

export const flagBody = z.strictObject({
  enabled: z.boolean(),
  rolloutNote: z.string().max(500).nullable().optional(),
  description: z.string().min(3).max(500).optional(),
  reason,
});

const settingView = z.object({
  namespace: z.string(),
  key: z.string(),
  value: z.union([z.number(), z.boolean(), z.string()]),
  valueType: z.enum(VALUE_TYPES),
  description: z.string(),
  updatedAt: z.date(),
  updatedByAdminId: z.uuid().nullable(),
});
const flagView = z.object({
  code: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  rolloutNote: z.string().nullable(),
  updatedAt: z.date(),
  updatedByAdminId: z.uuid().nullable(),
});

export const settingListResponse = pagedSchema(settingView);
export const settingResponse = settingView;
export const flagListResponse = pagedSchema(flagView);
export const flagResponse = flagView;
export const changeLogResponse = pagedSchema(
  z.object({
    id: z.number(),
    occurredAt: z.date(),
    changeTarget: z.string(),
    namespaceOrFlagCode: z.string(),
    key: z.string().nullable(),
    oldValue: z.unknown(),
    newValue: z.unknown(),
    changedByAdminId: z.uuid(),
    reason: z.string(),
  }),
);
