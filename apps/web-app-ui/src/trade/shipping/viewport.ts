'use client';

import { useSyncExternalStore } from 'react';

/** The widths the app lays out at: `base` is a phone, `md` (768) a tablet and `lg` (1024) a desktop. */
export type ViewportTier = 'base' | 'md' | 'lg';

const QUERIES = { lg: '(min-width: 1024px)', md: '(min-width: 768px)' } as const;

function read(): ViewportTier {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'base';
  if (window.matchMedia(QUERIES.lg).matches) return 'lg';
  if (window.matchMedia(QUERIES.md).matches) return 'md';
  return 'base';
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const lists = [window.matchMedia(QUERIES.lg), window.matchMedia(QUERIES.md)];
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

/**
 * Which of the three layouts the window is in. For a screen whose structure differs by width (a table, a list with
 * a detail pane, plain rows), where CSS alone would draw two copies and hide one. The server and the first client
 * render answer `base`, so hydration agrees; every screen using it reads its data on the client, so the tier is known
 * before anything shows.
 */
export function useViewportTier(): ViewportTier {
  return useSyncExternalStore(subscribe, read, () => 'base');
}
