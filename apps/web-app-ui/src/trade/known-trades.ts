// The trades this device has seen for one person, by id.
//
// STOPGAP. The platform has no `GET /trades` list yet (reported in the F-017 plan), so "Your Trades"
// is built from the ids of trades this person proposed or opened here, each read through
// `GET /trades/:id`. It stores ids only, never terms or names. When the list route exists this file
// is deleted and `MyTrades` reads the route instead; nothing else depends on it.
//
// The list is per person: the key carries the user's id, so a second person on the same phone starts
// with an empty list and never sees that the first person's ids exist. Sign-out clears every list
// (`forgetKnownTrades`, called from `onSessionEnded`) as well, because the phone at a motor park
// counter is a shared phone.
import { useMemo, useSyncExternalStore } from 'react';

const PREFIX = 'komtru.trades.known';
const MAX = 100;
const CHANGED = 'komtru:known-trades';

const keyFor = (userId: string): string => `${PREFIX}.${userId}`;

const storage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Storage is blocked in some private modes: the list is then simply empty, never an error.
    return undefined;
  }
};

export function knownTradeIds(userId: string): string[] {
  const raw = storage()?.getItem(keyFor(userId));
  if (raw === null || raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

const write = (userId: string, ids: string[]): void => {
  try {
    storage()?.setItem(keyFor(userId), JSON.stringify(ids));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // A full or blocked store costs the person a list entry, not the trade.
  }
};

/** Newest first, once each, at most `MAX`. */
export function rememberTrade(userId: string, id: string): void {
  write(userId, [id, ...knownTradeIds(userId).filter((known) => known !== id)].slice(0, MAX));
}

/** A trade that can never be read again (gone, or not this person's) leaves the list. */
export function forgetTrade(userId: string, id: string): void {
  const ids = knownTradeIds(userId);
  if (ids.includes(id))
    write(
      userId,
      ids.filter((known) => known !== id),
    );
}

/**
 * On sign-out: every person's list, and the unscoped key an earlier build wrote, so nothing the
 * previous person opened is left for the next one.
 */
export function forgetKnownTrades(): void {
  const store = storage();
  if (store === undefined) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null && (key === PREFIX || key.startsWith(`${PREFIX}.`))) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
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
 * The ids, read the way React reads an external store: `undefined` on the server, for the first client
 * render (so the markup matches) and until the person is known, then the stored list, kept current
 * when another tab or this one changes it.
 */
export function useKnownTradeIds(userId: string | undefined): string[] | undefined {
  const raw = useSyncExternalStore(
    subscribe,
    () => (userId === undefined ? '' : (storage()?.getItem(keyFor(userId)) ?? '')),
    () => null,
  );
  return useMemo(
    () => (raw === null || userId === undefined ? undefined : knownTradeIds(userId)),
    [raw, userId],
  );
}
