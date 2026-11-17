'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  DISPLAY_CHANGED,
  DISPLAY_STORAGE_KEY,
  DEFAULT_PREFS,
  parsePrefs,
  writePrefs,
  type DisplayPrefs,
} from './prefs';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener(DISPLAY_CHANGED, onChange);
  // Another tab changed them.
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(DISPLAY_CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
};

const snapshot = (): string | null => {
  try {
    return window.localStorage.getItem(DISPLAY_STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * This device's display preferences, read from storage and kept current when they change in this tab or another. The
 * server cannot know them, so the first render is the defaults and the browser corrects it once it has hydrated.
 */
export function useDisplayPrefs(): [DisplayPrefs, (change: Partial<DisplayPrefs>) => void] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const prefs = useMemo(() => (raw === null ? DEFAULT_PREFS : parsePrefs(raw)), [raw]);
  const update = useCallback((change: Partial<DisplayPrefs>) => writePrefs({ ...prefs, ...change }), [prefs]);
  return [prefs, update];
}
