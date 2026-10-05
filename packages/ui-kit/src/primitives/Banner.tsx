import { cx } from './cx.js';

/**
 * The reference's four in-screen notes, all one shape: `.proof-compare-note` (info),
 * `.guard-lock-banner` (warning), `.guard-lock-banner.ready` (success). The risk tone keeps the same
 * geometry with the risk pair — the reference has no banner in that tone, only risk panels.
 */
export type BannerTone = 'info' | 'warning' | 'success' | 'risk';

const TONES: Record<BannerTone, { surface: string; accent: string; gap: string }> = {
  // The reference's `.proof-compare-note` clears 14px; `.guard-lock-banner` and `.inspect-banner` 16px.
  info: { surface: 'bg-trust-indigo-soft', accent: 'text-info-on-soft', gap: 'mb-[14px]' },
  warning: { surface: 'bg-warning-soft', accent: 'text-warning-on-soft', gap: 'mb-[16px]' },
  success: { surface: 'bg-success-soft', accent: 'text-success-on-soft', gap: 'mb-[16px]' },
  risk: { surface: 'bg-risk-soft', accent: 'text-risk-on-soft', gap: 'mb-[16px]' },
};

export interface BannerProps {
  tone: BannerTone;
  /** Inherits the tone's `on-soft` colour, as the reference's banner icons do. */
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Banner({ tone, icon, title, children, className }: BannerProps): React.JSX.Element {
  const { surface, accent, gap } = TONES[tone];
  return (
    <div
      role={tone === 'risk' ? 'alert' : 'status'}
      className={cx('flex gap-[10px] rounded-md py-[12px] px-[14px]', gap, surface, className)}
    >
      {icon !== undefined && (
        <span aria-hidden className={cx('mt-[1px] h-[16px] w-[16px] shrink-0', accent)}>
          {icon}
        </span>
      )}
      <div>
        {title !== undefined && <b className={cx('block text-[12.5px]', accent)}>{title}</b>}
        <span className="text-[11px] text-midnight-text opacity-[.8]">{children}</span>
      </div>
    </div>
  );
}
