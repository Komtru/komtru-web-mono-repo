// The versions an agreement went through, from the trade's activity: one attributed, dated item per terms version
// (PROPOSAL_SENT for the first, TERMS_CHANGED for each after). The amount of an earlier version is not on any
// route, so only the accepted version has one, from the trade's own terms.
import type { TradeView } from '@komtru/api-client';
import type { TradeActivityItem } from '@komtru/shared-types';
import type { VersionStep } from '@komtru/ui-kit';
import { naira, whenLabel } from '../format';
import type { TradeRole } from '../workspace-state';

const VERSION_KINDS: readonly string[] = ['PROPOSAL_SENT', 'TERMS_CHANGED'];

const other = (role: TradeRole): TradeRole => (role === 'BUYER' ? 'SELLER' : 'BUYER');
const roleWord = (role: TradeRole): string => (role === 'BUYER' ? 'Buyer' : 'Seller');

/**
 * The steps, oldest first, or `undefined` when the activity cannot account for every version (the feed is paged,
 * so an old trade's earliest items may not have been loaded): the caller then falls back to the plain list.
 */
export function historySteps(
  trade: TradeView,
  activity: readonly TradeActivityItem[],
): VersionStep[] | undefined {
  const terms = trade.terms;
  if (terms === null) return undefined;
  const events = activity
    .filter((item) => VERSION_KINDS.includes(item.kind) && item.actor !== 'KOMTRU')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (events.length !== terms.versionNumber) return undefined;
  return events.map((event, index) => {
    const version = index + 1;
    const proposer = event.actor === 'YOU' ? trade.yourRole : other(trade.yourRole);
    const accepted = version === terms.versionNumber;
    const what = version === 1 ? 'proposal' : 'counter';
    return {
      id: String(version),
      title: accepted
        ? `Version ${String(version)} · Accepted`
        : `Version ${String(version)} · ${roleWord(proposer)} ${what}`,
      detail: accepted
        ? [
            naira(terms.itemAmountMinor),
            `${roleWord(proposer)} ${what}, accepted by buyer and seller`,
            whenLabel(event.occurredAt),
          ].join(' · ')
        : whenLabel(event.occurredAt),
      state: 'done' as const,
    };
  });
}
