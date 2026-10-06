// RFC 6238's own test vectors, which is the whole reason this build writes TOTP rather than
// installing it: a library can only be trusted, and these can be checked.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCodeAt,
  totpStep,
  verifyTotp,
} from '../../../../../src/modules/identity/domain/mfa/totp.js';

/** RFC 6238 Appendix B's shared secret for SHA-1: the ASCII "12345678901234567890". */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32 (RFC 4648)', () => {
  it('round-trips every length a secret can take', () => {
    for (let length = 1; length <= 64; length += 1) {
      const bytes = randomBytes(length);
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });

  it('encodes without padding, which is what an otpauth URI carries', () => {
    expect(base32Encode(Buffer.from('12345678901234567890', 'ascii'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
  });

  it('accepts lower case, spaces and padding, because screen TF1 prints the secret for a human', () => {
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(
      Buffer.from('12345678901234567890', 'ascii'),
    );
    expect(base32Decode('MZXW6===')).toEqual(Buffer.from('foo', 'ascii'));
  });

  it('answers null for a character the alphabet does not contain', () => {
    expect(base32Decode('!!!!')).toBeNull();
    expect(base32Decode('MZXW6181')).toBeNull();
  });
});

describe('totpCodeAt — RFC 6238 Appendix B, the SHA-1 rows', () => {
  const vectors: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  for (const [unixSeconds, expected] of vectors) {
    it(`matches the published code at t=${unixSeconds}`, () => {
      expect(totpCodeAt(RFC_SECRET, Math.floor(unixSeconds / TOTP_STEP_SECONDS))).toBe(expected);
    });
  }

  it('derives the same step from milliseconds', () => {
    expect(totpStep(1111111109_000)).toBe(37037036);
  });
});

describe('verifyTotp', () => {
  const now = 1111111109_000;
  const step = totpStep(now);

  it('accepts the current step and one step either side', () => {
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + offset), { atMs: now })).toEqual({
        ok: true,
        step: step + offset,
      });
    }
  });

  it('rejects a code two steps away', () => {
    for (const offset of [-2, 2]) {
      expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + offset), { atMs: now }).ok).toBe(false);
    }
  });

  /**
   * The replay a 30-second window makes possible: somebody reads the code over the user's shoulder
   * and spends it before it rolls over. Nothing in RFC 6238 stops that; refusing a step already
   * spent is what does, and it costs one column we already have (`mfa_factors.last_used_at`).
   */
  it('refuses a code whose step has already been spent', () => {
    const code = totpCodeAt(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, { atMs: now, afterStep: step })).toEqual({ ok: false, step: null });
    expect(verifyTotp(RFC_SECRET, code, { atMs: now, afterStep: step - 1 })).toEqual({ ok: true, step });
  });

  it('rejects malformed input without throwing', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', '  ']) {
      expect(verifyTotp(RFC_SECRET, code, { atMs: now }).ok).toBe(false);
    }
  });

  it('rejects rather than throws when the stored secret is not base32', () => {
    expect(verifyTotp('not base32!', '000000', { atMs: now }).ok).toBe(false);
  });
});

describe('generateTotpSecret', () => {
  it('draws 160 bits, which is RFC 4226 section 4 R6', () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('does not repeat', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
  });
});

describe('otpauthUri', () => {
  it('builds the URI screen TF1 encodes into its QR code', () => {
    expect(
      otpauthUri({ secretBase32: 'JBSWY3DPEHPK3PXP', accountName: 'jane@example.com', issuer: 'Komtru' }),
    ).toBe(
      'otpauth://totp/Komtru:jane%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Komtru&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('escapes a colon in the account name, which would otherwise forge the issuer prefix', () => {
    expect(otpauthUri({ secretBase32: 'JBSW', accountName: 'a:b', issuer: 'Komtru' })).toContain(
      '/Komtru:a%3Ab?',
    );
  });
});
