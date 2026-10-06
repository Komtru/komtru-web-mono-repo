'use client';

import { useEffect } from 'react';

/** What `public/sw.js` listens for. Sign-out posts it so no page stays cached for the next person. */
export const CLEAR_CACHE_MESSAGE = { type: 'komtru-clear-cache' } as const;

/**
 * Registers the worker that makes OF1 true: a page already visited opens again with no connection,
 * and one that has not falls back to `/offline`.
 *
 * Production only, and deliberately. A dev server's chunks are rewritten on every edit and served
 * from paths that do not change with them, so a worker caching them hands back yesterday's code and
 * breaks hot reload. The offline banner itself does not need the worker — `navigator.onLine` is
 * enough — so the state is still reviewable in development.
 */
export function ServiceWorker(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    // `void`, not awaited: a failed registration is a page that works without offline support, and
    // nothing on screen should wait for it.
    void navigator.serviceWorker.register('/sw.js');
  }, []);

  return null;
}

/**
 * Empties the worker's cache. Whatever signs someone out calls this: the Cache API is per origin,
 * not per person, and a shared phone must not open the last person's trades.
 */
export async function clearOfflineCache(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  registration?.active?.postMessage(CLEAR_CACHE_MESSAGE);
}
