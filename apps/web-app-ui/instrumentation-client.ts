// The browser half of the same init. `webAppEnv()`, not `process.env`: Next inlines
// `process.env.NEXT_PUBLIC_X` into the client bundle one literal at a time and never defines
// `process.env` itself, so passing it whole here throws at module evaluation.
import { initSentry } from '@komtru/app-kit/sentry';
import { readWebAppConfig, webAppEnv } from './src/app-config';

initSentry(readWebAppConfig(webAppEnv()), 'browser');
