// Copy to `instrumentation-client.ts` at the app root. The browser half of the same init.
//
// `publicEnv()`, not `process.env`: Next inlines `process.env.NEXT_PUBLIC_X` into the client bundle
// one literal at a time and never defines `process.env` itself, so passing it whole here throws at
// module evaluation and the app white-screens.
import { publicEnv, readAppConfig } from '@komtru/app-kit';
import { initSentry } from '@komtru/app-kit/sentry';
import { appSpec } from './src/app-config.js';

initSentry(readAppConfig(appSpec, publicEnv()), 'browser');
