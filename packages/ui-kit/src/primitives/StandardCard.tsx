import { cx } from './cx.js';

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
