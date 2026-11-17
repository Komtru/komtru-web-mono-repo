'use client';

import { useEffect } from 'react';
import { applyPrefs } from './prefs';
import { useDisplayPrefs } from './useDisplayPrefs';

/**
 * Puts this device's display preferences on `<html>` for the whole app, on every page and whenever they change. It draws
 * nothing. Mounted by the root layout, so a preference chosen once holds on the sign-in screen as much as on SP-M33.
 */
export function DisplayPrefsApplier(): null {
  const [prefs] = useDisplayPrefs();
  useEffect(() => {
    applyPrefs(document.documentElement, prefs);
  }, [prefs]);
  return null;
}
