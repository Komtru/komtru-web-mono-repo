'use client';

import type { ReactNode } from 'react';

export interface ProposeWorkspaceProps {
  /** The screen's title and back link: drawn once, across the whole frame, above the rail. */
  header?: ReactNode;
  /** The assembly rail: the stages the trade goes through, with the one the person is on marked. Absent where a screen is not staged. */
  rail?: ReactNode;
  /** The contract so far: the figures and terms the person has entered, beside the stage they are on. */
  preview?: ReactNode;
  /** What the preview column is called for assistive technology. Defaults to "Contract so far". */
  previewLabel?: string;
  /**
   * Draws the preview above the stage on a phone too. The contract preview is a tablet and desktop addition, so it
   * is hidden below `md` unless a screen's own mobile design is the summary (the payment screens' "What you pay").
   */
  previewOnMobile?: boolean;
  /**
   * A screen that answers a proposal rather than building one (DX-12, TX-08): the response to it (the address, the
   * proof, accept, change or decline). Beside the content from tablet up, sticky; under it on a phone. Only used
   * where there is no rail.
   */
  decision?: ReactNode;
  /** What the decision column is called for assistive technology. */
  decisionLabel?: string;
  /** The stage itself. */
  children: ReactNode;
}

/**
 * One frame for the propose-and-fund flow at every width, so the desktop and tablet drawings are the same screens
 * as the phone's, arranged rather than redrawn (F-068, F-072):
 *
 *   base         the stage rail on top, the stage under it; the preview is folded into the stage itself
 *   `md` → `lg`  tablet: the rail across the top, the stage beside the contract preview
 *   `lg` →       desktop: the assembly rail down the left, the stage in the middle, the preview on the right
 *
 * The rail and the preview are the same nodes at every width, so nothing is rendered twice: the arrangement is
 * CSS, not a second copy of the content.
 */
export function ProposeWorkspace({
  header,
  rail,
  preview,
  previewLabel = 'Contract so far',
  previewOnMobile = false,
  decision,
  decisionLabel = 'Your response',
  children,
}: ProposeWorkspaceProps): React.JSX.Element {
  // No rail: the screen is not staged, so there is no 200px rail column to reserve. With a decision it is the
  // content beside the response; without one, a single readable column.
  if (rail === undefined && preview === undefined) {
    return (
      <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-none">
        {header}
        {decision === undefined ? (
          <div data-propose-work className="mx-auto min-w-0 md:max-w-[640px]">
            {children}
          </div>
        ) : (
          <div className="grid gap-[16px] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-[20px] lg:gap-[24px]">
            <div data-propose-work className="min-w-0">
              {children}
            </div>
            <section aria-label={decisionLabel} className="min-w-0 md:sticky md:top-[16px] md:self-start">
              {decision}
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-[760px] lg:max-w-none">
      {header}
      <div
        className={[
          'grid gap-[16px]',
          preview === undefined
            ? 'lg:grid-cols-[200px_minmax(0,1fr)]'
            : 'md:grid-cols-[minmax(0,1fr)_minmax(0,260px)] lg:grid-cols-[200px_minmax(0,1.5fr)_minmax(0,1fr)]',
        ].join(' ')}
      >
        {rail !== undefined && (
          <nav
            aria-label="Trade assembly"
            className={preview === undefined ? 'min-w-0' : 'min-w-0 md:col-span-2 lg:col-span-1'}
          >
            {rail}
          </nav>
        )}
        <div data-propose-work className={preview === undefined ? 'min-w-0 lg:col-span-1' : 'min-w-0'}>
          {children}
        </div>
        {preview !== undefined && (
          <aside
            aria-label={previewLabel}
            className={
              previewOnMobile
                ? 'order-first min-w-0 md:order-none md:sticky md:top-[16px] md:self-start'
                : 'hidden min-w-0 md:sticky md:top-[16px] md:block md:self-start'
            }
          >
            {preview}
          </aside>
        )}
      </div>
    </div>
  );
}
