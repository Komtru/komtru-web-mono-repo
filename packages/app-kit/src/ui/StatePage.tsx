import { EmptyState, type EmptyStateTone } from '@komtru/ui-kit';

/**
 * The page both the error and the not-found screen are drawn on: the reference's `.state-panel`,
 * centred on the page background, capped at 360px so the measure stays under the 45-ish characters
 * the reference sets its body copy at.
 *
 * **No `<main>`.** `error.tsx` and `not-found.tsx` render inside the app's layout, which already
 * carries the shell's `<main>`, and two `main` landmarks is an axe violation on every error page in
 * the product. The `global-error.tsx` template replaces the whole document and supplies the
 * landmark there instead.
 */
export interface StatePageProps {
  tone: EmptyStateTone;
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  /** Shown under the panel in the mono face, the way a Trade code is. */
  reference?: string;
}

export function StatePage({
  tone,
  icon,
  title,
  body,
  action,
  secondaryAction,
  reference,
}: StatePageProps): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-secondary p-[16px]">
      <div className="w-full max-w-[360px]">
        <EmptyState
          tone={tone}
          icon={icon}
          title={title}
          body={body}
          {...(action === undefined ? {} : { action })}
          {...(secondaryAction === undefined ? {} : { secondaryAction })}
        />
        {reference !== undefined && (
          <p className="mt-[12px] text-center font-mono text-[10.5px] text-trust-gray">{reference}</p>
        )}
      </div>
    </div>
  );
}
