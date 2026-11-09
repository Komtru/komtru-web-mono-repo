import { Skeleton } from './Skeleton.js';
import { ScreenColumn } from './ScreenColumn.js';

/** What a screen shows while its data is on the way: the shape of the page, not a spinner. */
export function LoadingScreen({ label }: { label: string }): React.JSX.Element {
  return (
    <ScreenColumn>
      <div role="status" aria-label={label} aria-busy="true">
        <Skeleton width="full" lines={4} />
      </div>
    </ScreenColumn>
  );
}
