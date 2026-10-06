import { cx } from './cx.js';

/**
 * The reference's four in-screen notes, all one shape: `.proof-compare-note` (info),
 * `.guard-lock-banner` (warning), `.guard-lock-banner.ready` (success). The risk tone keeps the same
 * geometry with the risk pair — the reference has no banner in that tone, only risk panels.
 */
export type BannerTone = 'info' | 'warning' | 'success' | 'risk';

interface BannerTreatment {
  surface: string;
  accent: string;
  /** `.proof-compare-note` clears 14px; `.guard-lock-banner` and `.inspect-banner` clear 16px. */
  gap: string;
  /** `.proof-compare-note svg` is 15px; `.guard-lock-banner svg` is 16px. */
  icon: string;
  /** The info note's body is 11.5px at 1.5 and fully opaque; the alert banners' is 11px at 80%. */
  body: string;
}

const NOTE_BODY = 'text-[11.5px] leading-[1.5] text-midnight-text';
const ALERT_BODY = 'text-[11px] text-midnight-text opacity-[.8]';

const TONES: Record<BannerTone, BannerTreatment> = {
  info: {
    surface: 'bg-trust-indigo-soft',
    accent: 'text-info-on-soft',
    gap: 'mb-[14px]',
    icon: 'h-[15px] w-[15px]',
    body: NOTE_BODY,
  },
  warning: {
    surface: 'bg-warning-soft',
    accent: 'text-warning-on-soft',
    gap: 'mb-[16px]',
    icon: 'h-[16px] w-[16px]',
    body: ALERT_BODY,
  },
  success: {
    surface: 'bg-success-soft',
    accent: 'text-success-on-soft',
    gap: 'mb-[16px]',
    icon: 'h-[16px] w-[16px]',
    body: ALERT_BODY,
  },
  risk: {
    surface: 'bg-risk-soft',
    accent: 'text-risk-on-soft',
    gap: 'mb-[16px]',
    icon: 'h-[16px] w-[16px]',
    body: ALERT_BODY,
  },
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
  const { surface, accent, gap, icon: iconSize, body } = TONES[tone];
  return (
    <div
      role={tone === 'risk' ? 'alert' : 'status'}
      className={cx('flex gap-[10px] rounded-md py-[12px] px-[14px]', gap, surface, className)}
    >
      {icon !== undefined && (
        // `stroke` is an inherited SVG property, so stroking the wrapper strokes whatever icon a
        // screen passes without it having to know the tone. `stroke-current` is `color`, which is
        // the same `--…-on-soft` token the reference strokes the icon with directly.
        <span aria-hidden className={cx('mt-[1px] shrink-0 stroke-current', iconSize, accent)}>
          {icon}
        </span>
      )}
      <div>
        {title !== undefined && <b className={cx('block text-[12.5px]', accent)}>{title}</b>}
        <span className={body}>{children}</span>
      </div>
    </div>
  );
}
