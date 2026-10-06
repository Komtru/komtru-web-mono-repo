import { cx } from '../primitives/cx.js';

/**
 * `.dtrend`'s three treatments. `up` is the reference's success green, `flag` its warning amber;
 * `neutral` is the base rule, which declares no colour at all — "since activation" is not good news
 * or bad news, and the reference refuses to colour it either way.
 */
export type KpiTrendTone = 'up' | 'flag' | 'neutral';

export interface KpiCardProps {
  label: string;
  /** Pre-formatted, and set in mono: `₦48.2m`, `8,492`, `12`. */
  value: string;
  trend?: { text: string; tone?: KpiTrendTone };
  className?: string;
}

const TRENDS: Record<KpiTrendTone, string> = {
  up: 'text-success-on-soft',
  flag: 'text-warning-on-soft',
  neutral: '',
};

/**
 * `.dash-stat` — one number with its label and a trend line.
 *
 * The reference states a KPI card four times: `.dash-stat` in the Design System block and three
 * different `.p0-kpi` rules across the P0 and canonical blocks, at 8px, 11px and 11px labels. This
 * reproduces `.dash-stat`, the Design System's own, and the parity row says so — the same choice,
 * made the same way, as T-012 made for `.ko-stepper`.
 */
export function KpiCard({ label, value, trend, className }: KpiCardProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'rounded-md border border-solid border-border-hairline bg-surface-elevated p-[16px]',
        className,
      )}
    >
      <div className="text-[11px] uppercase tracking-[.04em] text-slate">{label}</div>
      <div className="mt-[6px] font-mono text-[22px] font-semibold">{value}</div>
      {trend !== undefined && (
        <div className={cx('mt-[4px] text-[11px] font-semibold', TRENDS[trend.tone ?? 'neutral'])}>
          {trend.text}
        </div>
      )}
    </div>
  );
}
