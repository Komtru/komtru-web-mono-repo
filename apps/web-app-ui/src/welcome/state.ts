// What the walkthrough remembers: that this device has been through it (or skipped it), and the first name typed at
// sign-up so OB5 can say it. Neither is a credential. Local storage for the mark, because it should outlive the tab;
// session storage for the name, because it belongs to the sign-up in progress. Every access is guarded: a private
// window or blocked site data makes the accessors throw, and the walkthrough must still work for the tab it is in.

const DONE_KEY = 'komtru.welcome.done';
const NAME_KEY = 'komtru.welcome.name';
const ARRIVED_KEY = 'komtru.welcome.arrived';

const memory = new Map<string, string>();

const area = (kind: 'local' | 'session'): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

function read(kind: 'local' | 'session', key: string): string | null {
  try {
    return area(kind)?.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(kind: 'local' | 'session', key: string, value: string): void {
  memory.set(key, value);
  try {
    area(kind)?.setItem(key, value);
  } catch {
    // The in-memory copy carries this tab.
  }
}

function remove(key: string): void {
  memory.delete(key);
  for (const kind of ['local', 'session'] as const) {
    try {
      area(kind)?.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  }
}

export const welcomeDone = (): boolean => read('local', DONE_KEY) === '1';

/** Finishing and skipping are the same fact: this device has seen it and will not be sent back. */
export function markWelcomeDone(): void {
  write('local', DONE_KEY, '1');
  notify();
}

/** A new sign-up starts the walkthrough afresh, even on a phone that someone else already took it on. */
export function resetWelcome(): void {
  remove(DONE_KEY);
  remove(NAME_KEY);
  remove(ARRIVED_KEY);
}

/** What only the walkthrough in progress needs: dropped when a session ends, so the next person inherits none of it. */
export function clearWelcomeTransient(): void {
  remove(NAME_KEY);
  remove(ARRIVED_KEY);
}

/** OB4 hands over to OB5: the done screen is reached through the flow, not by a bookmark or a back button. */
export function markWelcomeArrived(): void {
  write('session', ARRIVED_KEY, '1');
}

export const welcomeArrived = (): boolean => read('session', ARRIVED_KEY) === '1';

/** Subscribers to this tab's own changes, for `useSyncExternalStore`. */
const listeners = new Set<() => void>();
export const subscribeWelcome = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = (): void => {
  for (const listener of listeners) listener();
};

/** The first word of the name typed at sign-up. */
export function rememberFirstName(fullName: string): void {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  if (first === '') {
    remove(NAME_KEY);
    return;
  }
  write('session', NAME_KEY, first);
}

export const welcomeName = (): string | null => read('session', NAME_KEY);

/** OB5 has read the name; it is not kept for anyone after. */
export const forgetWelcomeName = (): void => {
  remove(NAME_KEY);
};
