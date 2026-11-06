// M17 / T-049: Trade Standards by category (HTML CTS1). A standard is set by Komtru and is the same
// for every seller in a category. It carries no fee of any kind (design 6.5): the body schema is
// strict, and a field key that looks like a fee is refused.
import { z } from 'zod';
import { looksLikeFee } from './settings.js';

export const INSPECTION_WINDOW_MAX_HOURS = 24 * 30;
export const IMEI_FIELD_KEY = 'serial_imei';

const FIELD_KEY = /^[a-z][a-z0-9_]{0,40}$/;

export const itemSpecFieldSchema = z.strictObject({
  key: z
    .string()
    .regex(FIELD_KEY)
    .refine((key) => !looksLikeFee(key), 'A fee is not an item-spec field'),
  label: z.string().min(1).max(80),
  required: z.boolean(),
});

export const standardObject = z.strictObject({
  inspectionWindowHours: z.int().min(1).max(INSPECTION_WINDOW_MAX_HOURS),
  itemSpecFields: z.array(itemSpecFieldSchema).min(1).max(30),
  proofMedia: z.strictObject({
    minPhotos: z.int().min(0).max(20),
    requireVideo: z.boolean(),
  }),
  imeiVerification: z.boolean(),
  deliveryDeadlineDays: z.int().min(1).max(90),
});

/** Cross-field rules, shared by the body schema and the admin route's body (which adds `reason`). */
export function checkStandardRules(
  value: Pick<StandardContent, 'itemSpecFields' | 'imeiVerification'>,
  ctx: z.RefinementCtx,
): void {
  const keys = value.itemSpecFields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: 'custom', path: ['itemSpecFields'], message: 'Field keys must be unique' });
  }
  if (value.imeiVerification && !keys.includes(IMEI_FIELD_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['imeiVerification'],
      message: `IMEI verification needs a ${IMEI_FIELD_KEY} item-spec field`,
    });
  }
}

export const standardBodySchema = standardObject.superRefine(checkStandardRules);

export type StandardContent = z.infer<typeof standardObject>;

export interface SeedCategory {
  code: string;
  name: string;
  standard: StandardContent;
}

/**
 * Launch categories (T-049). The numbers are placeholders no spec states: the window mirrors the
 * unconfirmed-delivery grace (48h), the delivery deadline mirrors `trades.delivery_deadline_days` (7).
 * Product owner to confirm.
 */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  {
    code: 'electronics',
    name: 'Electronics',
    standard: {
      inspectionWindowHours: 48,
      itemSpecFields: [
        { key: 'brand', label: 'Brand', required: true },
        { key: 'model', label: 'Model', required: true },
        { key: IMEI_FIELD_KEY, label: 'Serial number or IMEI', required: true },
        { key: 'condition', label: 'Condition', required: true },
      ],
      proofMedia: { minPhotos: 4, requireVideo: true },
      imeiVerification: true,
      deliveryDeadlineDays: 7,
    },
  },
  {
    code: 'fashion',
    name: 'Fashion',
    standard: {
      inspectionWindowHours: 48,
      itemSpecFields: [
        { key: 'brand', label: 'Brand', required: true },
        { key: 'size', label: 'Size', required: true },
        { key: 'condition', label: 'Condition', required: true },
        { key: 'colour', label: 'Colour', required: false },
      ],
      proofMedia: { minPhotos: 3, requireVideo: false },
      imeiVerification: false,
      deliveryDeadlineDays: 7,
    },
  },
];

export type WindowExtension =
  | { ok: true; hours: number }
  | { ok: false; reason: 'NOT_LONGER' | 'ABOVE_CAP' | 'INVALID'; message: string };

/**
 * BEI1: the only direction a buyer can move a window is longer. The request must exceed the window in
 * force, and the extension over the category's standard window may not exceed the configured maximum
 * (an extension is measured from the standard, so repeated requests cannot creep past the cap).
 */
export function resolveWindowExtension(input: {
  standardHours: number;
  currentHours: number;
  requestedHours: number;
  maxExtensionHours: number;
}): WindowExtension {
  const { standardHours, currentHours, requestedHours, maxExtensionHours } = input;
  if (!Number.isSafeInteger(requestedHours) || requestedHours <= 0) {
    return { ok: false, reason: 'INVALID', message: 'The window must be a whole number of hours' };
  }
  if (requestedHours <= currentHours) {
    return { ok: false, reason: 'NOT_LONGER', message: 'A buyer can only ask for a longer window' };
  }
  if (requestedHours - standardHours > maxExtensionHours) {
    return {
      ok: false,
      reason: 'ABOVE_CAP',
      message: `A window can be extended by at most ${maxExtensionHours} hours beyond the standard`,
    };
  }
  return { ok: true, hours: requestedHours };
}

export type ItemSpecCheck = { ok: true } | { ok: false; missing: string[] };

/** For trade creation: every required field must be present and non-blank. */
export function validateItemSpec(
  standard: Pick<StandardContent, 'itemSpecFields'>,
  spec: Record<string, unknown>,
): ItemSpecCheck {
  const missing = standard.itemSpecFields
    .filter((field) => field.required)
    .filter((field) => {
      const value = spec[field.key];
      return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    })
    .map((field) => field.key);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
