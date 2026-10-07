// Next calls `register()` once per server runtime.
//
// `readAppConfig`, not `readWebAppConfig`: Sentry needs the app's name, its URL and the DSN. A
// deployment missing `NEXT_PUBLIC_KOMTRU_PARK_URL` should not be a deployment with no error
// reporting — least of all here, where the throw would happen before Sentry exists to report it.
import { initSentry } from '@komtru/app-kit/sentry';
import { readAppConfig } from '@komtru/app-kit';
import { appSpec } from './src/app-config';

export function register(): void {
  const runtime = process.env.NEXT_RUNTIME === 'edge' ? 'edge' : 'server';
  initSentry(readAppConfig(appSpec, process.env), runtime);
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
