import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

/**
 * `.m-settings-group`, `.m-settings-label` and `.m-settings-row` — the grouped list the reference
 * builds every account, notification and security screen out of (C10, M1, AS1, J3, S10).
 *
 * One row is either a destination (a chevron, and tapping it goes somewhere) or a setting (a
 * control on the right, and the row itself does nothing). Those are the only two shapes the
 * reference draws, and keeping them in one component is what stops the second screen inventing a
 * third.
 */

export interface SettingsGroupProps {
  /** `.m-settings-label` — the small uppercase heading over the rows. */
  label?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingsGroup({ label, children, className }: SettingsGroupProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'mb-[14px] overflow-hidden rounded-md border border-solid border-border-hairline bg-surface-primary',
        className,
      )}
    >
      {label !== undefined && (
        <h3 className="pt-[11px] pr-[14px] pb-[5px] pl-[14px] text-[10px] font-bold tracking-[.04em] text-slate uppercase">
          {label}
        </h3>
      )}
      {/* The rows in their own element so `first:` means "the first row" whether or not the group is
          headed. The reference states it the other way round — `.m-settings-label + .m-settings-row`
          — which leaves an unheaded group's first row drawing a line on top of the group's own
          border; every group the reference draws is headed, so the two agree wherever it looks. */}
      <div>{children}</div>
    </div>
  );
}

/** The chevron the reference draws on a row that goes somewhere. */
const CHEVRON = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    className="h-[14px] w-[14px] shrink-0 stroke-trust-gray"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export interface SettingsRowProps {
  /** `.sr-label` — what this is, in the words the person would use. */
  label: string;
  /** `.sr-sub` — the state it is in. "Push + Email", "1 device", "Not yet set up". */
  sub?: string;
  /** Given, the row is a link and draws the reference's chevron. */
  href?: string;
  /**
   * Leaves the app. The link opens in place — a profile a buyer shares and the Park Agent app are
   * both destinations, not pop-ups — but says so, because `rel` is what keeps the new document from
   * reaching back into this one if a person chooses to open it in a tab.
   */
  external?: boolean;
  /** A `<Toggle>`, a value, a chip. Ignored on a link, which draws the chevron instead. */
  control?: React.ReactNode;
  className?: string;
}

export function SettingsRow({
  label,
  sub,
  href,
  external = false,
  control,
  className,
}: SettingsRowProps): React.JSX.Element {
  const rowClass = cx(
    'flex items-center justify-between gap-[10px] border-t-[1px] border-t-border-hairline',
    'pt-[12px] pr-[14px] pb-[12px] pl-[14px] first:border-t-0',
    className,
  );

  const body = (
    <>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold">{label}</span>
        {sub !== undefined && <span className="mt-[1px] block text-[10.5px] text-slate">{sub}</span>}
      </span>
      {href === undefined ? control : CHEVRON}
    </>
  );

  return href === undefined ? (
    <div className={rowClass}>{body}</div>
  ) : (
    <a
      href={href}
      {...(external ? { rel: 'noreferrer' } : {})}
      className={cx(rowClass, 'no-underline', FOCUS_RING)}
    >
      {body}
    </a>
  );
}
