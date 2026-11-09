// What the way in remembers between its screens: the signup details before the account exists, and
// the challenge a code was sent for.
//
// Session storage, not local storage: it is per tab and ends with the tab, which is what a half-done
// signup on a shared phone should do. None of it is a credential — a challenge id proves nothing
// without the code that went to the phone — and every read and write is guarded, because a private
// window or a blocked site-data setting makes the accessor throw, and the flow must still work in
// the tab it is in, just without surviving a reload.

export interface SignUpDraft {
  phone: string;
  fullName: string;
}

/** A code that went out: what to verify it against and where it was sent. */
export interface SentCode {
  challengeId: string;
  /** `+23480•••5567`, or null when the platform would not say (a username on the reset path). */
  destination: string | null;
  /** False when the platform's send budget was spent and no code went out. */
  delivered: boolean;
  /** Epoch milliseconds, for the resend countdown. */
  sentAt: number;
}

const KEYS = {
  signUp: 'komtru.entry.signup',
  signUpCode: 'komtru.entry.code',
  resetCode: 'komtru.entry.reset',
};

const memory = new Map<string, string>();
const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: every write in this tab re-renders whoever reads a draft. */
export const subscribeDrafts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (): void => {
  for (const listener of listeners) listener();
};

/** The stored string itself: a stable snapshot, where a parsed object would be new on every read. */
const rawOf = (key: string): string | null => {
  let raw: string | null | undefined;
  try {
    raw = storage()?.getItem(key);
  } catch {
    raw = undefined;
  }
  return raw ?? memory.get(key) ?? null;
};

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const parse = <T>(raw: string | null, valid: (value: unknown) => value is T): T | null => {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown): void => {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    storage()?.setItem(key, raw);
  } catch {
    // The in-memory copy carries this tab through the flow.
  }
  notify();
};

const remove = (key: string): void => {
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
  notify();
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSignUp = (value: unknown): value is SignUpDraft =>
  isObject(value) && typeof value.phone === 'string' && typeof value.fullName === 'string';

const isSentCode = (value: unknown): value is SentCode =>
  isObject(value) &&
  typeof value.challengeId === 'string' &&
  (value.destination === null || typeof value.destination === 'string') &&
  typeof value.delivered === 'boolean' &&
  typeof value.sentAt === 'number';

/** One remembered value: read it, parse a snapshot of it, write it, forget it. */
export interface DraftStore<T> {
  read: () => T | null;
  raw: () => string | null;
  parse: (raw: string | null) => T | null;
  write: (value: T) => void;
  clear: () => void;
}

const store = <T>(key: string, valid: (value: unknown) => value is T): DraftStore<T> => ({
  read: () => parse(rawOf(key), valid),
  raw: () => rawOf(key),
  parse: (raw) => parse(raw, valid),
  write: (value) => {
    write(key, value);
  },
  clear: () => {
    remove(key);
  },
});

export const signUpDraft = store(KEYS.signUp, isSignUp);
export const signUpCode = store(KEYS.signUpCode, isSentCode);
export const resetCode = store(KEYS.resetCode, isSentCode);

/** Everything the way in remembered, for when it is finished or a different person picks up the phone. */
export function clearEntryDrafts(): void {
  for (const key of Object.values(KEYS)) remove(key);
}
