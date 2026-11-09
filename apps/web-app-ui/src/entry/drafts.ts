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

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const read = <T>(key: string, valid: (value: unknown) => value is T): T | null => {
  let raw: string | null | undefined;
  try {
    raw = storage()?.getItem(key);
  } catch {
    raw = undefined;
  }
  raw ??= memory.get(key) ?? null;
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
};

const remove = (key: string): void => {
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
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

export const signUpDraft = {
  read: (): SignUpDraft | null => read(KEYS.signUp, isSignUp),
  write: (draft: SignUpDraft): void => {
    write(KEYS.signUp, draft);
  },
  clear: (): void => {
    remove(KEYS.signUp);
  },
};

const sentCode = (key: string) => ({
  read: (): SentCode | null => read(key, isSentCode),
  write: (code: SentCode): void => {
    write(key, code);
  },
  clear: (): void => {
    remove(key);
  },
});

export const signUpCode = sentCode(KEYS.signUpCode);
export const resetCode = sentCode(KEYS.resetCode);

/** Everything the way in remembered, for when it is finished or a different person picks up the phone. */
export function clearEntryDrafts(): void {
  for (const key of Object.values(KEYS)) remove(key);
}
