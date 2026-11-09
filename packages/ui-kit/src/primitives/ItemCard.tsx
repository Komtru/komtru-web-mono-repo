import { cx } from './cx.js';

export interface ItemCardProps {
  title: string;
  /** "Sierra Blue · Sealed box": the condition line under the title. */
  sub?: string;
  /** Already formatted, in naira. This component never formats or adds money. */
  price: string;
  className?: string;
}

/**
 * `.item-card` — the thing being traded: a 64px thumb block (listings carry no photo yet), the title, one line of condition and the
 * price. Used by the start screen, the request the seller answers and the agreement summary, so the
 * item reads the same wherever it appears.
 */
export function ItemCard({ title, sub, price, className }: ItemCardProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'mb-[16px] flex gap-[12px] rounded-md border border-solid border-border-hairline bg-surface-primary p-[12px]',
        className,
      )}
    >
      <div
        aria-hidden
        className="h-[64px] w-[64px] shrink-0 rounded-[10px] bg-[linear-gradient(135deg,var(--stone-gray),var(--cloud-gray))]"
      />
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{title}</div>
        {sub !== undefined && <div className="mt-[2px] text-[11px] text-slate">{sub}</div>}
        <div className="mt-[6px] font-mono text-[16px] font-semibold">{price}</div>
      </div>
    </div>
  );
}
