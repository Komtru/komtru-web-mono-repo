import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

export interface ScreenHeaderProps {
  title: string;
  /** Where the round back control goes. Omitted leaves the 32px spacer, so the title stays centred. */
  backHref?: string;
  /** A step back inside the same screen (a button, not a link). Ignored when `backHref` is given. */
  onBack?: () => void;
  backLabel?: string;
  /** `p` when the screen's own hero carries the page's one `h1`. */
  as?: 'h1' | 'p';
  className?: string;
}

const CHEVRON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

const BACK = cx(
  'flex h-[32px] w-[32px] items-center justify-center rounded-[50%] bg-surface-secondary',
  FOCUS_RING,
);

/**
 * `.scr-topbar`, for a screen that already lives inside the app shell: the round back control, the
 * title and the spacer that keeps it centred. The reference's version is a sticky bar of its own,
 * which inside the shell would be a second header under the first.
 */
export function ScreenHeader({
  title,
  backHref,
  onBack,
  backLabel = 'Back',
  as: Tag = 'h1',
  className,
}: ScreenHeaderProps): React.JSX.Element {
  return (
    <div className={cx('mb-[16px] flex items-center justify-between', className)}>
      {backHref !== undefined ? (
        <a href={backHref} aria-label={backLabel} className={BACK}>
          <span className="h-[16px] w-[16px] stroke-midnight-text">{CHEVRON}</span>
        </a>
      ) : onBack !== undefined ? (
        <button type="button" onClick={onBack} aria-label={backLabel} className={cx(BACK, 'border-0 p-0')}>
          <span className="h-[16px] w-[16px] stroke-midnight-text">{CHEVRON}</span>
        </button>
      ) : (
        <span className="h-[32px] w-[32px]" />
      )}
      <Tag className="text-[14px] font-semibold">{title}</Tag>
      <span className="h-[32px] w-[32px]" />
    </div>
  );
}
