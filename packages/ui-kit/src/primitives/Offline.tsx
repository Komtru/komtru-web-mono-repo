import { cx } from './cx.js';

/**
 * `.offline-banner` and `.offline-queued` — OF1's pair.
 *
 * The reference calls the offline state "the pattern the Design System calls first-class for this
 * market, never actually shown", which is why it is here rather than in the one app that drew it
 * first: every data-backed screen in the product needs the same two sentences, and a second copy of
 * them is how two screens end up disagreeing about what a dropped connection did to your money.
 *
 * Both ship their own icon. A screen passing one in could pass the wrong one, and there is no
 * second thing either of these means.
 */

export interface OfflineBannerProps {
  /** `.offline-banner b`. Defaults to the reference's own words. */
  title?: string;
  /** `.offline-banner span` — what the person is looking at, and what happens next. */
  children: React.ReactNode;
  className?: string;
}

/** OF1's struck-through signal arcs, at the weight and caps the reference draws them with. */
const SignalOffIcon = ({ className }: { className: string }): React.JSX.Element => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    strokeLinecap="round"
    className={className}
  >
    <path d="M3 3l18 18" />
    <path d="M8.5 8.5a10 10 0 0 1 11 2M5 12a10 10 0 0 1 2.5-3.3" />
    <path d="M12 16h.01" />
  </svg>
);

/**
 * The warning-toned banner a screen draws above its content while the connection is gone.
 *
 * `role="status"`, not `alert`: nothing is wrong, and the drop arrives without a navigation, so a
 * screen reader is told nothing at all unless the banner says so itself.
 */
export function OfflineBanner({
  title = "You're offline",
  children,
  className,
}: OfflineBannerProps): React.JSX.Element {
  return (
    <div
      role="status"
      className={cx(
        'mb-[14px] flex items-center gap-[12px] rounded-md bg-warning-soft py-[12px] px-[16px]',
        className,
      )}
    >
      <SignalOffIcon className="h-[18px] w-[18px] shrink-0 stroke-warning-on-soft" />
      <div>
        <b className="block text-[13px] text-warning-on-soft">{title}</b>
        <span className="text-[11px] text-midnight-text opacity-[.75]">{children}</span>
      </div>
    </div>
  );
}

export interface QueuedActionNoteProps {
  /** The action, the Trade it belongs to, and the reassurance. OF1 writes all three. */
  children: React.ReactNode;
  className?: string;
}

/** `.offline-queued`'s clock, 1.8 weight as the reference strokes it. */
const QueuedIcon = ({ className }: { className: string }): React.JSX.Element => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="1.8"
    strokeLinecap="round"
    className={className}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

/**
 * The dashed note under the list: an action the person already took, held until there is a line to
 * send it down. Quieter than the banner on purpose — the banner is the news, this is the receipt.
 */
export function QueuedActionNote({ children, className }: QueuedActionNoteProps): React.JSX.Element {
  return (
    <div
      role="status"
      className={cx(
        'mt-[8px] flex items-center gap-[10px] rounded-md border border-dashed border-border-hairline',
        'bg-surface-primary py-[12px] px-[14px] text-[11.5px] leading-[1.5] text-slate',
        className,
      )}
    >
      <QueuedIcon className="h-[15px] w-[15px] shrink-0 stroke-trust-gray" />
      {children}
    </div>
  );
}
