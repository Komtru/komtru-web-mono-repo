import * as Sentry from '@sentry/nextjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppConfig, type AppConfig } from '../src/config.js';
import { initSentry, sentryOptions } from '../src/sentry.js';

vi.mock('@sentry/nextjs', () => ({ init: vi.fn(), captureException: vi.fn(), flush: vi.fn() }));

const base = (sentryDsn?: string): AppConfig => ({
  ...readAppConfig(
    { appName: 'web-app-ui', scope: 'CONSUMER' },
    {
      NEXT_PUBLIC_KOMTRU_APP_URL: 'https://app.komtru.com',
      NEXT_PUBLIC_KOMTRU_API_URL: 'https://api.komtru.com/v1',
    },
  ),
  sentryDsn,
});

beforeEach(() => {
  vi.mocked(Sentry.init).mockClear();
});

describe('initSentry', () => {
  it('is a no-op without a DSN, which is local development', () => {
    const tracker = initSentry(base(), 'server');
    expect(tracker.enabled).toBe(false);
    expect(() => tracker.captureException(new Error('x'))).not.toThrow();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('resolves its flush without a DSN, so a shutdown path never hangs on it', async () => {
    await expect(initSentry(base(), 'server').flush()).resolves.toBe(true);
  });

  it('initialises once with a DSN', () => {
    const tracker = initSentry(base('https://k@o.ingest.sentry.io/1'), 'browser');
    expect(tracker.enabled).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});

describe('sentryOptions', () => {
  it('collects no user, cookie, header, body or query data', () => {
    expect(sentryOptions(base('https://k@o.ingest.sentry.io/1'), 'edge')).toMatchObject({
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
    });
  });

  it.each(['server', 'edge', 'browser'] as const)('tags which app and that it was %s', (runtime) => {
    expect(sentryOptions(base('https://k@o.ingest.sentry.io/1'), runtime)).toMatchObject({
      dsn: 'https://k@o.ingest.sentry.io/1',
      initialScope: { tags: { app: 'web-app-ui', runtime } },
    });
  });
});
