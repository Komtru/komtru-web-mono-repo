// A Server Component: nothing here is interactive.
import { NotFoundScreen } from '@komtru/app-kit/ui';
import { appSpec } from '../src/app-config';

export default function NotFound(): React.JSX.Element {
  return <NotFoundScreen homeHref={appSpec.homePath} homeLabel="Go to Trades" />;
}
