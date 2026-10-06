// Copy to `middleware.ts` at the app root. The whole of this app's session enforcement.
import { createKomtruMiddleware, KOMTRU_MATCHER } from '@komtru/app-kit/next';
import { createSessionSealer, readAppConfig, requireSessionSecret } from '@komtru/app-kit';
import { appSpec } from './src/app-config.js';

export default createKomtruMiddleware({
  config: readAppConfig(appSpec, process.env),
  sealer: createSessionSealer(requireSessionSecret(process.env)),
});

export const config = { matcher: [...KOMTRU_MATCHER] };
