import { Avatar, type AvatarTone } from './Avatar.js';
import { Chip, type ChipTone } from './Chip.js';
import { cx } from './cx.js';
import { FOCUS_RING } from './focus.js';
import { TradeProgress } from './TradeProgress.js';

export interface TradeCounterparty {
  name: string;
  initials: string;
  tone?: AvatarTone;
}

export interface TradeRowProps {
  /** Already formatted: the reference prints `₦452,000`, never a raw number. */
  amount: string;
  counterparty?: TradeCounterparty;
  status?: { tone: ChipTone; label: string };
  /** The muted third line — "iPhone 13 Pro · Awaiting shipment", "Last synced 6 minutes ago". */
  sub?: string;
  /** 1–5. Draws the five-step bar the home list uses instead of a sub-line. */
  stage?: number;
  href?: string;
  onClick?: React.MouseEventHandler;
  className?: string;
}

/**
 * `.trade-row` — the one card the whole product is a list of. Renders as a link when it has an href,
 * a button when it has a handler, and a plain block otherwise, so a non-navigating row never lands
 * in the tab order.
 */
export function TradeRow({
  amount,
  counterparty,
  status,
  sub,
  stage,
  href,
  onClick,
  className,
}: TradeRowProps): React.JSX.Element {
  const Tag = href !== undefined ? 'a' : onClick !== undefined ? 'button' : 'div';
  const interactive = Tag !== 'div';
  return (
    <Tag
      {...(href !== undefined ? { href } : {})}
      {...(Tag === 'button' ? { type: 'button' as const } : {})}
      {...(onClick !== undefined ? { onClick } : {})}
      className={cx(
        'mb-[10px] block w-full rounded-md border border-solid border-border-hairline bg-surface-primary p-[14px] text-left',
        interactive && FOCUS_RING,
        className,
      )}
    >
      <div className="mb-[8px] flex items-start justify-between">
        <span className="font-mono text-[16px] font-semibold">{amount}</span>
        {status && <Chip tone={status.tone}>{status.label}</Chip>}
      </div>
      {counterparty && (
        <div className="flex items-center gap-[6px] text-[12px] text-slate">
          <Avatar initials={counterparty.initials} size="sm" tone={counterparty.tone} />
          {counterparty.name}
        </div>
      )}
      {sub !== undefined && <div className="mt-[6px] text-[11px] text-trust-gray">{sub}</div>}
      {stage !== undefined && <TradeProgress stage={stage} />}
    </Tag>
  );
}
