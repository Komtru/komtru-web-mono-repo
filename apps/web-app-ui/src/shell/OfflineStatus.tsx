'use client';

import { OfflineBanner } from '@komtru/ui-kit';
import { useSyncExternalStore } from 'react';

/**
 * Whether the browser currently has a network. `useSyncExternalStore` rather than an effect that
 * sets state: the connection is external state React can subscribe to, and the server snapshot is
 * what makes the first paint match the HTML the server sent.
 *
 * `navigator.onLine` is a floor, not a promise — it says the device has an interface, not that
 * Komtru is reachable — so it is only ever used to explain a screen, never to decide whether a
 * request is worth sending. The request is sent; the answer is the truth.
 */
const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

export const useOnline = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // The server cannot know, and rendering "offline" into the HTML would flash a warning at
    // everyone who is not.
    () => true,
  );

/**
 * OF1's banner, drawn by the shell so every screen in the app has the state without asking for it.
 *
 * Renders nothing while there is a connection: an offline indicator that is always present is
 * furniture, and the one that appears is the one people read.
 */
export function OfflineStatus(): React.JSX.Element | null {
  const online = useOnline();
  if (online) return null;

  return (
    <OfflineBanner>
      Showing your last saved data — we&apos;ll sync automatically once you&apos;re back.
    </OfflineBanner>
  );
}
