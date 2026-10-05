import { describe, expect, it } from 'vitest';
import { CURRENCIES, currencySchema, SESSION_SCOPES, sessionScopeSchema } from '../src/enums.js';
import {
  hubCodeSchema,
  publicUserIdSchema,
  TRADE_CODE_EXAMPLE,
  tradeCodeSchema,
  uuidSchema,
} from '../src/ids.js';

describe('uuidSchema', () => {
  it('accepts a UUID and lower-cases it', () => {
    expect(uuidSchema.parse('0199A2B3-C4D5-7E6F-8A9B-0C1D2E3F4A5B')).toBe(
      '0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b',
    );
  });

  it('rejects anything else', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('publicUserIdSchema', () => {
  it.each(['KMT-U-7F3K9Q', 'KMT-U-000000'])('accepts %s', (id) => {
    expect(publicUserIdSchema.parse(id)).toBe(id);
  });

  it.each(['KMT-U-7F3K9', 'KMT-U-7F3K9QQ', 'KMT-U-ILOU00', 'kmt-u-7f3k9q'])('rejects %s', (id) => {
    expect(publicUserIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('tradeCodeSchema', () => {
  it('issues the canonical example format', () => {
    expect(TRADE_CODE_EXAMPLE).toBe('KMT-7398512-NG');
    expect(tradeCodeSchema.parse(TRADE_CODE_EXAMPLE)).toBe(TRADE_CODE_EXAMPLE);
  });

  it.each([
    ['kmt-7398512-ng', 'KMT-7398512-NG'],
    [' KMT-7398512 ', 'KMT-7398512-NG'],
    ['KMT-88213', 'KMT-88213-NG'],
    ['KMT-90301-NG', 'KMT-90301-NG'],
  ])('normalises %j to %s', (input, canonical) => {
    expect(tradeCodeSchema.parse(input)).toBe(canonical);
  });

  it.each(['KMT-1234', 'KMT-123456789', 'TRD-7398512', 'KMT-73985A2', 'KMT-7398512-GH'])(
    'rejects %s',
    (input) => {
      expect(tradeCodeSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('hubCodeSchema', () => {
  it('accepts the reference format', () => {
    expect(hubCodeSchema.parse('H-JIB-004')).toBe('H-JIB-004');
  });

  it.each(['H-JI-004', 'H-JIB-04', 'h-jib-004x'])('rejects %s', (code) => {
    expect(hubCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe('enums', () => {
  it('defines the three session scopes and the one currency', () => {
    expect(SESSION_SCOPES).toEqual(['CONSUMER', 'STAFF', 'LOGISTICS']);
    expect(sessionScopeSchema.safeParse('PARK').success).toBe(false);
    expect(CURRENCIES).toEqual(['NGN']);
    expect(currencySchema.parse('NGN')).toBe('NGN');
  });
});
