// What home and search say about the caller's trades. Pure functions, so the rules are tested without a DOM.
//
// Whether a trade needs the person is the server's `attention`, never worked out here. Whether a trade is
// finished is the trade module's own reading of its status (`describeTrade`), so home and the Trades tab can
// never disagree about which trades are past.
import { tradeCodeSchema, type TradeListItem } from '@komtru/shared-types';
import { describeTrade } from '../trade/format';

export interface TradeGroups {
  /** The server asks something of the person: an answer, a payment, a shipment, a confirmation. */
  attention: TradeListItem[];
  /** Still moving, and nothing is asked of the person right now. */
  active: TradeListItem[];
  /** Finished without being funded, or closed: declined, cancelled, expired, rejected. */
  past: TradeListItem[];
}

/** Each trade in exactly one group, keeping the order the server gave. */
export function splitTrades(trades: readonly TradeListItem[]): TradeGroups {
  const groups: TradeGroups = { attention: [], active: [], past: [] };
  for (const trade of trades) {
    if (trade.attention !== null) groups.attention.push(trade);
    else if (describeTrade(trade).closed) groups.past.push(trade);
    else groups.active.push(trade);
  }
  return groups;
}

/** The canonical Trade Code a typed query names (`KMT-88213` becomes `KMT-88213-NG`), or undefined. */
export function tradeCodeOf(query: string): string | undefined {
  const parsed = tradeCodeSchema.safeParse(query);
  return parsed.success ? parsed.data : undefined;
}

const CODE_SHAPED = /^(kmt-)?\d{5,8}(-ng)?$/i;

/**
 * Whether a typed query finds a trade. A query shaped like a Trade Code matches on its digits alone, so a
 * code typed without the prefix or the market suffix still finds the trade. Anything else is matched,
 * without regard to case, against the item, its category, and the other party's name or handle.
 */
export function matchesTradeQuery(trade: TradeListItem, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (text === '') return false;

  if (CODE_SHAPED.test(text)) {
    return trade.tradeCode.replace(/\D/g, '') === text.replace(/\D/g, '');
  }

  const handle = text.startsWith('@') ? text.slice(1) : text;
  if (handle === '') return false;
  const fields = [
    trade.item.title,
    trade.item.categoryName,
    trade.item.categoryCode,
    trade.counterparty?.displayName,
    trade.counterparty?.username,
  ];
  return fields.some((field) => {
    if (field === null || field === undefined) return false;
    const value = field.toLowerCase();
    return value.includes(text) || value.includes(handle);
  });
}
