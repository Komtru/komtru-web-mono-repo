import { Button } from '@komtru/ui-kit';
import { CompassIcon } from './icons.js';
import { StatePage } from './StatePage.js';

export interface NotFoundScreenProps {
  homeHref: string;
  homeLabel: string;
}

/**
 * The screen behind a URL that does not resolve.
 *
 * `tone="empty"`, not `"error"`: a page that is not here is an absence, not a fault, and painting
 * it in the risk palette tells the reader something went wrong when nothing did. One way out, not
 * two — there is nothing to retry, and a second button on a screen with one sensible action is the
 * accessory to take off before leaving the house.
 */
export function NotFoundScreen({ homeHref, homeLabel }: NotFoundScreenProps): React.JSX.Element {
  return (
    <StatePage
      tone="empty"
      icon={<CompassIcon />}
      title="That page isn't here"
      body="The link may be out of date, or whatever was here has moved on."
      action={
        <Button variant="secondary" asChild>
          <a href={homeHref}>{homeLabel}</a>
        </Button>
      }
    />
  );
}
