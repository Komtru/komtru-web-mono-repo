// The worker is the artifact under test: `public/sw.js` is read from disk and run in a stubbed
// `ServiceWorkerGlobalScope`, so what the suite proves is what the browser will install — not a
// TypeScript copy of it that happened to agree.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');

const ORIGIN = 'https://app.komtru.com';

type Handler = (event: Record<string, unknown>) => void;

interface FakeCache {
  entries: Map<string, unknown>;
  put: (request: unknown, response: unknown) => Promise<void>;
  match: (request: unknown, options?: { ignoreSearch?: boolean }) => Promise<unknown>;
  addAll: (paths: string[]) => Promise<void>;
}

const keyOf = (request: unknown): string =>
  typeof request === 'string' ? request : ((request as { url: string }).url ?? '');

function fakeCache(): FakeCache {
  const entries = new Map<string, unknown>();
  return {
    entries,
    put: (request, response) => Promise.resolve(void entries.set(keyOf(request), response)),
    match: (request, options) => Promise.resolve(matched(entries, request, options)),
    addAll: (paths) => {
      for (const path of paths) entries.set(path, { ok: true, body: `precached ${path}` });
      return Promise.resolve();
    },
  };
}

/** What a cache lookup finds, with the two leniencies the real Cache API has. */
function matched(
  entries: Map<string, unknown>,
  request: unknown,
  options?: { ignoreSearch?: boolean },
): unknown {
  const key = keyOf(request);
  const direct = entries.get(key);
  if (direct !== undefined) return direct;
  if (options?.ignoreSearch === true) {
    const bare = key.split('?')[0]!;
    for (const [candidate, value] of entries) {
      if (candidate.split('?')[0] === bare) return value;
    }
  }
  // A precached path is stored as given ("/offline"), so a full URL has to find it too.
  if (key.startsWith(ORIGIN)) return entries.get(key.slice(ORIGIN.length));
  return undefined;
}

interface Harness {
  handlers: Map<string, Handler>;
  cache: FakeCache;
  caches: Map<string, FakeCache>;
  fetch: ReturnType<typeof vi.fn>;
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  deleted: string[];
  /** Dispatches an event and resolves whatever the worker passed to `respondWith`/`waitUntil`. */
  dispatch: (type: string, event: Record<string, unknown>) => Promise<unknown>;
}

function install(): Harness {
  const handlers = new Map<string, Handler>();
  const cache = fakeCache();
  const caches = new Map<string, FakeCache>([
    ['komtru-app-v1', cache],
    ['komtru-app-v0', fakeCache()],
  ]);
  const deleted: string[] = [];
  const fetchMock = vi.fn();
  const skipWaiting = vi.fn();
  const claim = vi.fn();

  const self = {
    addEventListener: (type: string, handler: Handler) => void handlers.set(type, handler),
    location: { origin: ORIGIN },
    skipWaiting,
    clients: { claim },
  };

  runInNewContext(source, {
    self,
    URL,
    Promise,
    caches: {
      open: (name: string) => {
        const existing = caches.get(name) ?? fakeCache();
        caches.set(name, existing);
        return Promise.resolve(existing);
      },
      keys: () => Promise.resolve([...caches.keys()]),
      delete: (name: string) => {
        deleted.push(name);
        return Promise.resolve(caches.delete(name));
      },
      match: () => Promise.resolve(undefined),
    },
    fetch: fetchMock,
    console,
  });

  const dispatch = async (type: string, event: Record<string, unknown>): Promise<unknown> => {
    const pending: unknown[] = [];
    const handler = handlers.get(type);
    if (handler === undefined) throw new Error(`the worker registered no ${type} handler`);
    handler({
      ...event,
      respondWith: (value: unknown) => void pending.push(value),
      waitUntil: (value: unknown) => void pending.push(value),
    });
    const settled = await Promise.all(pending);
    return settled[0];
  };

  return { handlers, cache, caches, fetch: fetchMock, skipWaiting, claim, deleted, dispatch };
}

const navigation = (url: string) => ({ url, method: 'GET', mode: 'navigate', clone: () => ({ url }) });
const asset = (url: string) => ({ url, method: 'GET', mode: 'no-cors', clone: () => ({ url }) });
const page = (url: string) => ({ ok: true, url, clone: () => ({ ok: true, url, cached: true }) });

let harness: Harness;
beforeEach(() => {
  harness = install();
});

describe('installing', () => {
  it('precaches the offline screen before it takes over, and not after', async () => {
    await harness.dispatch('install', {});
    expect(harness.cache.entries.has('/offline')).toBe(true);
    expect(harness.skipWaiting).toHaveBeenCalled();
  });

  it('drops every older cache on activation and claims the open pages', async () => {
    await harness.dispatch('activate', {});
    expect(harness.deleted).toEqual(['komtru-app-v0']);
    expect(harness.claim).toHaveBeenCalled();
  });
});

describe('a navigation', () => {
  it('comes from the network while there is one, and is kept for when there is not', async () => {
    harness.fetch.mockResolvedValue(page(`${ORIGIN}/trades`));
    const response = await harness.dispatch('fetch', { request: navigation(`${ORIGIN}/trades`) });
    expect(response).toMatchObject({ ok: true, url: `${ORIGIN}/trades` });
    expect(harness.cache.entries.get(`${ORIGIN}/trades`)).toMatchObject({ cached: true });
  });

  it('serves the last copy of that page once the connection is gone', async () => {
    harness.fetch.mockResolvedValue(page(`${ORIGIN}/trades`));
    await harness.dispatch('fetch', { request: navigation(`${ORIGIN}/trades`) });

    harness.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await harness.dispatch('fetch', { request: navigation(`${ORIGIN}/trades`) });
    expect(offline).toMatchObject({ cached: true, url: `${ORIGIN}/trades` });
  });

  it('falls back to the offline screen for a page nobody has opened yet', async () => {
    await harness.dispatch('install', {});
    harness.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const response = await harness.dispatch('fetch', { request: navigation(`${ORIGIN}/alerts`) });
    expect(response).toMatchObject({ body: 'precached /offline' });
  });

  it('keeps no page the server did not actually serve', async () => {
    harness.fetch.mockResolvedValue({ ok: false, status: 500, clone: () => ({ ok: false }) });
    await harness.dispatch('fetch', { request: navigation(`${ORIGIN}/trades`) });
    expect(harness.cache.entries.size).toBe(0);
  });
});

describe('what it refuses to touch', () => {
  const untouched = (request: Record<string, unknown>): unknown[] => {
    const handler = harness.handlers.get('fetch')!;
    const responded: unknown[] = [];
    handler({ request, respondWith: (v: unknown) => void responded.push(v), waitUntil: () => {} });
    return responded;
  };

  it('passes a mutation straight through: replaying one is the retry queue’s job', () => {
    expect(untouched({ ...navigation(`${ORIGIN}/trades`), method: 'POST' })).toEqual([]);
  });

  it('never caches an API call — a session, a token or a balance', () => {
    expect(untouched(asset(`${ORIGIN}/api/auth/refresh`))).toEqual([]);
  });

  it('leaves another origin to whoever serves it', () => {
    expect(untouched(navigation('https://api.komtru.com/v1/trades'))).toEqual([]);
  });

  it('does not intercept itself, which is how a worker gets stuck on an old copy', () => {
    expect(untouched(asset(`${ORIGIN}/sw.js`))).toEqual([]);
  });
});

describe('build output', () => {
  it('is served from the cache first, because its filename carries a content hash', async () => {
    harness.fetch.mockResolvedValue(page(`${ORIGIN}/_next/static/chunks/main-abc123.js`));
    await harness.dispatch('fetch', { request: asset(`${ORIGIN}/_next/static/chunks/main-abc123.js`) });

    harness.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const hit = await harness.dispatch('fetch', {
      request: asset(`${ORIGIN}/_next/static/chunks/main-abc123.js`),
    });
    expect(hit).toMatchObject({ cached: true });
  });
});

describe('signing out', () => {
  it('empties the cache when the app says so', async () => {
    await harness.dispatch('install', {});
    await harness.dispatch('message', { data: { type: 'komtru-clear-cache' } });
    expect(harness.deleted).toContain('komtru-app-v1');
  });

  it('ignores a message from anything else', async () => {
    await harness.dispatch('message', { data: { type: 'something-else' } });
    expect(harness.deleted).toEqual([]);
  });
});
