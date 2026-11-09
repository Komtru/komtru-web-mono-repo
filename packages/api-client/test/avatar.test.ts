import { describe, expect, it, vi } from 'vitest';
import { removeAvatar, setAvatar } from '../src/avatar.js';
import { createApiClient } from '../src/client.js';

const FILE = '0190b0a0-0000-7000-8000-000000000001';
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('the avatar endpoints', () => {
  it('are consumer-scoped and unkeyed', () => {
    expect(setAvatar).toMatchObject({
      method: 'post',
      path: '/me/avatar',
      scope: 'CONSUMER',
      retryable: false,
    });
    expect(removeAvatar).toMatchObject({ method: 'delete', path: '/me/avatar', scope: 'CONSUMER' });
  });

  it('post the file id and parse the signed url, then delete', async () => {
    const calls: { url: string; method: string; body: string | null }[] = [];
    const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return Promise.resolve(json({ avatarUrl: calls.length === 1 ? 'https://cdn.test/a.jpg' : null }));
    });
    const client = createApiClient({ baseUrl: 'https://api.test/v1', fetch });

    const set = await client.call(setAvatar, { body: { fileId: FILE } });
    const removed = await client.call(removeAvatar, {});

    expect(set.avatarUrl).toBe('https://cdn.test/a.jpg');
    expect(removed.avatarUrl).toBeNull();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.test/v1/me/avatar',
      'DELETE https://api.test/v1/me/avatar',
    ]);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ fileId: FILE });
  });
});
