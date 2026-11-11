// @vitest-environment jsdom
// F-013: what the walkthrough remembers, and how it asks for push permission.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enablePush, notificationSupport } from '../src/welcome/push';
import { WELCOME_STEPS, nextPath, stepFor } from '../src/welcome/steps';
import {
  markWelcomeDone,
  rememberFirstName,
  resetWelcome,
  welcomeDone,
  welcomeName,
} from '../src/welcome/state';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetWelcome();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the steps', () => {
  it('run Protection, Transparency, Trust Profile, notifications, done, at the reference URLs', () => {
    expect(WELCOME_STEPS.map((s) => s.path)).toEqual([
      '/welcome/1',
      '/welcome/2',
      '/welcome/3',
      '/welcome/notifications',
      '/welcome/done',
    ]);
    expect(stepFor('2')?.title).toBe('Always know where things stand');
    expect(stepFor('nope')).toBeUndefined();
    expect(nextPath('1')).toBe('/welcome/2');
    expect(nextPath('3')).toBe('/welcome/notifications');
    expect(nextPath('done')).toBeUndefined();
  });
});

describe('what is remembered', () => {
  it('starts not done, and is done once marked', () => {
    expect(welcomeDone()).toBe(false);
    markWelcomeDone();
    expect(welcomeDone()).toBe(true);
  });

  it('is cleared by a new sign-up, so a second person on the phone sees it', () => {
    markWelcomeDone();
    rememberFirstName('Amaka Obi');
    resetWelcome();
    expect(welcomeDone()).toBe(false);
    expect(welcomeName()).toBeNull();
  });

  it('keeps only the first name', () => {
    rememberFirstName('  Amaka   Obi ');
    expect(welcomeName()).toBe('Amaka');
    rememberFirstName('   ');
    expect(welcomeName()).toBeNull();
  });

  it('still works when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    markWelcomeDone();
    expect(welcomeDone()).toBe(true);
  });
});

function stubNotification(permission: NotificationPermission, after: NotificationPermission = permission) {
  const request = vi.fn(() => Promise.resolve(after));
  vi.stubGlobal('Notification', { permission, requestPermission: request });
  return request;
}

describe('notification support', () => {
  it('is unsupported where the browser has no Notification', () => {
    vi.stubGlobal('Notification', undefined);
    expect(notificationSupport()).toBe('unsupported');
  });
  it('reports a denial already made', () => {
    stubNotification('denied');
    expect(notificationSupport()).toBe('denied');
  });
  it('is askable by default', () => {
    stubNotification('default');
    expect(notificationSupport()).toBe('default');
  });
});

describe('enablePush', () => {
  const register =
    vi.fn<(body: { deviceFingerprint: string; platform: 'WEB'; pushToken: string }) => Promise<unknown>>();
  beforeEach(() => {
    register.mockReset().mockResolvedValue({});
  });

  it('asks the browser, then registers this device with the token', async () => {
    const request = stubNotification('default', 'granted');
    const outcome = await enablePush({ register, tokenSource: { getToken: () => Promise.resolve('tok-1') } });
    expect(request).toHaveBeenCalledOnce();
    expect(outcome).toBe('enabled');
    expect(register).toHaveBeenCalledOnce();
    const body = register.mock.calls[0]?.[0];
    expect(body).toMatchObject({ platform: 'WEB', pushToken: 'tok-1' });
    expect(body?.deviceFingerprint.length).toBeGreaterThan(8);
  });

  it('uses the same fingerprint every time', async () => {
    stubNotification('default', 'granted');
    const source = { getToken: () => Promise.resolve('t') };
    await enablePush({ register, tokenSource: source });
    await enablePush({ register, tokenSource: source });
    expect(register.mock.calls[0]?.[0].deviceFingerprint).toBe(register.mock.calls[1]?.[0].deviceFingerprint);
  });

  it('is granted but registers nothing when no token source exists yet', async () => {
    stubNotification('default', 'granted');
    expect(await enablePush({ register, tokenSource: undefined })).toBe('permission-only');
    expect(register).not.toHaveBeenCalled();
  });

  it('is permission-only when the token cannot be minted or the registration fails', async () => {
    stubNotification('default', 'granted');
    expect(
      await enablePush({ register, tokenSource: { getToken: () => Promise.reject(new Error('no fcm')) } }),
    ).toBe('permission-only');
    register.mockRejectedValue(new Error('offline'));
    expect(await enablePush({ register, tokenSource: { getToken: () => Promise.resolve('t') } })).toBe(
      'permission-only',
    );
  });

  it('reports a refusal and registers nothing', async () => {
    stubNotification('default', 'denied');
    expect(await enablePush({ register, tokenSource: { getToken: () => Promise.resolve('t') } })).toBe(
      'denied',
    );
    expect(register).not.toHaveBeenCalled();
  });

  it('reports a dismissed prompt as dismissed', async () => {
    stubNotification('default', 'default');
    expect(await enablePush({ register, tokenSource: undefined })).toBe('dismissed');
  });

  it('does not re-prompt a browser that already denied', async () => {
    const request = stubNotification('denied');
    expect(await enablePush({ register, tokenSource: undefined })).toBe('denied');
    expect(request).not.toHaveBeenCalled();
  });

  it('reports an unsupported browser', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(await enablePush({ register, tokenSource: undefined })).toBe('unsupported');
  });
});
