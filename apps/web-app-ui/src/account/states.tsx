'use client';

import { Button, EmptyState, LoadFailed, ScreenColumn, Skeleton } from '@komtru/ui-kit';
import { useOnline } from '../shell/OfflineStatus';

/** The loading state every data-backed account screen shows while its first read is in flight. */
export function Loading({ label, lines = 3 }: { label: string; lines?: number }): React.JSX.Element {
  return (
    <div role="status" aria-label={label} aria-busy="true">
      <Skeleton width="full" lines={lines} />
    </div>
  );
}

/**
 * The error state, and its offline twin. A failed read with no network is a different thing to tell someone from a
 * platform that did not answer: one is theirs to fix and the other is not. `navigator.onLine` only ever explains the
 * screen, never decides whether to ask again (the retry always goes out).
 */
export function LoadProblem({
  what,
  onRetry,
}: {
  /** What was being loaded, in the person's words: "your devices". */
  what: string;
  onRetry: () => void;
}): React.JSX.Element {
  const online = useOnline();
  if (!online) {
    return (
      <ScreenColumn>
        <EmptyState
          title="You’re offline"
          body={`Reconnect to see ${what}. Nothing here has changed.`}
          action={
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </ScreenColumn>
    );
  }
  return (
    <LoadFailed
      title={`Couldn’t load ${what}`}
      body="Check your connection and try again."
      onRetry={onRetry}
    />
  );
}
