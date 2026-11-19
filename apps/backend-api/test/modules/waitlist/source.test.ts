import { describe, expect, it } from 'vitest';
import { readSource } from '../../../src/modules/waitlist/domain/source.js';

/**
 * One backend serves both the marketing site and the app, so this is the only thing separating the
 * real launch list from test signups. It is read from `Origin`, which a browser sets and the page's
 * own JavaScript cannot change — a signal, not a fact, and nothing is granted on the strength of it.
 */
describe('readSource', () => {
  it.each([
    ['https://komtru.com', 'PROD'],
    ['https://www.komtru.com', 'PROD'],
    ['https://staging.komtru.com', 'STAGING'],
    ['http://localhost:3005', 'LOCAL'],
  ])('reads %s as %s', (origin, expected) => {
    expect(readSource(origin)).toBe(expected);
  });

  it('is not confused by case or a trailing slash', () => {
    expect(readSource('HTTPS://Komtru.com/')).toBe('PROD');
  });

  /* Vercel builds every branch and pull request on a generated host. */
  it('reads a Vercel build as a preview', () => {
    expect(readSource('https://komtru-web-site-git-foo-komtru.vercel.app')).toBe('PREVIEW');
  });

  /*
   * The one that matters. A missing Origin means the caller was not a browser — a curl, a probe,
   * something server-side — and an unrecognised one means a host nobody configured. Filing either
   * under PROD would quietly inflate the only number this column exists to produce.
   */
  it.each([undefined, '', '   ', 'null', 'not a url', 'https://komtru.com.evil.test'])(
    'refuses to call %s production',
    (origin) => {
      expect(readSource(origin)).toBe('UNKNOWN');
    },
  );

  it('does not treat a lookalike host as Komtru', () => {
    expect(readSource('https://notkomtru.com')).toBe('UNKNOWN');
    expect(readSource('https://komtru.com.attacker.example')).toBe('UNKNOWN');
  });
});
