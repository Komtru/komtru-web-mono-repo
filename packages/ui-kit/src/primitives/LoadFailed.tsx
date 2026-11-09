import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';
import { ScreenColumn } from './ScreenColumn.js';

export interface LoadFailedProps {
  title: string;
  body: string;
  /** Omitted when trying again cannot help (a trade that does not exist). */
  onRetry?: React.MouseEventHandler<HTMLButtonElement>;
}

/** A read that failed: say what, and offer the one thing that can help. */
export function LoadFailed({ title, body, onRetry }: LoadFailedProps): React.JSX.Element {
  return (
    <ScreenColumn>
      <EmptyState
        tone="error"
        title={title}
        body={body}
        {...(onRetry === undefined
          ? {}
          : {
              action: (
                <Button type="button" onClick={onRetry}>
                  Try again
                </Button>
              ),
            })}
      />
    </ScreenColumn>
  );
}
