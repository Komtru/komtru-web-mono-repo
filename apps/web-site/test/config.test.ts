import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, siteUrl } from '../src/site/config';

afterEach(() => vi.unstubAllEnvs());

describe('apiUrl', () => {
  it('drops a trailing slash rather than producing a double one', () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', 'https://api.komtru.com/v1/');
    expect(apiUrl()).toBe('https://api.komtru.com/v1');
  });

  it('treats whitespace as absent, so the waitlist form says so instead of posting to nowhere', () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_API_URL', '   ');
    expect(apiUrl()).toBeUndefined();
  });
});

describe('siteUrl', () => {
  it('falls back to the production origin, so a QR code built at build time still works', () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_SITE_URL', '');
    expect(siteUrl()).toBe('https://komtru.com');
  });
});
