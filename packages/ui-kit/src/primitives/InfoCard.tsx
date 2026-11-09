import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

const CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export interface InfoRowProps {
  /** A 20px line icon, decorative. */
  icon?: React.ReactNode;
  title: string;
  detail?: React.ReactNode;
  /** Makes the row a link with a chevron. Without it the row is plain information. */
  href?: string;
}

/** `.lc-row` — an icon, a bold line and a muted one; a link when it leads somewhere. */
export function InfoRow({ icon, title, detail, href }: InfoRowProps): React.JSX.Element {
  const body = (
    <>
      {icon !== undefined && (
        <span
          aria-hidden
          className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] bg-surface-secondary [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:stroke-slate"
        >
          {icon}
        </span>
      )}
      <span className="flex-1 text-left text-[12.5px]">
        <b className="block">{title}</b>
        {detail !== undefined && <span className="text-[11px] text-slate">{detail}</span>}
      </span>
      {href !== undefined && (
        <span aria-hidden className="h-[14px] w-[14px] shrink-0 stroke-trust-gray">
          {CHEVRON}
        </span>
      )}
    </>
  );
  const row =
    'flex w-full items-center gap-[10px] border-b border-solid border-border-hairline py-[11px] last:border-b-0';
  return href === undefined ? (
    <li className={row}>{body}</li>
  ) : (
    <li className="m-0 list-none">
      <a href={href} className={cx(row, FOCUS_RING)}>
        {body}
      </a>
    </li>
  );
}

/** `.logistics-card` — the card a run of `InfoRow`s sits in. A list: each row is one thing. */
export function InfoCard({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}): React.JSX.Element {
  return (
    <ul
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      className={cx(
        'mb-[14px] list-none rounded-md border border-solid border-border-hairline bg-surface-primary px-[14px] py-0',
        className,
      )}
    >
      {children}
    </ul>
  );
}
