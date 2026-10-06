// Next calls `register()` once per server runtime.
import { initSentry } from '@komtru/app-kit/sentry';
import { readWebAppConfig } from './src/app-config';

export function register(): void {
  const runtime = process.env.NEXT_RUNTIME === 'edge' ? 'edge' : 'server';
  initSentry(readWebAppConfig(process.env), runtime);
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
