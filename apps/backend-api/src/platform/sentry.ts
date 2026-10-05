// Error tracking. Every process (API and worker) reports unexpected errors to Sentry when a DSN is set;
// without one (local development, design §12 Q8) it is a no-op.
import * as Sentry from '@sentry/node';
import type { AppConfig } from '../config/env.js';

export interface ErrorTracker {
  enabled: boolean;
  captureException(error: unknown): void;
  flush(timeoutMs?: number): Promise<boolean>;
}

/**
 * Sentry 11 collects user info, cookies, headers and request bodies by default. On an escrow platform
 * those carry credentials, OTPs and personal data, so every category is switched off: errors arrive
 * with stack traces and tags only.
 */
export const sentryOptions = (config: AppConfig, processName: 'api' | 'worker'): Sentry.NodeOptions => ({
  dsn: config.sentry.dsn,
  environment: config.sentry.environment,
  initialScope: { tags: { process: processName } },
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
  },
});

export function initSentry(config: AppConfig, processName: 'api' | 'worker'): ErrorTracker {
  if (!config.sentry.dsn) {
    return { enabled: false, captureException: () => {}, flush: () => Promise.resolve(true) };
  }
  Sentry.init(sentryOptions(config, processName));
  return {
    enabled: true,
    captureException: (error) => {
      Sentry.captureException(error);
    },
    flush: (timeoutMs = 2000) => Sentry.flush(timeoutMs),
  };
}
