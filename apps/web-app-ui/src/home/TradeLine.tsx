import { TradeRow } from '@komtru/ui-kit';
import type { TradeListItem } from '@komtru/shared-types';
import { describeTrade, initialsOf, nairaShort, partyName } from '../trade/format';

/**
 * One of the person's trades as a row on home and in search. Its words come from the trade module's own
 * `describeTrade`, so a status reads the same here as on the Trades tab; the row is drawn here so this
 * directory does not reach into the trade module's components.
 *
 * A row that needs the person is outlined in indigo, as the Trades tab outlines it.
 */
export function TradeLine({ trade }: { trade: TradeListItem }): React.JSX.Element {
  const state = describeTrade(trade);
  const name = trade.counterparty === null ? undefined : partyName(trade.counterparty);
  const title = trade.item.title ?? trade.item.categoryName ?? 'Trade';

  return (
    <TradeRow
      amount={trade.itemAmountMinor === null ? '—' : nairaShort(trade.itemAmountMinor)}
      status={{ tone: state.tone, label: state.label }}
      {...(name === undefined
        ? {}
        : { counterparty: { name, initials: initialsOf(name.replace(/^@/, '')) } })}
      sub={`${title} · ${state.sub}`}
      href={`/trade/${trade.id}`}
      className={trade.attention === null ? '' : 'border-[1.5px] border-trust-indigo'}
    />
  );
}
