// Next calls `register()` once per server runtime.
import { initSentry } from '@komtru/app-kit/sentry';
import { readAppConfig } from '@komtru/app-kit';
import { appSpec } from './src/app-config';

export function register(): void {
  const runtime = process.env.NEXT_RUNTIME === 'edge' ? 'edge' : 'server';
  initSentry(readAppConfig(appSpec, process.env), runtime);
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
