'use client';

import type { TradeView } from '@komtru/api-client';
import {
  ActionStack,
  Button,
  ScreenColumn,
  ScreenHeader,
  SectionLabel,
  TermList,
  TermRow,
  VersionTimeline,
  WarnBanner,
} from '@komtru/ui-kit';
import { BACK_TO_TRADES } from '../parts';
import { fundHref } from '../workspace-state';

/**
 * EX-01: an agreed trade that was not funded in time. Nothing is reactivated: a new trade needs a new agreement.
 * The platform sends no funding deadline, so the screen says the window closed and never how long it was.
 */
export function TradeExpired({ trade }: { trade: TradeView }): React.JSX.Element {
  return (
    <ScreenColumn>
      <ScreenHeader title={trade.tradeCode} backHref="/trades" backLabel="Back to your trades" />
      <WarnBanner title="This trade has expired">
        The funding window ended before funding was confirmed.
      </WarnBanner>
      <VersionTimeline
        aria-label="What happened"
        steps={[
          { id: 'accepted', title: 'Agreement accepted', detail: 'Trade created', state: 'done' },
          { id: 'closed', title: 'Funding window closed', detail: 'Not funded in time', state: 'pending' },
        ]}
      />
      <SectionLabel>Status</SectionLabel>
      <TermList aria-label="Status">
        <TermRow label="Trade status">Expired</TermRow>
        <TermRow label="Payment status">Not confirmed</TermRow>
        <TermRow label="Next step">Start a new trade</TermRow>
      </TermList>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
        No dispatch should take place. If a payment was initiated, check its provider status before attempting
        another payment. A new trade needs a new agreement; expired terms are not silently reactivated.
      </p>
      <ActionStack>
        <Button asChild>
          <a href="/trade/new">Start a new trade</a>
        </Button>
        {trade.yourRole === 'BUYER' && (
          <Button asChild variant="secondary">
            <a href={fundHref(trade.id)}>Check payment status</a>
          </Button>
        )}
        {BACK_TO_TRADES}
      </ActionStack>
    </ScreenColumn>
  );
}
