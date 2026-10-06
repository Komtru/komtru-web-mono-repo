import { cx } from './cx.js';

/** The five stages the reference labels under every trade row, in order. */
export const TRADE_STAGES = ['Agreement', 'Protected', 'Shipped', 'Inspection', 'Release'] as const;

export type TradeStage = (typeof TRADE_STAGES)[number];

const SEGMENT = 'h-[4px] flex-1 rounded-[2px]';

export interface TradeProgressProps {
  /** 1-based, matching the labels: 1 is Agreement, 5 is Release. */
  stage: number;
  /** Named for a screen reader; the bar itself is otherwise five anonymous slabs. */
  label?: string;
  showLabels?: boolean;
  className?: string;
}

export function TradeProgress({
  stage,
  label = 'Trade progress',
  showLabels = true,
  className,
}: TradeProgressProps): React.JSX.Element {
  if (!Number.isInteger(stage) || stage < 1 || stage > TRADE_STAGES.length) {
    throw new RangeError(`stage must be 1–${TRADE_STAGES.length}, got ${String(stage)}`);
  }
  return (
    <>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={TRADE_STAGES.length}
        aria-valuenow={stage}
        aria-valuetext={TRADE_STAGES[stage - 1]}
        className={cx('mt-[10px] flex gap-[3px]', className)}
      >
        {TRADE_STAGES.map((name, index) => (
          <div
            key={name}
            className={cx(
              SEGMENT,
              index + 1 < stage && 'bg-trust-emerald',
              index + 1 === stage && 'bg-trust-indigo',
              index + 1 > stage && 'bg-stone-gray',
            )}
          />
        ))}
      </div>
      {showLabels && (
        <div aria-hidden className="mt-[4px] flex justify-between">
          {TRADE_STAGES.map((name) => (
            <span key={name} className="flex-1 text-center text-[8px] text-trust-gray">
              {name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
