'use client';

import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';

/** The same four tones the in-screen banners carry. */
export type ToastTone = 'info' | 'warning' | 'success' | 'risk';

const TONES: Record<ToastTone, { surface: string; accent: string }> = {
  info: { surface: 'bg-trust-indigo-soft', accent: 'text-info-on-soft' },
  warning: { surface: 'bg-warning-soft', accent: 'text-warning-on-soft' },
  success: { surface: 'bg-success-soft', accent: 'text-success-on-soft' },
  risk: { surface: 'bg-risk-soft', accent: 'text-risk-on-soft' },
};

export interface ToastProps {
  tone: ToastTone;
  title: string;
  body?: string;
  onDismiss?: () => void;
  className?: string;
}

/**
 * The reference declares no toast rule, and says so out loud: Trade Complete is "a real moment, not
 * just a toast". So a toast here is explicitly the small stuff — a queued action, a copied code —
 * and borrows `.offline-banner`'s geometry rather than inventing a shape. Anything that changes a
 * person's money gets a screen, not this.
 */
export function Toast({ tone, title, body, onDismiss, className }: ToastProps): React.JSX.Element {
  const { surface, accent } = TONES[tone];
  return (
    <div
      role={tone === 'risk' ? 'alert' : 'status'}
      aria-live={tone === 'risk' ? 'assertive' : 'polite'}
      className={cx(
        'mb-[14px] flex items-center gap-[12px] rounded-md py-[12px] px-[16px]',
        surface,
        className,
      )}
    >
      <div className="flex-1">
        <b className={cx('block text-[13px]', accent)}>{title}</b>
        {body !== undefined && <span className="text-[11px] text-midnight-text opacity-[.75]">{body}</span>}
      </div>
      {onDismiss !== undefined && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cx('shrink-0 border-none bg-transparent text-[11px] font-semibold', accent, FOCUS_RING)}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
