import { describe, expect, it, vi } from 'vitest';
import {
  checkSameOriginJson,
  clientIpOf,
  createMemoryRefreshStore,
  createRateLimiter,
  forwardHeaders,
} from '../../src/next/auth-guards.js';

const ORIGIN = 'https://ops.komtru.com';

const req = (headers: Record<string, string>) =>
  new Request(`${ORIGIN}/api/auth/login`, { method: 'POST', headers, body: '{}' });

describe('checkSameOriginJson', () => {
  const json = { 'content-type': 'application/json' };

  it('accepts a JSON post from the app’s own origin', () => {
    expect(checkSameOriginJson(req({ ...json, origin: ORIGIN }), ORIGIN)).toBeNull();
    expect(
      checkSameOriginJson(req({ 'content-type': 'application/json; charset=utf-8', origin: ORIGIN }), ORIGIN),
    ).toBeNull();
  });

  it('refuses another origin, whatever the referer says', () => {
    expect(
      checkSameOriginJson(req({ ...json, origin: 'https://evil.com', referer: `${ORIGIN}/x` }), ORIGIN),
    ).toMatch(/origin/i);
  });

  it('refuses the opaque "null" origin', () => {
    expect(checkSameOriginJson(req({ ...json, origin: 'null' }), ORIGIN)).not.toBeNull();
  });

  it('falls back to the referer when there is no origin', () => {
    expect(
      checkSameOriginJson(req({ ...json, referer: `${ORIGIN}/sign-in?next=%2Fqueue` }), ORIGIN),
    ).toBeNull();
    expect(checkSameOriginJson(req({ ...json, referer: 'https://evil.com/' }), ORIGIN)).not.toBeNull();
    expect(checkSameOriginJson(req({ ...json, referer: 'not a url' }), ORIGIN)).not.toBeNull();
  });

  it('refuses a post that says where it came from nowhere', () => {
    expect(checkSameOriginJson(req(json), ORIGIN)).not.toBeNull();
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', ''])(
    'refuses content-type %j: a form post is what a cross-site page can send',
    (type) => {
      expect(checkSameOriginJson(req({ 'content-type': type, origin: ORIGIN }), ORIGIN)).toMatch(/json/i);
    },
  );
});

describe('the client the backend sees', () => {
  it('takes the nearest proxy’s entry, which is the one it appended', () => {
    expect(clientIpOf(req({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9, 203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientIpOf(req({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIpOf(req({}))).toBe('unknown');
  });

  it('forwards the chain and the user agent unchanged', () => {
    expect(
      forwardHeaders(req({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9', 'user-agent': 'Mozilla/5.0' })),
    ).toEqual({
      'x-forwarded-for': '1.1.1.1, 9.9.9.9',
      'user-agent': 'Mozilla/5.0',
    });
    expect(forwardHeaders(req({}))).toEqual({});
  });
});

describe('createRateLimiter', () => {
  it('allows its points, then refuses with a wait, then allows again', () => {
    let now = 0;
    const limiter = createRateLimiter({ points: 2, windowMs: 1000, now: () => now });
    expect(limiter.take('a')).toBeNull();
    expect(limiter.take('a')).toBeNull();
    expect(limiter.take('a')).toBe(1);
    now = 600;
    expect(limiter.take('a')).toBe(1);
    now = 1001;
    expect(limiter.take('a')).toBeNull();
  });

  it('keeps keys apart', () => {
    const limiter = createRateLimiter({ points: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.take('a')).toBeNull();
    expect(limiter.take('b')).toBeNull();
    expect(limiter.take('a')).not.toBeNull();
  });

  it('forgets stale keys so it cannot grow without bound', () => {
    let now = 0;
    const limiter = createRateLimiter({ points: 1, windowMs: 1000, now: () => now, maxKeys: 3 });
    for (const key of ['a', 'b', 'c']) limiter.take(key);
    now = 5000;
    limiter.take('d');
    expect(limiter.size()).toBe(1);
  });
});

describe('createMemoryRefreshStore', () => {
  it('hands a refresh token back once, for the access token it was filed under', () => {
    const store = createMemoryRefreshStore({ ttlMs: 1000, now: () => 0 });
    store.put('at-1', 'rt-1');
    expect(store.take('at-1')).toBe('rt-1');
    expect(store.take('at-1')).toBeUndefined();
    expect(store.take('other')).toBeUndefined();
  });

  it('gives expired entries to the sweep, so an abandoned session is still revoked', () => {
    let now = 0;
    const store = createMemoryRefreshStore({ ttlMs: 1000, now: () => now });
    store.put('at-1', 'rt-1');
    store.put('at-2', 'rt-2');
    now = 1001;
    expect(store.sweep().sort()).toEqual(['rt-1', 'rt-2']);
    expect(store.take('at-1')).toBeUndefined();
  });

  it('never keeps the access token itself', () => {
    const spy = vi.spyOn(JSON, 'stringify');
    const store = createMemoryRefreshStore({ ttlMs: 1000, now: () => 0 });
    store.put('at-secret', 'rt-1');
    expect(JSON.stringify([...(store as unknown as { keys(): string[] }).keys()])).not.toContain('at-secret');
    spy.mockRestore();
  });
});
