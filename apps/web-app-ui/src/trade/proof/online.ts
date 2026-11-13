'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

/** Whether the device says it has a connection: a floor, not a promise (the shell's offline banner says the same). */
export const useOnline = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
