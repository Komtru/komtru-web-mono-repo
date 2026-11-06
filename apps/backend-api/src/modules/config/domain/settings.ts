// M17 section 4's seeded defaults, the typing rules for a stored value, and the guard that keeps a
// fee out of this table.
//
// Design 6.5 is the reason for the last of those: every fee and cut lives in config/fees.yaml, which
// is versioned, reviewed in a PR and snapshotted onto a trade when it is accepted. A fee typed into
// an admin screen would be none of those things, and would reprice the next trade silently.
export const VALUE_TYPES = ['INTEGER', 'BOOLEAN', 'STRING', 'DECIMAL'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];
export type SettingValue = number | boolean | string;

/** Lower snake case. Namespaces and keys end up in Redis keys and URLs, so nothing exotic. */
export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
/** A flag code may group with dots: `logistics.partner_companies_visible`. */
export const FLAG_CODE_PATTERN = /^[a-z][a-z0-9_]{0,62}(\.[a-z][a-z0-9_]{0,62}){0,3}$/;

export interface SettingDefinition {
  namespace: string;
  key: string;
  valueType: ValueType;
  value: SettingValue;
  description: string;
  /** Inclusive bounds for an INTEGER. A window of 0 or of ten years is a typo, not a decision. */
  min?: number;
  max?: number;
}

const days = (max = 90) => ({ min: 1, max });
const hours = (max = 24 * 30) => ({ min: 1, max });

export const SEED_SETTINGS: readonly SettingDefinition[] = [
  // M17 section 4.
  {
    namespace: 'disputes',
    key: 'evidence_window_days',
    valueType: 'INTEGER',
    value: 5,
    description: 'Days each party has to add evidence to a dispute (M3 D2).',
    ...days(),
  },
  {
    namespace: 'disputes',
    key: 'appeal_window_days',
    valueType: 'INTEGER',
    value: 7,
    description: 'Days after a dispute decision in which it can be appealed (M3 D5).',
    ...days(),
  },
  {
    namespace: 'tickets',
    key: 'reopen_window_days',
    valueType: 'INTEGER',
    value: 14,
    description: 'Days after resolution in which a support ticket can be reopened (M10 D4).',
    ...days(),
  },
  {
    namespace: 'reputation',
    key: 'rating_submission_window_days',
    valueType: 'INTEGER',
    value: 14,
    description: 'Days after completion in which a party can rate the other (M12 D2).',
    ...days(),
  },
  {
    namespace: 'notifications',
    key: 'max_retry_attempts',
    valueType: 'INTEGER',
    value: 5,
    description: 'Delivery attempts for one notification before it is given up on (M11 D3).',
    min: 1,
    max: 20,
  },
  {
    namespace: 'administration',
    key: 'impersonation_timeout_minutes',
    valueType: 'INTEGER',
    value: 30,
    description: 'Minutes before a staff impersonation session ends by itself (M14 D3).',
    min: 1,
    max: 240,
  },
  {
    namespace: 'trades',
    key: 'unconfirmed_delivery_grace_hours',
    valueType: 'INTEGER',
    value: 48,
    description: 'Hours a buyer has to confirm delivery before the trade moves on (M7 D4).',
    ...hours(),
  },
  // T-048 additions.
  {
    namespace: 'disputes',
    key: 'mediation_window_hours',
    valueType: 'INTEGER',
    value: 48,
    description: 'Hours of mediation between the parties before a dispute goes to a reviewer (C13).',
    ...hours(),
  },
  {
    namespace: 'park',
    key: 'custody_ageing_hours',
    valueType: 'INTEGER',
    value: 48,
    description: 'Hours a parcel can sit in Park custody before it is flagged as ageing.',
    ...hours(),
  },
  {
    namespace: 'park',
    key: 'pin_max_attempts',
    valueType: 'INTEGER',
    value: 3,
    description: 'Wrong PIN entries at a Park hub before the trade opens a custody case.',
    min: 1,
    max: 10,
  },
  {
    namespace: 'trades',
    key: 'payment_deadline_hours',
    valueType: 'INTEGER',
    value: 24,
    description: 'Hours a buyer has to fund an accepted trade before it lapses.',
    ...hours(),
  },
  {
    namespace: 'trades',
    key: 'delivery_deadline_days',
    valueType: 'INTEGER',
    value: 7,
    description: 'Days a seller has to deliver a funded trade before the buyer can cancel.',
    ...days(),
  },
];

export function findDefinition(namespace: string, key: string): SettingDefinition | undefined {
  return SEED_SETTINGS.find((setting) => setting.namespace === namespace && setting.key === key);
}

/**
 * Words that mean a price. Matched on whole tokens of the namespace and key, because "rate" inside
 * "rating_submission_window_days" is not a fee and a substring match would make the guard noisy
 * enough to switch off.
 */
const FEE_TOKENS = new Set([
  'fee',
  'fees',
  'commission',
  'commissions',
  'cut',
  'cuts',
  'rate',
  'rates',
  'bps',
  'percent',
  'percentage',
  'pct',
  'charge',
  'charges',
  'markup',
  'margin',
  'surcharge',
  'levy',
  'tariff',
  'price',
  'prices',
  'pricing',
  'kobo',
]);

/** True when any token of the namespace, key or flag code names a fee, commission or cut. */
export function looksLikeFee(...parts: string[]): boolean {
  return parts.some((part) => part.split(/[^a-z0-9]+/i).some((token) => FEE_TOKENS.has(token.toLowerCase())));
}

export type Validation = { ok: true; value: SettingValue } | { ok: false; message: string };

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** The stored type is the contract; the seeded bounds, where there are any, narrow it. */
export function validateSettingValue(
  definition: { valueType: ValueType; min?: number; max?: number },
  value: unknown,
): Validation {
  switch (definition.valueType) {
    case 'INTEGER': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return { ok: false, message: 'Expected a whole number' };
      }
      if (definition.min !== undefined && value < definition.min) {
        return { ok: false, message: `Must be at least ${definition.min}` };
      }
      if (definition.max !== undefined && value > definition.max) {
        return { ok: false, message: `Must be at most ${definition.max}` };
      }
      return { ok: true, value };
    }
    case 'BOOLEAN':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, message: 'Expected true or false' };
    case 'STRING':
      return typeof value === 'string' ? { ok: true, value } : { ok: false, message: 'Expected a string' };
    case 'DECIMAL':
      return typeof value === 'string' && DECIMAL.test(value)
        ? { ok: true, value }
        : { ok: false, message: 'Expected a decimal as a string, such as "1.25"' };
  }
}
