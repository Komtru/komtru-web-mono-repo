// Copy to `app/not-found.tsx`. A Server Component: nothing here is interactive.
import { NotFoundScreen } from '@komtru/app-kit/ui';
import { appSpec } from '../src/app-config.js';

export default function NotFound() {
  return <NotFoundScreen homeHref={appSpec.homePath ?? '/'} homeLabel="Go to Trades" />;
}
