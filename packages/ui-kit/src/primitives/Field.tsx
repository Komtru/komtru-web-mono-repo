import { cx } from './cx.js';

/** The reference's three helper voices: plain, the emerald confirmation, and the risk message. */
export type HelperTone = 'muted' | 'ok' | 'error';

const HELPER_TONES: Record<HelperTone, string> = {
  muted: 'text-slate',
  ok: 'text-success-on-soft flex items-center gap-[5px]',
  error: 'text-risk-on-soft font-semibold',
};

/** `.input` — shared by every text control and by `<select>`, which the reference styles identically. */
export const CONTROL_CLASS = [
  'w-full rounded-sm border-[1.5px] border-solid border-border-hairline bg-surface-secondary',
  'py-[12px] px-[14px] font-body text-[15px] text-midnight-text',
  'focus:outline-none focus:border-trust-indigo focus:bg-surface-primary',
  'focus:shadow-[0_0_0_3px_var(--trust-indigo-soft)]',
].join(' ');

export const CONTROL_INVALID_CLASS =
  'border-risk focus:border-risk focus:shadow-[0_0_0_3px_var(--risk-soft)]';

export interface FieldProps {
  id: string;
  label: string;
  helper?: React.ReactNode;
  helperTone?: HelperTone;
  helperId: string;
  className?: string;
  children: React.ReactNode;
}

/** `.field` — label above, control, helper below. The furniture TextField and Select share. */
export function Field({
  id,
  label,
  helper,
  helperTone = 'muted',
  helperId,
  className,
  children,
}: FieldProps): React.JSX.Element {
  return (
    <div className={cx('mb-[16px]', className)}>
      <label htmlFor={id} className="mb-[6px] block text-[13px] font-semibold">
        {label}
      </label>
      {children}
      {helper !== undefined && (
        <div id={helperId} className={cx('mt-[6px] text-[11.5px] leading-[1.5]', HELPER_TONES[helperTone])}>
          {helper}
        </div>
      )}
    </div>
  );
}
