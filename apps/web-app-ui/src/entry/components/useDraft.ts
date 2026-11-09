'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { subscribeDrafts, type DraftStore } from '../drafts';

/** What the server renders with: it has no session storage, so it has no draft either. */
const ON_SERVER = '\u0000server';

/**
 * A remembered draft, kept current as the flow writes it.
 *
 * `undefined` until the page is running in the browser, then the draft or `null`. The three are
 * different answers: a screen redirects on `null` (nothing remembered) and must not on `undefined`
 * (not looked yet), or every server render would bounce the person back to the start.
 */
export function useDraft<T>(draft: DraftStore<T>): T | null | undefined {
  const raw = useSyncExternalStore(subscribeDrafts, draft.raw, () => ON_SERVER);
  return useMemo(() => (raw === ON_SERVER ? undefined : draft.parse(raw)), [raw, draft]);
}
