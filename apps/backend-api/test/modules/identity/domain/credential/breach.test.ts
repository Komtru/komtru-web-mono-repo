import { describe, expect, it } from 'vitest';
import {
  checkPasswordBreached,
  findSuffixCount,
  sha1Hex,
} from '../../../../../src/modules/identity/domain/credential/breach.js';
import { pino } from 'pino';

const silent = pino({ level: 'silent' });

/** A fetch that records every URL it was given and answers with one canned body. */
const recordingFetch = (body: string, init?: ResponseInit) => {
  const urls: string[] = [];
  const fn = (url: string | URL | Request): Promise<Response> => {
    urls.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
    return Promise.resolve(new Response(body, init));
  };
  return { urls, fetch: fn };
};

describe('breach corpus check', () => {
  it('matches a suffix on the line key, never as a substring of the body', () => {
    const body = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0018ABCDEF0123456789ABCDEF0123456789ABC\r\nBBBBB:7';
    expect(findSuffixCount(body, 'BBBBB')).toBe(7);
    expect(findSuffixCount(body, '0018ABCDEF0123456789ABCDEF0123456789ABC')).toBe(0);
  });

  it('sends only the first five hex characters of the SHA-1 and never the rest', async () => {
    const { urls, fetch } = recordingFetch('ABC:3');
    await checkPasswordBreached({ enabled: true, logger: silent, fetch }, 'password');
    const digest = sha1Hex('password');
    expect(urls[0]).toBe(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`);
    expect(urls[0]).not.toContain(digest.slice(5));
  });

  it('reports a hit with its count', async () => {
    const digest = sha1Hex('password');
    const { fetch } = recordingFetch(`${digest.slice(5)}:12345`);
    await expect(
      checkPasswordBreached({ enabled: true, logger: silent, fetch }, 'password'),
    ).resolves.toEqual({ breached: true, count: 12345, checkUnavailable: false });
  });

  it('reports a clean password when the prefix matches nothing', async () => {
    const { fetch } = recordingFetch('0000000000000000000000000000000000000:1');
    await expect(
      checkPasswordBreached({ enabled: true, logger: silent, fetch }, 'a very unlikely passphrase'),
    ).resolves.toEqual({ breached: false, count: 0, checkUnavailable: false });
  });

  it('fails open when the corpus cannot be reached', async () => {
    const fetch = (() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof globalThis.fetch;
    await expect(checkPasswordBreached({ enabled: true, logger: silent, fetch }, 'x')).resolves.toEqual({
      breached: false,
      count: 0,
      checkUnavailable: true,
    });
  });

  it('fails open on a non-200', async () => {
    const { fetch } = recordingFetch('', { status: 503 });
    await expect(checkPasswordBreached({ enabled: true, logger: silent, fetch }, 'x')).resolves.toEqual({
      breached: false,
      count: 0,
      checkUnavailable: true,
    });
  });

  it('does no network call at all when the flag is off', async () => {
    const { urls, fetch } = recordingFetch('');
    await expect(checkPasswordBreached({ enabled: false, logger: silent, fetch }, 'x')).resolves.toEqual({
      breached: false,
      count: 0,
      checkUnavailable: false,
    });
    expect(urls).toEqual([]);
  });

  it('asks the provider to pad the response, so its size leaks no match count', async () => {
    let headers: Headers | undefined;
    const fetch = ((url: string, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return Promise.resolve(new Response('ABC:1'));
    }) as unknown as typeof globalThis.fetch;
    await checkPasswordBreached({ enabled: true, logger: silent, fetch }, 'x');
    expect(headers?.get('add-padding')).toBe('true');
  });
});
