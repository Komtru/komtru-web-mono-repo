'use client';

import type { TradeView } from '@komtru/api-client';
import { tradeKeys, useReportDelivered } from '@komtru/api-client/react';
import { Button, RiskBanner, StatusHero } from '@komtru/ui-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { platformWords } from '../format';

/**
 * The seller says the item has arrived (F-026's "Report delivery"), once the trade is `SHIPPED`; the buyer is then
 * asked to confirm. It sits on the post-handover screens of F-028 so the step stays reachable from the UI now that
 * the dispatch link lands there. A replay is harmless on the platform, and the button is shut while the call runs.
 */
export function ReportDelivery({ trade }: { trade: TradeView }): React.JSX.Element | null {
  const report = useReportDelivered();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  if (trade.yourRole !== 'SELLER') return null;
  if (trade.status === 'UNCONFIRMED_DELIVERY') {
    return (
      <StatusHero tone="success" as="h2" title="Delivery reported">
        The buyer has been asked to confirm it arrived.
      </StatusHero>
    );
  }
  if (trade.status !== 'SHIPPED') return null;
  return (
    <>
      <p className="mb-[14px] text-[12.5px] leading-[1.6] text-slate">
        When the item has arrived, report the delivery so the buyer can confirm.
      </p>
      {problem !== undefined && <RiskBanner>{problem}</RiskBanner>}
      <Button
        type="button"
        className="mb-[8px]"
        disabled={report.isPending}
        onClick={() => {
          setProblem(undefined);
          report.mutate(trade.id, {
            onError: (error) => {
              // The trade may have moved on meanwhile: read it again so the screen follows.
              void queryClient.invalidateQueries({ queryKey: tradeKeys.one(trade.id), exact: true });
              setProblem(platformWords(error, 'We couldn’t report the delivery. Try again.'));
            },
          });
        }}
      >
        {report.isPending ? 'Reporting…' : 'Report delivery'}
      </Button>
    </>
  );
}
