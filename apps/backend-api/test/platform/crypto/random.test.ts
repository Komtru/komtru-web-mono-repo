import { describe, expect, it } from 'vitest';
import { randomNumericCode, randomToken } from '../../../src/platform/crypto/random.js';

describe('randomToken', () => {
  it('returns url-safe tokens of the requested entropy', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).toHaveLength(43); // 32 bytes, base64url, unpadded
    expect(randomToken(16)).toHaveLength(22);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => randomToken()));
    expect(tokens.size).toBe(1000);
  });

  it.each([0, 8, -1])('rejects %i bytes as too little entropy', (bytes) => {
    expect(() => randomToken(bytes)).toThrow(/16/);
  });

  it('rejects a fractional byte count rather than quietly rounding it down', () => {
    expect(() => randomToken(20.5)).toThrow(/whole number/);
  });
});

describe('randomNumericCode', () => {
  it.each([4, 6])('returns exactly %i digits, zero-padded', (digits) => {
    const pattern = new RegExp(`^\\d{${digits}}$`);
    for (let i = 0; i < 2000; i += 1) expect(randomNumericCode(digits)).toMatch(pattern);
  });

  it('defaults to six digits', () => {
    expect(randomNumericCode()).toMatch(/^\d{6}$/);
  });

  it('covers the whole range, including the zero-padded low end', () => {
    const codes = Array.from({ length: 20_000 }, () => randomNumericCode(4));
    expect(codes.some((code) => code < '1000')).toBe(true);
    expect(codes.some((code) => code >= '9000')).toBe(true);
  });

  it('is close to uniform', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 60_000; i += 1) {
      const code = randomNumericCode(1);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    expect(counts.size).toBe(10);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(6000 * 0.85);
      expect(count).toBeLessThan(6000 * 1.15);
    }
  });

  it.each([0, -1, 15, 20])('rejects %i digits', (digits) => {
    expect(() => randomNumericCode(digits)).toThrow(/1 and 14/);
  });
});
