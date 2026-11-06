// What M17 publishes (spec section 5), through the transactional outbox. The platform requires three
// segments in an event type, so spec's config.setting_changed is config.setting.changed here and
// config.feature_flag_toggled is config.feature_flag.toggled.
import { defineEvent } from '@komtru/shared-types';
import { z } from 'zod';

const settingValue = z.union([z.number(), z.boolean(), z.string()]);

/** Consumed by Administration and Audit, and by this module's own cache invalidation. */
export const settingChanged = defineEvent(
  'config.setting.changed',
  1,
  z.object({
    namespace: z.string().min(1),
    key: z.string().min(1),
    oldValue: settingValue.nullable(),
    newValue: settingValue,
  }),
);

export const featureFlagToggled = defineEvent(
  'config.feature_flag.toggled',
  1,
  z.object({ flagCode: z.string().min(1), enabled: z.boolean() }),
);

/** T-049: a new trade standard version was published. */
export const tradeStandardChanged = defineEvent(
  'config.trade_standard.changed',
  1,
  z.object({
    categoryCode: z.string().min(1),
    versionId: z.uuid(),
    versionNumber: z.int().min(1),
  }),
);
