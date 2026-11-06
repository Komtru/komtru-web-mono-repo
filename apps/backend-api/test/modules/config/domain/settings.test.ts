import { describe, expect, it } from 'vitest';
import {
  FLAG_CODE_PATTERN,
  SEED_SETTINGS,
  SETTING_KEY_PATTERN,
  findDefinition,
  looksLikeFee,
  validateSettingValue,
} from '../../../../src/modules/config/domain/settings.js';

const seedValue = (namespace: string, key: string) =>
  SEED_SETTINGS.find((s) => s.namespace === namespace && s.key === key)?.value;

describe('seed settings', () => {
  it('carries every M17 section 4 default', () => {
    expect(seedValue('disputes', 'evidence_window_days')).toBe(5);
    expect(seedValue('disputes', 'appeal_window_days')).toBe(7);
    expect(seedValue('tickets', 'reopen_window_days')).toBe(14);
    expect(seedValue('reputation', 'rating_submission_window_days')).toBe(14);
    expect(seedValue('notifications', 'max_retry_attempts')).toBe(5);
    expect(seedValue('administration', 'impersonation_timeout_minutes')).toBe(30);
    expect(seedValue('trades', 'unconfirmed_delivery_grace_hours')).toBe(48);
  });

  it('carries the T-048 additions', () => {
    expect(seedValue('disputes', 'mediation_window_hours')).toBe(48);
    expect(seedValue('park', 'custody_ageing_hours')).toBe(48);
    expect(seedValue('park', 'pin_max_attempts')).toBe(3);
    expect(seedValue('trades', 'payment_deadline_hours')).toBeTypeOf('number');
    expect(seedValue('trades', 'delivery_deadline_days')).toBeTypeOf('number');
  });

  it('has unique, well-formed keys with a description each, and a value that passes its own type', () => {
    const seen = new Set<string>();
    for (const setting of SEED_SETTINGS) {
      const id = `${setting.namespace}.${setting.key}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
      expect(setting.namespace).toMatch(SETTING_KEY_PATTERN);
      expect(setting.key).toMatch(SETTING_KEY_PATTERN);
      expect(setting.description.length).toBeGreaterThan(10);
      expect(validateSettingValue(setting, setting.value).ok, id).toBe(true);
    }
  });

  it('stores no fee or cut: no seeded key looks like one (design 6.5)', () => {
    for (const setting of SEED_SETTINGS) {
      expect(looksLikeFee(setting.namespace, setting.key), `${setting.namespace}.${setting.key}`).toBe(false);
    }
  });
});

describe('looksLikeFee', () => {
  it.each([
    ['trades', 'buyer_protection_fee_bps'],
    ['trades', 'seller_commission'],
    ['park', 'cash_handling_fee'],
    ['payouts', 'payout_fee_kobo'],
    ['trades', 'platform_cut_percent'],
    ['merchant', 'commission_rate'],
    ['fees', 'anything'],
    ['trades', 'markup'],
    ['trades', 'platformfee'],
    ['trades', 'sellercommission'],
    ['trades', 'feeschedule'],
    ['trades', 'PlatformFee'],
    ['trades', 'platform-fee-bps'],
    ['trades', 'take_rate'],
    ['payouts', 'payout_share'],
    ['trades', 'royalty_pool'],
    ['trades', 'margin'],
    ['trades', 'seller_discount'],
    ['trades', 'rate_limit_per_minute'],
  ])('flags %s.%s', (namespace, key) => {
    expect(looksLikeFee(namespace, key)).toBe(true);
  });

  it.each([
    ['disputes', 'evidence_window_days'],
    ['reputation', 'rating_submission_window_days'],
    ['notifications', 'max_retry_attempts'],
    ['park', 'pin_max_attempts'],
    ['trades', 'delivery_deadline_days'],
    ['trades', 'payment_deadline_hours'],
    ['park', 'custody_ageing_hours'],
    ['trades', 'crate_size'],
    ['trades', 'share_link_ttl_hours'],
  ])('does not flag %s.%s', (namespace, key) => {
    expect(looksLikeFee(namespace, key)).toBe(false);
  });
});

describe('validateSettingValue', () => {
  it('checks the stored type', () => {
    expect(validateSettingValue({ valueType: 'INTEGER' }, 7).ok).toBe(true);
    expect(validateSettingValue({ valueType: 'INTEGER' }, 7.5).ok).toBe(false);
    expect(validateSettingValue({ valueType: 'INTEGER' }, '7').ok).toBe(false);
    expect(validateSettingValue({ valueType: 'BOOLEAN' }, true).ok).toBe(true);
    expect(validateSettingValue({ valueType: 'BOOLEAN' }, 'true').ok).toBe(false);
    expect(validateSettingValue({ valueType: 'STRING' }, 'x').ok).toBe(true);
    expect(validateSettingValue({ valueType: 'STRING' }, 3).ok).toBe(false);
    expect(validateSettingValue({ valueType: 'DECIMAL' }, '1.25').ok).toBe(true);
    // A decimal is a string on the wire so a float never rounds it.
    expect(validateSettingValue({ valueType: 'DECIMAL' }, 1.25).ok).toBe(false);
    expect(validateSettingValue({ valueType: 'DECIMAL' }, '1.2.5').ok).toBe(false);
  });

  it('enforces the seeded bounds, so a window cannot be set to zero or to a year of hours', () => {
    const def = findDefinition('park', 'pin_max_attempts');
    expect(def).toBeDefined();
    expect(validateSettingValue(def!, 0).ok).toBe(false);
    expect(validateSettingValue(def!, 3).ok).toBe(true);
    expect(validateSettingValue(def!, 1000).ok).toBe(false);
  });
});

describe('validateSettingValue, strings and decimals', () => {
  it('trims a string and refuses an empty one', () => {
    expect(validateSettingValue({ valueType: 'STRING' }, '  hello ')).toEqual({ ok: true, value: 'hello' });
    expect(validateSettingValue({ valueType: 'STRING' }, '   ').ok).toBe(false);
    expect(validateSettingValue({ valueType: 'STRING' }, '').ok).toBe(false);
  });

  it('enforces a decimal min, max and scale', () => {
    const def = { valueType: 'DECIMAL' as const, min: 0, max: 10, maxScale: 2 };
    expect(validateSettingValue(def, '1.25').ok).toBe(true);
    expect(validateSettingValue(def, '1.255').ok).toBe(false);
    expect(validateSettingValue(def, '-0.5').ok).toBe(false);
    expect(validateSettingValue(def, '10.01').ok).toBe(false);
    expect(validateSettingValue(def, '10').ok).toBe(true);
  });
});

describe('flag codes', () => {
  it('are lower snake with dots for grouping', () => {
    expect(FLAG_CODE_PATTERN.test('logistics.partner_companies_visible')).toBe(true);
    expect(FLAG_CODE_PATTERN.test('Bad Code')).toBe(false);
  });
});
