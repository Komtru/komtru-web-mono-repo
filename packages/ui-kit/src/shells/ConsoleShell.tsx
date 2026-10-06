import { cx } from '../primitives/cx.js';
import { FOCUS_RING } from '../primitives/focus.js';
import { type NavItem, soleCurrent } from './NavItem.js';
import { ShellBrand } from './ShellBrand.js';

export interface ConsoleShellProps {
  brandLabel?: string;
  brandIcon?: React.ReactNode;
  nav: readonly NavItem[];
  navLabel?: string;
  /**
   * Holds the rail collapsed at every width. Below `lg` it is collapsed regardless — TO-PA9 is the
   * reference's tablet state, "same left pane, collapsed to icons".
   */
  collapsed?: boolean;
  /** Below the rail, after `.ko-nav-divider` — where the reference's Collapse control sits. */
  navFooter?: React.ReactNode;
  /** `.ko-page-head` — what this screen is, in one line, and what can be done about it. */
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * `.ko-dweb-shell` — the TrustOps console. A 228px rail at `lg`, the 68px icon rail below it.
 *
 * The section this shell comes from describes it as "180px sidebar, 24px content padding"; the rule
 * it actually ships is 228px and `24px 28px 28px`. The rule wins — it is what every TrustOps screen
 * is drawn against — and the prose is recorded in `DEVIATIONS.md`.
 *
 * Collapsing hides every label, so each destination carries its own accessible name and a `title`.
 * A rail of bare glyphs is unusable otherwise, and the reference's rule gives it neither.
 */
export function ConsoleShell({
  brandLabel = 'Komtru Ops',
  brandIcon,
  nav,
  navLabel = 'Console sections',
  collapsed = false,
  navFooter,
  title,
  description,
  actions,
  children,
}: ConsoleShellProps): React.JSX.Element {
  const current = soleCurrent(nav, 'ConsoleShell');
  // One conditional, read four times: the rail is collapsed below `lg` always, and at `lg` too when
  // a person has collapsed it. Writing the breakpoint per element is how the four drift apart.
  const expandsAtLg = !collapsed;
  const labelClass = cx('hidden', expandsAtLg && 'lg:inline');

  return (
    <div className="flex min-h-dvh items-stretch">
      <aside
        className={cx(
          'flex w-[68px] shrink-0 grow-0 basis-[68px] flex-col gap-[2px] border-r-[1px] border-r-border-hairline bg-surface-primary pt-[18px] pr-[10px] pb-[14px] pl-[10px]',
          'transition-[width,flex-basis] duration-[180ms] ease-[ease] motion-reduce:transition-none',
          expandsAtLg && 'lg:w-[228px] lg:basis-[228px]',
        )}
      >
        <ShellBrand
          label={brandLabel}
          icon={brandIcon}
          className={cx(
            'h-[36px] gap-[9px] pt-0 pr-[10px] pb-[14px] pl-[10px] text-[11px] font-extrabold whitespace-nowrap',
            expandsAtLg ? 'justify-center lg:justify-start' : 'justify-center',
          )}
          labelClassName={labelClass}
        />
        <nav aria-label={navLabel} className="flex flex-col gap-[2px]">
          {nav.map((item, index) => {
            const active = index === current;
            const itemClass = cx(
              'flex min-h-[36px] items-center gap-[10px] rounded-[7px] px-0 py-0 text-[10px] whitespace-nowrap',
              active ? 'bg-trust-indigo-soft font-bold text-midnight-text' : 'text-slate',
              // Only when it is not the current destination: Tailwind emits `hover:` after the base
              // utilities, so a hover background on the active item would beat its indigo pill —
              // the reverse of the reference, where `:hover` is declared before `.active`.
              !active && 'hover:bg-surface-secondary',
              expandsAtLg ? 'justify-center lg:justify-start lg:px-[10px]' : 'justify-center',
              FOCUS_RING,
            );
            const content = (
              <>
                <span
                  aria-hidden
                  className="inline-flex h-[16px] w-[16px] min-w-[16px] items-center justify-center stroke-current"
                >
                  {item.icon}
                </span>
                <span className={labelClass}>{item.label}</span>
              </>
            );

            return item.href === undefined ? (
              <button
                key={item.label}
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                onClick={item.onSelect}
                className={itemClass}
              >
                {content}
              </button>
            ) : (
              <a
                key={item.label}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={itemClass}
              >
                {content}
              </a>
            );
          })}
        </nav>
        {navFooter !== undefined && (
          <>
            <div aria-hidden className="mt-[10px] mr-[8px] mb-[10px] ml-[8px] h-[1px] bg-border-hairline" />
            {navFooter}
          </>
        )}
      </aside>

      <div className="min-w-0 flex-1 bg-surface-primary pt-[24px] pr-[28px] pb-[28px] pl-[28px]">
        <header className="mb-[18px] flex items-start justify-between gap-[20px]">
          <div>
            {/* The shell owns the page's one top-level heading: a console screen's title is the
                page, and leaving it to the body is how two h1s end up on one screen. */}
            <h1 className="m-0 text-[19px] leading-[1.2]">{title}</h1>
            {description !== undefined && (
              <p className="mt-[5px] mr-0 mb-0 ml-0 text-[10px] text-slate">{description}</p>
            )}
          </div>
          {actions}
        </header>
        {children}
      </div>
    </div>
  );
}
