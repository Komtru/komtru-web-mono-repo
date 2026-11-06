import { describe, expect, it } from 'vitest';
import {
  SEED_CATEGORIES,
  resolveWindowExtension,
  standardBodySchema,
  validateItemSpec,
  type StandardContent,
} from '../../../../src/modules/config/domain/standards.js';
import { SEED_SETTINGS } from '../../../../src/modules/config/index.js';

const electronics = SEED_CATEGORIES.find((c) => c.code === 'electronics');
const fashion = SEED_CATEGORIES.find((c) => c.code === 'fashion');

describe('seeded categories', () => {
  it('launches Electronics and Fashion, and only those', () => {
    expect(SEED_CATEGORIES.map((c) => c.code)).toEqual(['electronics', 'fashion']);
  });

  it('Electronics requires brand, model, serial/IMEI and condition, and verifies the IMEI', () => {
    const required = electronics?.standard.itemSpecFields.filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(expect.arrayContaining(['brand', 'model', 'serial_imei', 'condition']));
    expect(electronics?.standard.imeiVerification).toBe(true);
  });

  it('Fashion does not verify an IMEI', () => {
    expect(fashion?.standard.imeiVerification).toBe(false);
  });

  it('every seeded standard passes its own schema', () => {
    for (const c of SEED_CATEGORIES) expect(standardBodySchema.safeParse(c.standard).success).toBe(true);
  });
});

describe('standardBodySchema', () => {
  const base: StandardContent = {
    inspectionWindowHours: 48,
    itemSpecFields: [{ key: 'brand', label: 'Brand', required: true }],
    proofMedia: { minPhotos: 2, requireVideo: false },
    imeiVerification: false,
    deliveryDeadlineDays: 7,
  };

  it('accepts a well-formed standard', () => {
    expect(standardBodySchema.safeParse(base).success).toBe(true);
  });

  it('refuses an unknown member, so a fee cannot ride along', () => {
    expect(standardBodySchema.safeParse({ ...base, buyerProtectionFee: 100 }).success).toBe(false);
  });

  it('refuses a fee-like item-spec field key', () => {
    const bad = { ...base, itemSpecFields: [{ key: 'commission_rate', label: 'x', required: false }] };
    expect(standardBodySchema.safeParse(bad).success).toBe(false);
  });

  it('refuses IMEI verification without a serial_imei field', () => {
    expect(standardBodySchema.safeParse({ ...base, imeiVerification: true }).success).toBe(false);
  });

  it('refuses duplicate field keys and out-of-range windows', () => {
    const dup = { ...base, itemSpecFields: [base.itemSpecFields[0], base.itemSpecFields[0]] };
    expect(standardBodySchema.safeParse(dup).success).toBe(false);
    expect(standardBodySchema.safeParse({ ...base, inspectionWindowHours: 0 }).success).toBe(false);
    expect(standardBodySchema.safeParse({ ...base, inspectionWindowHours: 24 * 31 }).success).toBe(false);
  });
});

describe('resolveWindowExtension (BEI1)', () => {
  const input = { standardHours: 48, currentHours: 48, maxExtensionHours: 24 };

  it('allows a longer window up to the cap above the standard', () => {
    expect(resolveWindowExtension({ ...input, requestedHours: 60 })).toEqual({ ok: true, hours: 60 });
    expect(resolveWindowExtension({ ...input, requestedHours: 72 })).toEqual({ ok: true, hours: 72 });
  });

  it('refuses the same window and any shorter one', () => {
    expect(resolveWindowExtension({ ...input, requestedHours: 48 }).ok).toBe(false);
    expect(resolveWindowExtension({ ...input, requestedHours: 24 }).ok).toBe(false);
  });

  it('refuses shortening an already extended window', () => {
    expect(resolveWindowExtension({ ...input, currentHours: 60, requestedHours: 54 }).ok).toBe(false);
  });

  it('refuses anything beyond the cap', () => {
    const result = resolveWindowExtension({ ...input, requestedHours: 73 });
    expect(result).toMatchObject({ ok: false });
  });

  it('refuses a non-integer or non-positive request', () => {
    expect(resolveWindowExtension({ ...input, requestedHours: 60.5 }).ok).toBe(false);
    expect(resolveWindowExtension({ ...input, requestedHours: -5 }).ok).toBe(false);
  });
});

describe('validateItemSpec', () => {
  const standard = electronics!.standard;

  it('passes a complete spec', () => {
    const spec = { brand: 'Apple', model: '15', serial_imei: '356938035643809', condition: 'USED_GOOD' };
    expect(validateItemSpec(standard, spec)).toEqual({ ok: true });
  });

  it('names every missing required field', () => {
    const result = validateItemSpec(standard, { brand: 'Apple' });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.missing.sort()).toEqual(['condition', 'model', 'serial_imei']);
  });

  it('treats a blank value as missing', () => {
    const result = validateItemSpec(standard, { brand: ' ', model: 'x', serial_imei: 'y', condition: 'z' });
    expect(result.ok).toBe(false);
  });
});

describe('the window-extension cap setting', () => {
  it('is seeded, as an integer, and is not a fee', () => {
    const s = SEED_SETTINGS.find(
      (x) => x.namespace === 'trades' && x.key === 'inspection_window_max_extension_hours',
    );
    expect(s?.valueType).toBe('INTEGER');
    expect(s?.value).toBeGreaterThan(0);
  });
});
