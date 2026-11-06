// What M17 publishes (spec section 5), through the transactional outbox.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';

const settingValue = z.union([z.number(), z.boolean(), z.string()]);

/** Consumed by Administration and Audit, and by this module's own cache invalidation. */
export const settingChanged = defineEvent(
  'config.setting_changed',
  1,
  z.object({
    namespace: z.string().min(1),
    key: z.string().min(1),
    oldValue: settingValue.nullable(),
    newValue: settingValue,
  }),
);

export const featureFlagToggled = defineEvent(
  'config.feature_flag_toggled',
  1,
  z.object({ flagCode: z.string().min(1), enabled: z.boolean() }),
);
