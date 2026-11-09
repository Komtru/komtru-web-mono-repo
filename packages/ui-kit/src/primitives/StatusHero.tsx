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
  /**
   * The heading's level. `h1` by default, because the hero is usually the page's heading; a screen that
   * already has a `ScreenHeader` title passes `h2` so the page keeps one `h1`.
   */
  as?: 'h1' | 'h2';
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * `.m-success` — the ring, a heading and a short paragraph, centred. The shape of every "it
 * happened" and "it is held" screen: terms agreed, request sent, proposal held for review.
 */
export function StatusHero({
  tone,
  title,
  as: Heading = 'h1',
  children,
  className,
}: StatusHeroProps): React.JSX.Element {
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
      <Heading className="mb-[6px] text-[19px] font-semibold">{title}</Heading>
      <p className="mb-[16px] text-[12.5px] leading-[1.5] text-slate">{children}</p>
    </div>
  );
}
