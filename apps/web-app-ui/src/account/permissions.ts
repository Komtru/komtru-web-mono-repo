'use client';

import { useEffect, useState } from 'react';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

/** What a browser calls each thing SP-M03 says Komtru can use. */
type Name = 'camera' | 'geolocation' | 'notifications';

/** What the person is told, in the words of the browser's own settings page. */
export const PERMISSION_WORDS: Record<PermissionState, string> = {
  granted: 'Allowed',
  denied: 'Blocked in your browser',
  prompt: 'Your browser asks first',
  unknown: 'Set in your browser',
};

/**
 * The browser's answer for one permission, kept current if the person changes it in site settings while the screen is
 * open. A browser that cannot answer (Safari for camera, an old WebView) is `unknown`, never a guess: the screen says
 * where to look instead of showing a switch that would lie. Komtru reads these; it cannot flip them, and the browser
 * does not let any page do so.
 */
export function usePermission(name: Name): PermissionState {
  const [state, setState] = useState<PermissionState>('unknown');

  useEffect(() => {
    let status: PermissionStatus | undefined;
    let cancelled = false;
    const read = (value: string) =>
      value === 'granted' || value === 'denied' || value === 'prompt' ? value : 'unknown';
    const update = () => {
      if (!cancelled && status !== undefined) setState(read(status.state));
    };

    if (typeof navigator !== 'undefined' && navigator.permissions !== undefined) {
      navigator.permissions
        .query({ name })
        .then((result) => {
          status = result;
          update();
          result.addEventListener('change', update);
        })
        .catch(() => {
          // Not a permission this browser can be asked about.
        });
    } else if (name === 'notifications' && typeof Notification !== 'undefined') {
      // A browser with no Permissions API still says what Notification says. Read in a microtask so the answer
      // arrives like the other one does, not as a synchronous write inside the effect.
      void Promise.resolve().then(() => {
        if (!cancelled) setState(Notification.permission === 'default' ? 'prompt' : Notification.permission);
      });
    }

    return () => {
      cancelled = true;
      status?.removeEventListener('change', update);
    };
  }, [name]);

  return state;
}
