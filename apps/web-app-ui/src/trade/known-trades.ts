// The trades this device has seen, by id.
//
// STOPGAP. The platform has no `GET /trades` list yet (reported in the F-017 plan), so "Your Trades"
// is built from the ids of trades this person proposed or opened here, each read through
// `GET /trades/:id`. It stores ids only, never terms or names. When the list route exists this file
// is deleted and `MyTrades` reads the route instead; nothing else depends on it.
import { useMemo, useSyncExternalStore } from 'react';

const KEY = 'komtru.trades.known';
const MAX = 100;
const CHANGED = 'komtru:known-trades';

const storage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Storage is blocked in some private modes: the list is then simply empty, never an error.
    return undefined;
  }
};

export function knownTradeIds(): string[] {
  const raw = storage()?.getItem(KEY);
  if (raw === null || raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Newest first, once each. */
export function rememberTrade(id: string): void {
  const ids = [id, ...knownTradeIds().filter((known) => known !== id)].slice(0, MAX);
  try {
    storage()?.setItem(KEY, JSON.stringify(ids));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // A full or blocked store costs the person a list entry, not the trade.
  }
}

/** On sign-out, with everything else the previous person left on a shared phone. */
export function forgetKnownTrades(): void {
  try {
    storage()?.removeItem(KEY);
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Nothing to clear if storage is not there.
  }
}

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener('storage', notify);
  window.addEventListener(CHANGED, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(CHANGED, notify);
  };
};

/**
 * The ids, read the way React reads an external store: `undefined` on the server and for the first
 * client render (so the markup matches), then the stored list, kept current when another tab or this
 * one changes it.
 */
export function useKnownTradeIds(): string[] | undefined {
  const raw = useSyncExternalStore(
    subscribe,
    () => storage()?.getItem(KEY) ?? '',
    () => null,
  );
  return useMemo(() => (raw === null ? undefined : knownTradeIds()), [raw]);
}
