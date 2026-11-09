import { cx } from './cx.js';

export type StatusHeroTone = 'info' | 'success' | 'warning' | 'risk';

const RING: Record<StatusHeroTone, { stroke: string; mark: React.ReactNode }> = {
  success: { stroke: 'stroke-trust-emerald', mark: <path d="M7 12.5l3.2 3.2L17 9" /> },
  info: { stroke: 'stroke-info', mark: <path d="M12 7v5l3 3" /> },
  warning: { stroke: 'stroke-warning', mark: <path d="M12 7v5l3 3" /> },
  risk: { stroke: 'stroke-risk', mark: <path d="M12 8v5M12 16h.01" /> },
};

export interface StatusHeroProps {
  tone: StatusHeroTone;
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * `.m-success` — the ring, a heading and a short paragraph, centred. The shape of every "it
 * happened" and "it is held" screen: terms agreed, request sent, proposal held for review.
 */
export function StatusHero({ tone, title, children, className }: StatusHeroProps): React.JSX.Element {
  const { stroke, mark } = RING[tone];
  return (
    <div className={cx('px-[20px] pb-[20px] pt-[24px] text-center', className)}>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        className={cx('mx-auto mb-[16px] h-[56px] w-[56px]', stroke)}
      >
        <circle cx="12" cy="12" r="10" opacity=".15" />
        {tone !== 'success' && <circle cx="12" cy="12" r="9" />}
        {mark}
      </svg>
      <h1 className="mb-[6px] text-[19px] font-semibold">{title}</h1>
      <p className="mb-[16px] text-[12.5px] leading-[1.5] text-slate">{children}</p>
    </div>
  );
}

const CLOCK = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

/** `.countdown-strip` — the time left to answer, in the warning pair. */
export function CountdownStrip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      role="status"
      className="mb-[16px] flex items-center gap-[8px] rounded-md bg-warning-soft px-[14px] py-[10px] text-[12px] font-semibold text-warning-on-soft"
    >
      <span className="h-[14px] w-[14px] shrink-0 stroke-current">{CLOCK}</span>
      {children}
    </div>
  );
}

export interface CodeCardProps {
  label: string;
  /** The Trade Code, `KMT-90138`. */
  code: string;
  children?: React.ReactNode;
  className?: string;
}

/** `.code-share-card` — the Trade Code on midnight, mono and large: the one thing to keep or pass on. */
export function CodeCard({ label, code, children, className }: CodeCardProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'mb-[16px] rounded-lg bg-komtru-midnight p-[20px] text-center text-pure-white',
        className,
      )}
    >
      <div className="mb-[8px] text-[10px] uppercase tracking-[.08em] text-[rgba(255,255,255,.55)]">
        {label}
      </div>
      <div className="font-mono text-[26px] font-semibold tracking-[.05em]">{code}</div>
      {children !== undefined && <div className="mt-[14px] flex gap-[8px]">{children}</div>}
    </div>
  );
}
