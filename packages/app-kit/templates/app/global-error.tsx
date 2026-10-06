'use client';

// Copy to `app/global-error.tsx`. This one replaces the whole document, layout included, so it
// supplies the `<html>`, the `<body>` and the `<main>` landmark `ErrorScreen` deliberately omits.
import { ErrorScreen } from '@komtru/app-kit/ui';
import '@komtru/app-kit/styles.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main>
          {/* The only heading ErrorScreen draws is the panel's; a document needs a level one. */}
          <h1 className="sr-only">Something went wrong</h1>
          <ErrorScreen
            {...(error.digest === undefined ? {} : { reference: error.digest })}
            onRetry={reset}
            homeHref="/"
            homeLabel="Go to the home page"
          />
        </main>
      </body>
    </html>
  );
}
