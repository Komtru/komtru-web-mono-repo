import { Button } from '@komtru/ui-kit';
import { AlertIcon } from './icons.js';
import { StatePage } from './StatePage.js';

export interface ErrorScreenProps {
  /**
   * `error.digest` from Next's own boundary, or the `X-Request-Id` of the call that failed. Shown
   * so the person can quote it; the stack is Sentry's business and never the reader's.
   */
  reference?: string;
  /** Next's `reset`. Omitted where there is nothing to retry (a `global-error`, say). */
  onRetry?: () => void;
  homeHref: string;
  /** Named for the place, not the action: "Go to Trades", "Back to the work queue". */
  homeLabel: string;
}

/**
 * The screen a page shows when it cannot render.
 *
 * The voice is the reference's own failure screens — WF1 "This withdrawal didn't go through", U5
 * "PIN doesn't match — parcel stays held": say what happened in the reader's words, say what is
 * still safe, then give the way out. No apology, no "unexpected error", and the headline is never
 * a status code. On an escrow platform the sentence that matters is the second one, because the
 * question a failed screen raises is "did that take my money".
 */
export function ErrorScreen({
  reference,
  onRetry,
  homeHref,
  homeLabel,
}: ErrorScreenProps): React.JSX.Element {
  return (
    <StatePage
      tone="error"
      icon={<AlertIcon />}
      title="This page didn't load"
      body="Nothing you were doing was changed. Try again, and if it keeps happening give support the reference below."
      {...(onRetry === undefined
        ? {}
        : {
            action: (
              <Button variant="primary" onClick={onRetry}>
                Try again
              </Button>
            ),
          })}
      secondaryAction={
        <Button variant="secondary" asChild>
          <a href={homeHref}>{homeLabel}</a>
        </Button>
      }
      {...(reference === undefined ? {} : { reference })}
    />
  );
}
