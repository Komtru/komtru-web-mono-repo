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

/** `.scr-label` — the small caps heading over a block of terms or fields. */
export function SectionLabel({
  children,
  as: Tag = 'h2',
  className,
}: {
  children: React.ReactNode;
  as?: 'h2' | 'h3' | 'p';
  className?: string;
}): React.JSX.Element {
  return (
    <Tag
      className={cx(
        'mb-[8px] mt-[18px] text-[11px] font-bold uppercase tracking-[.04em] text-slate first:mt-0',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export interface CounterDiffRowProps {
  label: string;
  /** What the other party proposed, struck through. */
  before: string;
  /** What this counter says instead. */
  after: string;
  beforeCaption?: string;
  afterCaption?: string;
}

/** `.counter-diff-row` — a term that changed: the old value struck through above the new one. */
export function CounterDiffRow({
  label,
  before,
  after,
  beforeCaption,
  afterCaption,
}: CounterDiffRowProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-[10px] border-b border-solid border-border-hairline py-[10px] text-[12.5px] last:border-b-0">
      <div className="shrink-0 font-semibold">{label}</div>
      <div className="text-right">
        <span className="block text-[11px] text-trust-gray line-through">
          <span className="sr-only">Was: </span>
          {before}
          {beforeCaption === undefined ? '' : ` — ${beforeCaption}`}
        </span>
        <span className="font-semibold text-success-on-soft">
          <span className="sr-only">Now: </span>
          {after}
          {afterCaption === undefined ? '' : ` — ${afterCaption}`}
        </span>
      </div>
    </div>
  );
}

export interface StandardCardProps {
  /** The category's name, "Electronics". */
  title: string;
  icon?: React.ReactNode;
  /** Colours the icon: electronics read as info, fashion as warning in the reference. */
  tone?: 'info' | 'warning';
  children: React.ReactNode;
}

/** `.terms-summary-card` — a titled group of terms, as CTS1 draws one per category. */
export function StandardCard({ title, icon, tone = 'info', children }: StandardCardProps): React.JSX.Element {
  return (
    <section className="mb-[20px] last:mb-0">
      <div className="mb-[8px] flex items-center gap-[10px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[12px]">
        {icon !== undefined && (
          <span
            aria-hidden
            className={cx(
              'h-[20px] w-[20px] shrink-0',
              tone === 'info' ? 'stroke-info-on-soft' : 'stroke-warning-on-soft',
            )}
          >
            {icon}
          </span>
        )}
        <h2 className="text-[14px] font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}
