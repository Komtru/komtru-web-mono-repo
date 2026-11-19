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
  children,
}: ProposeWorkspaceProps): React.JSX.Element {
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
            className="hidden min-w-0 md:sticky md:top-[16px] md:block md:self-start"
          >
            {preview}
          </aside>
        )}
      </div>
    </div>
  );
}
