import { cx } from './cx.js';

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
