import { afterEach, describe, expect, it, vi } from 'vitest';
import { appLink, appUrl, siteUrl } from '../src/site/config';

afterEach(() => vi.unstubAllEnvs());

describe('appLink', () => {
  it('points at the app when there is one', () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_APP_URL', 'https://app.komtru.com');
    expect(appLink('/login')).toBe('https://app.komtru.com/login');
  });

  it('drops a trailing slash rather than producing a double one', () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_APP_URL', 'https://app.komtru.com/');
    expect(appLink('/signup')).toBe('https://app.komtru.com/signup');
  });

  /*
   * The case that matters before launch: komtru.com is live and the app is not. Sending someone to
   * a host that does not resolve says "broken"; sending them to the waitlist says "not yet", which
   * is both true and the thing we want them to do.
   */
  it('sends people to the waitlist when no app is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_APP_URL', '');
    expect(appLink('/login')).toBe('/waitlist');
    expect(appLink('/signup')).toBe('/waitlist');
  });

  it('treats whitespace as absent', () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_APP_URL', '   ');
    expect(appUrl()).toBeUndefined();
  });
});

describe('siteUrl', () => {
  it('falls back to the production origin, so a QR code built at build time still works', () => {
    vi.stubEnv('NEXT_PUBLIC_KOMTRU_SITE_URL', '');
    expect(siteUrl()).toBe('https://komtru.com');
  });
});
