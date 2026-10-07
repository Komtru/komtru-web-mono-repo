// Sign-out's half of the offline cache. The worker's own half is `service-worker.test.ts`; this is
// the call that reaches it, and the one failure here that matters is a silent one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineCache, CLEAR_CACHE_MESSAGE } from '../src/shell/ServiceWorker';

const withServiceWorker = (value: unknown): void => {
  Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('clearOfflineCache', () => {
  it('posts the clear message to the active worker', async () => {
    const postMessage = vi.fn();
    withServiceWorker({
      getRegistration: () => Promise.resolve({ active: { postMessage } }),
      ready: Promise.resolve({ active: { postMessage } }),
    });

    await clearOfflineCache();
    expect(postMessage).toHaveBeenCalledWith(CLEAR_CACHE_MESSAGE);
  });

  // The regression. `registration.active` is null while a worker is still installing or waiting —
  // a first load, or the moment after an update. Reading it alone posted nothing, threw nothing
  // and resolved, so sign-out reported success with every page still cached behind it.
  it('waits for a worker that has not activated yet', async () => {
    const postMessage = vi.fn();
    withServiceWorker({
      getRegistration: () => Promise.resolve({ active: null }),
      ready: Promise.resolve({ active: { postMessage } }),
    });

    await clearOfflineCache();
    expect(postMessage).toHaveBeenCalledWith(CLEAR_CACHE_MESSAGE);
  });

  it('fails loudly rather than silently when no worker can be reached', async () => {
    withServiceWorker({
      getRegistration: () => Promise.resolve({ active: null }),
      ready: Promise.resolve({ active: null }),
    });

    await expect(clearOfflineCache()).rejects.toThrow(/service worker/i);
  });

  // Nothing registered means nothing was ever cached by this worker, so there is nothing to clear
  // and no reason to make sign-out look broken.
  it('is a no-op where there is no registration', async () => {
    withServiceWorker({
      getRegistration: () => Promise.resolve(undefined),
      ready: Promise.resolve({ active: null }),
    });

    await expect(clearOfflineCache()).resolves.toBeUndefined();
  });

  it('is a no-op where the browser has no service workers at all', async () => {
    await expect(clearOfflineCache()).resolves.toBeUndefined();
  });
});
