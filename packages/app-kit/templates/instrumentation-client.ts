// Copy to `instrumentation-client.ts` at the app root. The browser half of the same init.
import { initSentry } from '@komtru/app-kit/sentry';
import { readAppConfig } from '@komtru/app-kit';
import { appSpec } from './src/app-config.js';

initSentry(readAppConfig(appSpec, process.env), 'browser');
