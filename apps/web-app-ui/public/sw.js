/* eslint-disable */
/**
 * The service worker behind OF1 — "You're offline. Showing your last saved data."
 *
 * Plain JavaScript, served from the root so its scope is the whole app, and deliberately small: a
 * worker is the one piece of this app that keeps running after the code that installed it is gone,
 * so everything it does has to be obvious from reading it once.
 *
 * What it caches, and what it refuses to:
 *
 *   * **Navigations** — network first, and the page that came back is kept. Offline, the last copy
 *     of that same page is served, and a page never visited falls back to `/offline`. Network first
 *     and never cache first: a trade's state is money, and a stale page served to someone with a
 *     connection would be a lie this app told on purpose.
 *   * **Build output** (`/_next/static/**`) — cache first. The filenames carry a content hash, so a
 *     hit is the right file by construction.
 *   * **Everything else is passed through untouched**: anything that is not a GET (a mutation is
 *     the durable retry queue's job — `@komtru/api-client`'s, not a cache's), anything on another
 *     origin (the API, Cloudinary), and anything under `/api/` — a session, a refresh token, a
 *     balance. The Cache API is per origin and not per person, and a phone at a motor park is a
 *     shared phone.
 *
 * That last point is also why `komtru-clear-cache` exists: sign-out posts it, and everything this
 * worker holds goes. Keep that call in step with whatever signs people out.
 */

const CACHE = 'komtru-app-v1';

/** The one document this worker guarantees: the screen a never-visited URL falls back to. */
const OFFLINE_PATH = '/offline';

const STATIC_PREFIXES = ['/_next/static/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_PATH]))
      // `skipWaiting` after the precache, not before: activating a worker whose fallback document
      // never arrived would leave the app with a worker and no offline screen.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'komtru-clear-cache') {
    event.waitUntil(caches.delete(CACHE));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }

  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(fromCacheFirst(request));
  }
});

async function navigate(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Only a real page: a 404 or a 500 kept here would be served back as "your last saved data".
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    const offline = await cache.match(OFFLINE_PATH);
    if (offline) return offline;
    throw error;
  }
}

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
