import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIVACY_VERSION,
  DEFAULT_TERMS_VERSION,
  resolveTermsVersions,
  termsUpToDate,
} from '../../../../src/modules/identity/domain/terms.js';

const current = { termsVersion: '2026-08-01', privacyVersion: '2026-08-01' };

describe('terms acceptance (TOS1, TOS2, NDPA §15)', () => {
  it('ships a version for both documents', () => {
    expect(DEFAULT_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DEFAULT_PRIVACY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to the shipped version when an operator has set no override', () => {
    expect(resolveTermsVersions({})).toEqual({
      termsVersion: DEFAULT_TERMS_VERSION,
      privacyVersion: DEFAULT_PRIVACY_VERSION,
    });
    expect(resolveTermsVersions({ version: '2026-09-01' })).toEqual({
      termsVersion: '2026-09-01',
      privacyVersion: DEFAULT_PRIVACY_VERSION,
    });
  });

  it('is up to date only when BOTH accepted versions are the current ones', () => {
    expect(
      termsUpToDate({ ...current, acceptedTermsVersion: '2026-08-01', acceptedPrivacyVersion: '2026-08-01' }),
    ).toBe(true);
    expect(
      termsUpToDate({ ...current, acceptedTermsVersion: '2026-01-01', acceptedPrivacyVersion: '2026-08-01' }),
    ).toBe(false);
    expect(
      termsUpToDate({ ...current, acceptedTermsVersion: '2026-08-01', acceptedPrivacyVersion: '2026-01-01' }),
    ).toBe(false);
  });

  it('treats a user who has never accepted anything as out of date (TOS1)', () => {
    expect(termsUpToDate({ ...current, acceptedTermsVersion: null, acceptedPrivacyVersion: null })).toBe(
      false,
    );
  });
});
