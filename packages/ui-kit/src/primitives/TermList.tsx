import { cx } from './cx.js';

const TICK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M4.5 12.5l4.5 4.5L20 6" />
  </svg>
);

export interface TermRowProps {
  label: string;
  /** The value, as text or markup (a standard's name can sit in indigo beside "48 hours"). */
  children: React.ReactNode;
  /** The emerald tick the agreement screens draw before a term both sides can see. */
  checked?: boolean;
}

/** `.term-row` — one agreed or proposed term: label left, value right, a hairline under it. */
export function TermRow({ label, children, checked = false }: TermRowProps): React.JSX.Element {
  return (
    <div className="flex justify-between gap-[10px] border-b border-solid border-border-hairline py-[9px] text-[12.5px] last:border-b-0">
      <dt className="flex items-center font-semibold">
        {checked && <span className="mr-[6px] h-[14px] w-[14px] shrink-0 stroke-trust-emerald">{TICK}</span>}
        {label}
      </dt>
      <dd className="max-w-[55%] text-right text-slate">{children}</dd>
    </div>
  );
}

/** The list a run of `TermRow`s sits in. A description list, because each row is a term and its value. */
export function TermList({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}): React.JSX.Element {
  return (
    <dl {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })} className={cx('m-0', className)}>
      {children}
    </dl>
  );
}
