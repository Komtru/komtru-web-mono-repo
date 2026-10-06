'use client';

// Next renders this in place of the page, inside the app's own layout — which is why `ErrorScreen`
// draws no `<main>` of its own.
import { ErrorScreen } from '@komtru/app-kit/ui';
import { appSpec } from '../src/app-config';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <ErrorScreen
      {...(error.digest === undefined ? {} : { reference: error.digest })}
      onRetry={reset}
      homeHref={appSpec.homePath}
      homeLabel="Go to Trades"
    />
  );
}
