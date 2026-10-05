import { describe, expect, it } from 'vitest';
import {
  classifyIdentifier,
  DEFAULT_COUNTRY,
  generatePublicId,
  isApplePrivateRelay,
  isValidEmail,
  maskEmail,
  maskPhone,
  normaliseEmail,
  normalisePhone,
  phoneReverifyAfter,
} from '../../src/platform/identifiers.js';

describe('normaliseEmail', () => {
  it('lowercases and trims, keeping the address the user typed', () => {
    expect(normaliseEmail('  Jane.Doe@Example.COM ')).toEqual({
      email: 'jane.doe@example.com',
      emailNormal: 'jane.doe@example.com',
      domain: 'example.com',
    });
  });

  it('folds dots and +tags for gmail, and googlemail onto gmail', () => {
    expect(normaliseEmail('J.ane+komtru@googlemail.com')).toEqual({
      email: 'j.ane+komtru@googlemail.com',
      emailNormal: 'jane@gmail.com',
      domain: 'googlemail.com',
    });
  });

  it.each([
    ['jane.doe+x@outlook.com', 'jane.doe@outlook.com'],
    ['jane.doe+x@yahoo.com', 'jane.doe@yahoo.com'],
    ['jane.doe+x@icloud.com', 'jane.doe@icloud.com'],
    ['jane.doe+x@proton.me', 'jane.doe@proton.me'],
  ])('folds +tags only, for %s', (raw, expected) => {
    expect(normaliseEmail(raw).emailNormal).toBe(expected);
  });

  it('leaves an unknown provider alone', () => {
    expect(normaliseEmail('j.a+n@komtru.com').emailNormal).toBe('j.a+n@komtru.com');
  });

  it('keeps a local part that is only a +tag rather than folding it to nothing', () => {
    expect(normaliseEmail('+komtru@gmail.com').emailNormal).toBe('+komtru@gmail.com');
  });

  it('throws on a value that is not an email', () => {
    expect(() => normaliseEmail('jane')).toThrow(/not an email/);
    expect(() => normaliseEmail('@example.com')).toThrow(/not an email/);
  });
});

describe('isValidEmail', () => {
  it.each(['jane@example.com', 'a@b.co', "o'brien@sub.example.ng", ' jane@example.com '])(
    'accepts %s',
    (value) => {
      expect(isValidEmail(value)).toBe(true);
    },
  );

  it.each([
    '',
    'jane',
    'jane@',
    '@example.com',
    'jane@localhost',
    'ja ne@example.com',
    'jane@example..com',
    `${'a'.repeat(250)}@example.com`,
  ])('rejects %s', (value) => {
    expect(isValidEmail(value)).toBe(false);
  });

  it('validates a long non-matching domain in linear time', () => {
    const started = performance.now();
    expect(isValidEmail(`a@${'a'.repeat(50_000)}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('masking and provider checks', () => {
  it('spots an apple private relay address', () => {
    expect(isApplePrivateRelay(' Jane@PrivateRelay.appleid.com ')).toBe(true);
    expect(isApplePrivateRelay('jane@icloud.com')).toBe(false);
  });

  it('masks an email to its first character', () => {
    expect(maskEmail('jane@gmail.com')).toBe('j•••@gmail.com');
    expect(maskEmail('not-an-email')).toBe('•••');
  });

  it('masks a phone to its first seven and last four digits', () => {
    expect(maskPhone('+2348012345678')).toBe('+234801•••5678');
    expect(maskPhone('+234801')).toBe('•••');
  });

  it('refuses to half-mask a number short enough that the mask would reveal every digit', () => {
    // 7 leading + 4 trailing is the whole of an 11-character number, and overlaps on a shorter one.
    expect(maskPhone('+2348012345')).toBe('•••');
    expect(maskPhone('+234801234')).toBe('•••');
  });
});

describe('normalisePhone', () => {
  it('defaults to Nigeria', () => {
    expect(DEFAULT_COUNTRY).toBe('NG');
    expect(normalisePhone('0801 234 5678')).toEqual({ phoneE164: '+2348012345678', countryCode: 'NG' });
  });

  it('normalises an already-international number regardless of the default', () => {
    expect(normalisePhone('+44 20 7946 0958')).toEqual({
      phoneE164: '+442079460958',
      countryCode: 'GB',
    });
  });

  it('honours an explicit default country', () => {
    expect(normalisePhone('(415) 555-2671', 'US')).toEqual({
      phoneE164: '+14155552671',
      countryCode: 'US',
    });
  });

  it.each(['', '12', '0801234567', 'not a phone'])('returns null for %s', (value) => {
    expect(normalisePhone(value)).toBeNull();
  });

  it('re-verifies a year out', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(phoneReverifyAfter(from).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('generatePublicId', () => {
  it('generates KMT-U-XXXXXX from an alphabet without I, L, O or U', () => {
    for (let i = 0; i < 500; i += 1) expect(generatePublicId()).toMatch(/^KMT-U-[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it('honours a custom prefix', () => {
    expect(generatePublicId('KMT-T')).toMatch(/^KMT-T-[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePublicId()));
    expect(ids.size).toBe(1000);
  });
});

describe('classifyIdentifier', () => {
  it.each([
    ['jane@x.com', 'EMAIL'],
    ['@janedoe', 'USERNAME'],
    ['  @jane ', 'USERNAME'],
    ['+2348012345678', 'PHONE'],
    ['0801 234 5678', 'PHONE'],
    ['(0801) 234-5678', 'PHONE'],
    ['janedoe', 'USERNAME'],
    ['jane_doe', 'USERNAME'],
  ] as const)('classifies %s as %s', (raw, kind) => {
    expect(classifyIdentifier(raw)).toBe(kind);
  });
});
