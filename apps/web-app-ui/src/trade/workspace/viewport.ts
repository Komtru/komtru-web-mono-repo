'use client';

import { useSyncExternalStore } from 'react';

export type Viewport = 'mobile' | 'tablet' | 'desktop';

/** Tailwind's `md` and `lg`: the widths the tablet and desktop drawings start at (F-068, F-072). */
const TABLET = '(min-width: 768px)';
const DESKTOP = '(min-width: 1024px)';

const supported = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function read(): Viewport {
  if (!supported()) return 'mobile';
  if (window.matchMedia(DESKTOP).matches) return 'desktop';
  return window.matchMedia(TABLET).matches ? 'tablet' : 'mobile';
}

function subscribe(notify: () => void): () => void {
  if (!supported()) return () => undefined;
  const lists = [window.matchMedia(TABLET), window.matchMedia(DESKTOP)];
  lists.forEach((list) => {
    list.addEventListener('change', notify);
  });
  return () => {
    lists.forEach((list) => {
      list.removeEventListener('change', notify);
    });
  };
}

/**
 * Which of the three drawings this window gets. The server and a window with no `matchMedia` (jsdom) are a phone,
 * so nothing wider is drawn, or read for, until a real window says it is one.
 *
 * It exists for the layouts that add a read or a second copy of something (the workspace's trade list and money
 * panel); an arrangement of the same nodes is CSS, as in `ProposeWorkspace`.
 */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, read, () => 'mobile');
}
