// Error tracking for every Komtru Next app, in all three runtimes Next has. Without a DSN it is a
// no-op (design §12 Q8) — local development reports nothing and needs no account.
//
// The data-collection lockdown is `apps/backend-api/src/platform/sentry.ts`'s, deliberately kept
// identical: Sentry 11 collects user info, cookies, headers, request bodies and query strings by
// default, and on an escrow platform every one of those carries credentials, OTPs, bank details or
// personal data. Errors arrive with a stack trace and two tags, and nothing else. The browser
// runtime matters most here — the backend at least controls its own process; a browser event can
// carry whatever was in the DOM.
import * as Sentry from '@sentry/nextjs';
import type { AppConfig } from './config.js';

/** Next's three: `instrumentation.ts` covers two, `instrumentation-client.ts` the third. */
export type SentryRuntime = 'server' | 'edge' | 'browser';

export interface ErrorTracker {
  enabled: boolean;
  captureException(error: unknown): void;
  flush(timeoutMs?: number): Promise<boolean>;
}

export const sentryOptions = (config: AppConfig, runtime: SentryRuntime): Sentry.NodeOptions => ({
  dsn: config.sentryDsn,
  initialScope: { tags: { app: config.appName, runtime } },
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
  },
});

export function initSentry(config: AppConfig, runtime: SentryRuntime): ErrorTracker {
  if (!config.sentryDsn) {
    return { enabled: false, captureException: () => {}, flush: () => Promise.resolve(true) };
  }
  Sentry.init(sentryOptions(config, runtime));
  return {
    enabled: true,
    captureException: (error) => {
      Sentry.captureException(error);
    },
    flush: (timeoutMs = 2000) => Sentry.flush(timeoutMs),
  };
}
