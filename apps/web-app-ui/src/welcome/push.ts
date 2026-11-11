// OB4: asking for notification permission, and telling the platform where this device can be reached.
//
// The platform sends push through FCM, to the token stored on a device (`POST /me/devices`, T-045). A browser only
// has such a token once the Firebase web SDK has minted one, and that is not wired in this repo, so `tokenSource`
// is `undefined` for now and a granted permission is recorded as `permission-only`. The seam is here so adding it
// is one object, not a rewrite of the screen.

import { captureException } from '@sentry/nextjs';

export type NotificationSupport = NotificationPermission | 'unsupported';

export type PushOutcome =
  /** Permission given and the device registered with a token the platform can send to. */
  | 'enabled'
  /** Permission given, but there is no token to register yet (no token source, or it failed). Never blocks. */
  | 'permission-only'
  | 'denied'
  /** The prompt was closed without an answer. */
  | 'dismissed'
  | 'unsupported';

export interface PushTokenSource {
  getToken: () => Promise<string | undefined>;
}

/** Where a web push token comes from. None yet: see the plan's owner question 1. */
export const defaultTokenSource: PushTokenSource | undefined = undefined;

export interface RegisterDeviceInput {
  deviceFingerprint: string;
  platform: 'WEB';
  pushToken: string;
}

const FINGERPRINT_KEY = 'komtru.device.fingerprint';

export function notificationSupport(): NotificationSupport {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Kept in memory too: with storage blocked, every call would otherwise mint a new id and a new device row. */
let memoryFingerprint: string | undefined;

/** Stable per browser profile: the platform upserts on it, so asking twice is one device, not two. */
function deviceFingerprint(): string {
  try {
    const kept = window.localStorage.getItem(FINGERPRINT_KEY);
    if (kept !== null && kept !== '') return kept;
  } catch {
    // Fall through to the copy this page holds.
  }
  memoryFingerprint ??= crypto.randomUUID();
  try {
    window.localStorage.setItem(FINGERPRINT_KEY, memoryFingerprint);
  } catch {
    // The in-memory copy carries this page.
  }
  return memoryFingerprint;
}

/**
 * The promise form, and the callback form older Safari still has: there `requestPermission` returns nothing and
 * reports through its argument. Modern browsers do both, which is harmless: the first answer wins.
 */
function askPermission(): Promise<NotificationPermission> {
  return new Promise((resolve) => {
    const returned = Notification.requestPermission((answer) => {
      resolve(answer);
    }) as Promise<NotificationPermission> | undefined;
    if (returned !== undefined && typeof returned.then === 'function') {
      returned.then(resolve, () => {
        resolve('default');
      });
    }
  });
}

export async function enablePush(options: {
  register: (body: RegisterDeviceInput) => Promise<unknown>;
  tokenSource: PushTokenSource | undefined;
}): Promise<PushOutcome> {
  const support = notificationSupport();
  if (support === 'unsupported') return 'unsupported';
  // A denial is the browser's to undo; asking again does nothing but look broken.
  if (support === 'denied') return 'denied';

  const answer = support === 'granted' ? 'granted' : await askPermission();
  if (answer === 'denied') return 'denied';
  if (answer !== 'granted') return 'dismissed';

  if (options.tokenSource === undefined) return 'permission-only';
  try {
    const pushToken = await options.tokenSource.getToken();
    if (pushToken === undefined || pushToken === '') return 'permission-only';
    await options.register({ deviceFingerprint: deviceFingerprint(), platform: 'WEB', pushToken });
    return 'enabled';
  } catch (error) {
    // The permission is already given and the person's next step must not depend on a token call; it is reported, not lost.
    captureException(error);
    return 'permission-only';
  }
}
