import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';

/** The 32px round control the reference puts at either end of `.scr-topbar`. */
export interface TopBarAction {
  /** The accessible name. The control is an icon, so this is the only name it has. */
  label: string;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** `.tb-dot` — the unread marker the reference draws on the alerts icon. */
  badge?: boolean;
}

export interface TopBarProps {
  title: string;
  /** Omitted leaves the reference's own 32px spacer, so the title stays centred. */
  back?: TopBarAction;
  action?: TopBarAction;
}

/** The chevron the reference draws in every back button, at its own stroke weight. */
const BACK_CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

const CONTROL = 'flex h-[32px] w-[32px] items-center justify-center rounded-[50%] bg-surface-secondary';

/**
 * The round icon control `.scr-topbar` and `.scr-logo-row` share. Exported for `<LogoBar>`, which
 * draws the same control opposite a different left-hand side.
 */
export function TopBarControl({
  action,
  fallbackIcon,
  className: extra,
}: {
  action: TopBarAction;
  fallbackIcon?: React.ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {/* `stroke` is inherited, so stroking the wrapper strokes whatever icon a screen passes; the
          reference strokes the `svg` itself with the same `--midnight-text`. */}
      <span aria-hidden className="h-[16px] w-[16px] stroke-current text-midnight-text">
        {action.icon ?? fallbackIcon}
      </span>
      {action.badge === true && (
        <span
          aria-hidden
          className="absolute top-[6px] right-[7px] h-[6px] w-[6px] rounded-[50%] border-[1.5px] border-solid border-surface-primary bg-risk"
        />
      )}
    </>
  );
  const className = cx(CONTROL, extra, FOCUS_RING);

  return action.href === undefined ? (
    <button type="button" aria-label={action.label} onClick={action.onClick} className={className}>
      {inner}
    </button>
  ) : (
    <a href={action.href} aria-label={action.label} className={className}>
      {inner}
    </a>
  );
}

/**
 * `.scr-topbar` — the sticky bar a mobile screen inside a flow carries: back, the screen's name,
 * and at most one action. The reference's other mobile top bar is `<LogoBar>`.
 *
 * The title is a `<b>`, not a heading. The reference's own screens put the real heading in the body
 * ("Enter code" in the bar, "Enter the 6-digit code" below it), and promoting the bar's label would
 * give every screen two competing h1s.
 */
export function TopBar({ title, back, action }: TopBarProps): React.JSX.Element {
  return (
    <header className="sticky top-0 z-[5] flex items-center justify-between border-b-[1px] border-b-border-hairline bg-surface-primary pt-[16px] pr-[16px] pb-[12px] pl-[16px]">
      {back === undefined ? (
        <span aria-hidden className="w-[32px]" />
      ) : (
        <TopBarControl action={back} fallbackIcon={BACK_CHEVRON} />
      )}
      <b className="text-[14px] font-semibold">{title}</b>
      {action === undefined ? (
        <span aria-hidden className="w-[32px]" />
      ) : (
        <TopBarControl action={action} className="relative" />
      )}
    </header>
  );
}
